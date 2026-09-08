// The 3D screen's data layer: a restaurant's library, and what it has asked for.
//
// The engine is on the other side of `model_requests` and this file never crosses it. It
// writes what a restaurant asked for and reads what came back; `menu/model_requests.py`
// does everything in between. Nothing here has heard of a credit, a lease or an engine
// name, which is what lets the engine be replaced without touching the admin.
//
// Two things this deliberately CANNOT do, and both are enforced by the database rather
// than by leaving a button out of the UI:
//
//   Approve a request. The starting state comes from a trigger, because 30 credits is real
//   money and a client that could pick its own state could pick `approved`.
//
//   Write an engine's own columns. `grant update (state)` is the whole permission an owner
//   has on a request - they may withdraw one and nothing else.

import { createClient } from '@/lib/supabase/client'

export type TenantModel = {
  id: string
  title: string
  dish: string
  variant: string
  poster: string
  glb: string
  usdz: string
  view_orbit: string | null
  scale_cm: number | null
  state: 'draft' | 'approved' | 'rejected'
  archived: boolean
  scale_axis: string | null
  width_cm: number | null
  length_cm: number | null
  height_cm: number | null
  created_utc: string
  /** Which dish is using it, if any. The pointer lives on the item (MENU-PLATFORM §3), so
   *  this is the only place the relationship can be read from. */
  usedBy: { id: string; name: string } | null
}

export type ModelRequest = {
  id: string
  title: string
  kind: 'generate' | 'rescale'
  dish: string
  variant: string
  state: 'pending' | 'approved' | 'running' | 'done' | 'failed' | 'cancelled'
  note: string
  item_id: string | null
  photo_keys: string[]
  requested_utc: string
}

const assetUrl = (key: string | null | undefined) =>
  !key ? '' : key.startsWith('http') ? key
    : `${process.env.NEXT_PUBLIC_MENU_ORIGIN || ''}/a/${key}`

type ModelRow = {
  id: string; title: string | null; dish: string; variant: string
  poster_key: string | null; draco_key: string | null; usdz_key: string | null
  // An IMPORTED model's files are absolute URLs on somebody else's bucket rather than
  // keys in ours - see menu/publish.py. Both travel in one field to the diner's page,
  // which tells them apart by the scheme; this used to select only our own two columns.
  external_glb: string | null; external_usdz: string | null
  view_orbit: string | null; scale_cm: number | null; scale_axis: string | null
  width_cm: number | null; length_cm: number | null; height_cm: number | null
  tenant_state: 'draft' | 'approved' | 'rejected'; archived: boolean; created_utc: string
}

export async function loadLibrary(tenantId: string) {
  const supabase = createClient()

  const [{ data: rows }, { data: items }, { data: reqs }, { data: tenant }] =
    await Promise.all([
      supabase.from('models')
        .select('id, title, dish, variant, poster_key, draco_key, usdz_key, ' +
                'external_glb, external_usdz, view_orbit, ' +
                'scale_cm, scale_axis, width_cm, length_cm, height_cm, ' +
                'tenant_state, archived, created_utc')
        .eq('tenant_id', tenantId).order('created_utc', { ascending: false }),
      supabase.from('items').select('id, name, model_id').eq('tenant_id', tenantId),
      supabase.from('model_requests')
        .select('id, title, kind, dish, variant, state, note, item_id, photo_keys, requested_utc')
        .eq('tenant_id', tenantId)
        .in('state', ['pending', 'approved', 'running', 'failed'])
        .order('requested_utc', { ascending: false }),
      supabase.from('tenants').select('model_quota').eq('id', tenantId).single(),
    ])

  const usedBy = new Map<string, { id: string; name: string }>()
  for (const i of (items || []) as { id: string; name: string; model_id: string | null }[]) {
    if (i.model_id) usedBy.set(i.model_id, { id: i.id, name: i.name })
  }

  const models: TenantModel[] = ((rows || []) as unknown as ModelRow[]).map(r => ({
    id: r.id,
    title: r.title || r.dish,
    dish: r.dish,
    variant: r.variant,
    poster: assetUrl(r.poster_key),
    // **Ours OR imported.** Every Monday Greens model came across from the platform, so
    // `draco_key` is null on all of them and `external_glb` holds the file - and this read
    // only the first. The rows appeared in the Studio with no preview, no "Turn it
    // around", no size QR and no full-screen viewer, because every one of those is gated
    // on `m.glb` being truthy. From the outside it looked exactly like "Monday Greens has
    // no 3D models", while the diner's menu showed all five perfectly - `menu.js` has done
    // `draco_key || external_glb` since the day it was written.
    glb: assetUrl(r.draco_key || r.external_glb),
    usdz: assetUrl(r.usdz_key || r.external_usdz),
    view_orbit: r.view_orbit,
    scale_cm: r.scale_cm,
    scale_axis: r.scale_axis,
    width_cm: r.width_cm, length_cm: r.length_cm, height_cm: r.height_cm,
    state: r.tenant_state,
    archived: !!r.archived,
    created_utc: r.created_utc,
    usedBy: usedBy.get(r.id) ?? null,
  }))

  const { data: used } = await supabase.rpc('model_requests_used', { t: tenantId })

  return {
    models,
    requests: (reqs || []) as unknown as ModelRequest[],
    quota: (tenant?.model_quota as number) ?? 0,
    used: (used as number) ?? 0,
    dishes: (items || []) as { id: string; name: string; model_id: string | null }[],
  }
}

/** The owner's verdict. DECISIONS §9.4: this is their sentence - "that does not look like
 *  my dish" - and it is a different sentence from our own fault tags, which live in the
 *  engine's dataset and are never shown to a restaurant. Mixing them would teach us the
 *  wrong thing about the engine. */
export async function setVerdict(id: string, state: 'approved' | 'rejected' | 'draft') {
  const supabase = createClient()
  const { data: auth } = await supabase.auth.getUser()
  const { error } = await supabase.from('models').update({
    tenant_state: state,
    decided_utc: new Date().toISOString(),
    decided_by: auth?.user?.id ?? null,
  }).eq('id', id)
  return error
}

export async function renameModel(id: string, title: string) {
  const supabase = createClient()
  const { error } = await supabase.from('models').update({ title: title.trim() }).eq('id', id)
  return error
}

/** "h v zoom", three bare numbers - the platform's own convention, so a number somebody
 *  already learned still means the same thing. Clamped to what the renderer clamps to, so
 *  a saved angle is one that will actually be used rather than silently discarded. */
export async function setOrbit(id: string, orbit: string | null) {
  const supabase = createClient()
  const { error } = await supabase.from('models')
    .update({ view_orbit: orbit || null }).eq('id', id)
  return error
}

/** Point a dish at a model, or take it off. Nothing is copied - the item holds the
 *  pointer, which is what lets one model serve several dishes later. */
export async function attachModel(itemId: string, modelId: string | null) {
  const supabase = createClient()
  const { error } = await supabase.from('items')
    .update({ model_id: modelId, is_3d: !!modelId }).eq('id', itemId)
  return error
}

export async function requestModel(
  tenantId: string,
  photoKeys: string[],
  title: string,
  itemId: string | null,
) {
  const supabase = createClient()
  // The engine identifier: the ITEM's uuid, never its name. The engine keys its storage on
  // a slug of this and every restaurant in Georgia has a dish called Khachapuri, so names
  // would put two restaurants on one R2 prefix and let them overwrite each other.
  const dish = itemId || crypto.randomUUID()

  const { data, error } = await supabase.from('model_requests').insert({
    tenant_id: tenantId, item_id: itemId, dish, variant: 'default',
    title: title.trim(), photo_keys: photoKeys,
  }).select('id, state, note').single()

  if (error) {
    // The partial unique index. A double-tap on a slow connection is the normal way to hit
    // this, and "duplicate key value violates unique constraint" is not an error message.
    if (error.code === '23505') {
      return { data: null, error: { message: 'This dish already has a model on the way.' } }
    }
    return { data: null, error }
  }
  return { data, error: null }
}

export async function cancelRequest(id: string) {
  const supabase = createClient()
  const { error } = await supabase.from('model_requests')
    .update({ state: 'cancelled' }).eq('id', id)
  return error
}


/** A model we uploaded by hand, rather than one the engine built.
 *
 *  **This exists because the button already did.** The item editor has had "Upload .glb"
 *  and "Upload .usdz" behind `canUploadModels` for as long as it has existed. They worked
 *  as far as R2 - the file arrived, correctly typed and sized - and then the URL went into
 *  local form state that `saveItem` never persists. Every model uploaded that way was
 *  paid for in bandwidth and lost on save, with a success message.
 *
 *  So the fix and the feature are the same job: put the file where the rest of the system
 *  looks for one, which is a `models` row keyed to the tenant, and hand back its id for
 *  `items.model_id`.
 *
 *  **Approved, not draft.** The verdict flow exists so an OWNER vets what the engine
 *  invented; a model a super admin uploads deliberately has already been judged by the
 *  person uploading it, and leaving it draft would mean it silently does not appear on the
 *  menu - `public_menu` only serves `tenant_state = 'approved'`. It can still be rejected
 *  from the Studio like any other.
 */
export async function saveUploadedModel(args: {
  tenantId: string
  title: string
  /** The dish it belongs to, when there is one. Only used to key the model row. */
  itemId?: string | null
  /** Either may be absent: a GLB with no USDZ is web and Android but no iPhone AR. */
  glbKey?: string | null
  usdzKey?: string | null
  /** Update this row instead of making another - a .usdz landing after its .glb. */
  modelId?: string | null
}): Promise<{ id: string | null; error: { message: string } | null }> {
  const supabase = createClient()
  const patch: Record<string, unknown> = {}
  if (args.glbKey) patch.draco_key = args.glbKey
  if (args.usdzKey) patch.usdz_key = args.usdzKey
  if (!Object.keys(patch).length) return { id: args.modelId ?? null, error: null }

  if (args.modelId) {
    const { error } = await supabase.from('models').update(patch).eq('id', args.modelId)
    return { id: args.modelId, error }
  }

  const { data, error } = await supabase.from('models').insert({
    tenant_id: args.tenantId,
    title: args.title || 'Uploaded model',
    // `dish` is NOT NULL and is the engine's key for a piece of work. An upload has no
    // engine job, so the dish it is for is the honest value - and a stable one, so a
    // second upload for the same dish is recognisably about the same dish.
    dish: args.itemId || `upload-${Date.now()}`,
    variant: 'default',
    tenant_state: 'approved',
    ...patch,
  }).select('id').single()
  return { id: (data as { id: string } | null)?.id ?? null, error }
}
