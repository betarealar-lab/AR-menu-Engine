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
  created_utc: string
  /** Which dish is using it, if any. The pointer lives on the item (MENU-PLATFORM §3), so
   *  this is the only place the relationship can be read from. */
  usedBy: { id: string; name: string } | null
}

export type ModelRequest = {
  id: string
  title: string
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
  view_orbit: string | null; scale_cm: number | null
  tenant_state: 'draft' | 'approved' | 'rejected'; created_utc: string
}

export async function loadLibrary(tenantId: string) {
  const supabase = createClient()

  const [{ data: rows }, { data: items }, { data: reqs }, { data: tenant }] =
    await Promise.all([
      supabase.from('models')
        .select('id, title, dish, variant, poster_key, draco_key, usdz_key, view_orbit, ' +
                'scale_cm, tenant_state, created_utc')
        .eq('tenant_id', tenantId).order('created_utc', { ascending: false }),
      supabase.from('items').select('id, name, model_id').eq('tenant_id', tenantId),
      supabase.from('model_requests')
        .select('id, title, state, note, item_id, photo_keys, requested_utc')
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
    glb: assetUrl(r.draco_key),
    usdz: assetUrl(r.usdz_key),
    view_orbit: r.view_orbit,
    scale_cm: r.scale_cm,
    state: r.tenant_state,
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
