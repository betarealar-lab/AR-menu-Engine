// The developer console's data layer: every restaurant at once, the BetaReal library, and
// the two ways a model gets into it without a restaurant being involved.
//
// Nothing here is reachable by an owner in a way that matters. The database says no, not
// this file: `admin_directory()` returns no rows to anyone who is not a super admin, a
// library row (tenant_id NULL) fails `is_member_of(NULL)` for everybody else, and the gate
// refuses library requests, uploads and engine choice from a non-super admin (0030).

import { createClient } from '@/lib/supabase/client'
import type { Dims } from '@/lib/data/studio'

const menuOrigin = () => (process.env.NEXT_PUBLIC_MENU_ORIGIN || '').replace(/\/$/, '')
const assetUrl = (key: string | null | undefined) =>
  !key ? '' : key.startsWith('http') ? key : `${menuOrigin()}/a/${key}`

// ── Restaurants ─────────────────────────────────────────────────────

export type DirectoryRow = {
  tenant_id: string
  slug: string
  name: string
  template_id: string | null
  /** Self-serve (true) or Premium, where we make the models (0029). */
  studio: boolean
  setup_done: boolean
  created_utc: string
  members: number
  categories: number
  dishes: number
  dishes_3d: number
  models: number
  models_draft: number
  requests_open: number
  requests_failed: number
  sessions_7d: number
  last_event_utc: string | null
  embed_on: boolean
}

export async function loadDirectory(): Promise<{ rows: DirectoryRow[]; error: string }> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('admin_directory')
  // bigint arrives as a number from PostgREST for values this small; coerced anyway so a
  // sort never compares "10" with "9".
  const rows = ((data as DirectoryRow[]) || []).map(r => ({
    ...r,
    members: Number(r.members), categories: Number(r.categories),
    dishes: Number(r.dishes), dishes_3d: Number(r.dishes_3d),
    models: Number(r.models), models_draft: Number(r.models_draft),
    requests_open: Number(r.requests_open), requests_failed: Number(r.requests_failed),
    sessions_7d: Number(r.sessions_7d),
  }))
  return { rows, error: error?.message || '' }
}

/** Does this restaurant need one of us? The rule the "Needs attention" filter and the
 *  dot on a row both use, so the two can never disagree.
 *
 *  Unfinished setup is NOT in it: every imported restaurant has `setup_done = false`
 *  because it never went through the wizard, so it flagged 8 of 9 and meant nothing.
 *  It has its own filter instead. */
export const needsAttention = (r: DirectoryRow) =>
  r.requests_failed > 0 || r.models_draft > 0 || r.requests_open > 0

/** The diner's page for a restaurant. */
export const liveMenuUrl = (slug: string) => {
  const o = menuOrigin()
  return o ? `${o}/${slug}` : `https://${slug}.betareal.ge/`
}

// ── Engines ─────────────────────────────────────────────────────────
//
// The names are `engines.REGISTRY` keys on the Python side, sent as
// `model_requests.engine_requested`; the bridge puts the name on the job and the worker
// builds that engine. Kept by hand, because the admin cannot import Python - so a name
// here that the registry does not have fails the job, loudly, rather than falling back.
//
// `wired: false` rows are shown and cannot be picked. They are the engines the provider
// layer is ready for and that are deliberately not switched on yet (Temo, 2026-09-28:
// "keep Pro plan for Meshy for now, don't wire fal yet"). Showing them says what the
// swap will look like; disabling them keeps a click from spending money on a key nobody
// has set.

export type EngineChoice = {
  id: string
  label: string
  provider: 'meshy' | 'fal'
  views: number
  /** Per model, in dollars, at our plan's rate. What a person picking needs to know. */
  cost: string
  note: string
  wired: boolean
}

export const ENGINES: EngineChoice[] = [
  { id: 'meshy-7.1', label: 'Meshy 7.1 · 4K', provider: 'meshy', views: 4, cost: '$0.60',
    note: 'Default. Raw master, 4K PBR. We decimate ourselves.', wired: true },
  { id: 'meshy-7.1-2k', label: 'Meshy 7.1 · 2K', provider: 'meshy', views: 4, cost: '$0.60',
    note: 'Same geometry, 2K textures.', wired: true },
  { id: 'meshy-7.1-8k', label: 'Meshy 7.1 · 8K', provider: 'meshy', views: 4, cost: '$0.70',
    note: '8K textures. 35 credits, not 30.', wired: true },
  { id: 'meshy-7.1-geo2k', label: 'Meshy 7.1 · 2K geometry', provider: 'meshy', views: 4,
    cost: '$0.70', note: 'New 2026-09-18: denser raw geometry, +5 credits. Compare before trusting.',
    wired: true },
  { id: 'fal-hunyuan-3.1-pro', label: 'Hunyuan 3D 3.1 Pro', provider: 'fal', views: 8,
    cost: '$0.68', note: 'Up to 8 views, PBR, no monthly cap. Via fal.', wired: false },
  { id: 'fal-tripo-h3.1-multiview', label: 'Tripo H3.1 multiview', provider: 'fal', views: 4,
    cost: '—', note: 'Via fal.', wired: false },
  { id: 'fal-trellis-multi', label: 'Trellis multi-image', provider: 'fal', views: 4,
    cost: '—', note: 'Via fal. Open weights.', wired: false },
  { id: 'fal-meshy-7.1-multi', label: 'Meshy 7.1 via fal', provider: 'fal', views: 4,
    cost: '$1.20', note: 'Twice our Pro-plan price. Only if the Meshy plan runs out.',
    wired: false },
]

export const DEFAULT_ENGINE = 'meshy-7.1'

// ── The library ─────────────────────────────────────────────────────

export type LibraryItem = {
  id: string
  title: string
  dish: string
  state: 'draft' | 'approved' | 'rejected'
  archived: boolean
  glb: string
  usdz: string
  poster: string
  scale_cm: number | null
  scale_axis: string | null
  created_utc: string
  /** How many dishes, in how many restaurants, are using it right now. */
  usedBy: number
}

/** BetaReal's own models: tenant_id NULL (0030). Restaurant models that are borrowable
 *  are a different list - the "Shared" tab of a restaurant's 3D Studio - because they are
 *  still that restaurant's dish. */
export async function loadLibraryModels(): Promise<LibraryItem[]> {
  const supabase = createClient()
  const { data: rows } = await supabase.from('models')
    .select('id, title, dish, tenant_state, archived, draco_key, usdz_key, poster_key, ' +
            'external_glb, external_usdz, scale_cm, scale_axis, created_utc')
    .is('tenant_id', null)
    .order('created_utc', { ascending: false })
  type Row = {
    id: string; title: string | null; dish: string; tenant_state: LibraryItem['state']
    archived: boolean; draco_key: string | null; usdz_key: string | null
    poster_key: string | null; external_glb: string | null; external_usdz: string | null
    scale_cm: number | null; scale_axis: string | null; created_utc: string
  }
  const list = (rows || []) as unknown as Row[]
  const uses = new Map<string, number>()
  if (list.length) {
    const { data: items } = await supabase.from('items').select('model_id')
      .in('model_id', list.map(r => r.id))
    for (const i of (items || []) as { model_id: string }[]) {
      uses.set(i.model_id, (uses.get(i.model_id) || 0) + 1)
    }
  }
  return list.map(r => ({
    id: r.id,
    title: r.title || r.dish,
    dish: r.dish,
    state: r.tenant_state,
    archived: !!r.archived,
    glb: assetUrl(r.draco_key || r.external_glb),
    usdz: assetUrl(r.usdz_key || r.external_usdz),
    poster: assetUrl(r.poster_key),
    scale_cm: r.scale_cm,
    scale_axis: r.scale_axis,
    created_utc: r.created_utc,
    usedBy: uses.get(r.id) || 0,
  }))
}

export type LibraryRequest = {
  id: string
  title: string
  kind: 'generate' | 'rescale' | 'upload'
  state: 'pending' | 'approved' | 'running' | 'done' | 'failed' | 'cancelled'
  note: string
  engine: string | null
  engine_requested: string | null
  tenant_id: string | null
  requested_utc: string
  finished_utc: string | null
}

/** What developers have asked the engine for: everything aimed at the library, plus
 *  every upload into a restaurant, newest first. */
export async function loadDevRequests(): Promise<LibraryRequest[]> {
  const supabase = createClient()
  const { data } = await supabase.from('model_requests')
    .select('id, title, kind, state, note, engine, engine_requested, tenant_id, ' +
            'requested_utc, finished_utc')
    .or('tenant_id.is.null,kind.eq.upload')
    .order('requested_utc', { ascending: false })
    .limit(60)
  return (data || []) as unknown as LibraryRequest[]
}

/** Photos -> a model in the library. Same queue, bridge and engine as a restaurant's
 *  request; the only differences are no tenant and a chosen engine. */
export async function requestLibraryBuild(args: {
  title: string
  photoKeys: string[]
  dims: Dims
  engine: string
}) {
  const supabase = createClient()
  const { error } = await supabase.from('model_requests').insert({
    tenant_id: null, item_id: null, dish: crypto.randomUUID(), variant: 'default',
    title: args.title.trim(), photo_keys: args.photoKeys, kind: 'generate',
    engine_requested: args.engine === DEFAULT_ENGINE ? null : args.engine,
    width_cm: args.dims.width, length_cm: args.dims.length, height_cm: args.dims.height,
  })
  return error
}

/** A GLB we already have -> optimised -> a model, in the library or in one restaurant.
 *
 *  Into a restaurant, it lands as that restaurant's model (draft, like anything the
 *  engine makes for them - the owner's yes still decides, DECISIONS §9.4). Into the
 *  library it lands approved: the developer uploading it is the one judging it. */
export async function requestUploadOptimise(args: {
  rawKey: string
  title: string
  dims: Dims
  tenantId: string | null
}) {
  const supabase = createClient()
  const { error } = await supabase.from('model_requests').insert({
    tenant_id: args.tenantId, item_id: null, dish: crypto.randomUUID(), variant: 'default',
    title: args.title.trim(), photo_keys: [args.rawKey], kind: 'upload',
    width_cm: args.dims.width, length_cm: args.dims.length, height_cm: args.dims.height,
  })
  return error
}

/** A model shipped EXACTLY as uploaded - no decimation, no texture budget, no size baked
 *  in, no USDZ made. For a file that is already right: hand-finished in Blender, already
 *  optimised elsewhere, or a test of what the raw thing looks like on a phone.
 *
 *  No engine is involved, so this is a `models` row and not a request: it is on the menu
 *  the moment it is attached. Approved in both places, the rule `saveUploadedModel`
 *  follows - the developer uploading a finished file has judged it. A library row must
 *  be shared (0030); a restaurant row is that restaurant's.
 *
 *  Without a USDZ there is no iPhone AR for this model; the page says so before upload. */
export async function createAsIsModel(args: {
  glbKey: string
  usdzKey: string | null
  title: string
  tenantId: string | null
}) {
  const supabase = createClient()
  const { data, error } = await supabase.from('models').insert({
    tenant_id: args.tenantId,
    shared: args.tenantId === null,
    title: args.title.trim() || 'Uploaded model',
    dish: crypto.randomUUID(),
    variant: 'default',
    draco_key: args.glbKey,
    usdz_key: args.usdzKey,
    tenant_state: 'approved',
  }).select('id').single()
  return { id: (data as { id: string } | null)?.id ?? null, error }
}

export async function setLibraryState(id: string, state: 'approved' | 'rejected' | 'draft') {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('models').update({
    tenant_state: state,
    decided_utc: state === 'draft' ? null : new Date().toISOString(),
    decided_by: state === 'draft' ? null : user?.id ?? null,
  }).eq('id', id)
  return error
}

export async function renameLibraryModel(id: string, title: string) {
  const supabase = createClient()
  const { error } = await supabase.from('models').update({ title: title.trim() }).eq('id', id)
  return error
}

export async function archiveLibraryModel(id: string, archived: boolean) {
  const supabase = createClient()
  const { error } = await supabase.from('models').update({ archived }).eq('id', id)
  return error
}

// ── Uploading a raw model ───────────────────────────────────────────
//
// In parts, through /api/asset/multipart - see that route for why a 100 MB master cannot
// go through the one-shot upload. 8 MiB parts: over R2's 5 MiB minimum, and UNDER the
// 10 MB that Next's proxy buffers of a request body. 20 MiB was the first choice and every
// part arrived cut off at 10 MB ("Failed to parse body as FormData") - measured on
// 2026-09-28, not assumed. Raising `proxyClientMaxBodySize` instead would double-buffer
// every large upload inside a 128 MB Worker.

const PART = 8 * 1024 * 1024

async function post(body: unknown) {
  const res = await fetch('/api/asset/multipart', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((out as { error?: string }).error || `Upload failed (${res.status})`)
  return out
}

/** A GLB for the optimiser - the bridge adopts it as a master (kind 'upload'). */
export function uploadRawModel(file: File, onProgress: (fraction: number) => void) {
  return uploadModelFile(file, 'raw', onProgress)
}

/** Magic bytes, checked before a byte is sent: finding out after a 200 MB upload that
 *  somebody picked a .gltf renamed to .glb wastes minutes. A GLB starts with "glTF"; a
 *  USDZ is a zip and starts with "PK". */
async function checkMagic(file: File) {
  const head = new TextDecoder().decode(await file.slice(0, 4).arrayBuffer())
  if (/\.glb$/i.test(file.name)) {
    if (head !== 'glTF') throw new Error(`${file.name} is not a binary glTF file`)
  } else if (/\.usdz$/i.test(file.name)) {
    if (!head.startsWith('PK')) throw new Error(`${file.name} is not a USDZ package`)
  } else {
    throw new Error('Only .glb or .usdz files')
  }
}

export async function uploadModelFile(file: File, purpose: 'raw' | 'asis',
                                      onProgress: (fraction: number) => void) {
  if (purpose === 'raw' && !/\.glb$/i.test(file.name)) throw new Error('Only .glb files')
  await checkMagic(file)

  const { key, uploadId } = await post({
    action: 'create', filename: file.name, size: file.size,
    purpose: purpose === 'asis' ? 'asis' : 'optimise',
  })
  const parts: { partNumber: number; etag: string }[] = []
  const total = Math.max(1, Math.ceil(file.size / PART))
  try {
    for (let n = 1; n <= total; n++) {
      const chunk = file.slice((n - 1) * PART, Math.min(file.size, n * PART))
      let attempt = 0
      for (;;) {
        const form = new FormData()
        form.append('action', 'part')
        form.append('key', key)
        form.append('uploadId', uploadId)
        form.append('n', String(n))
        form.append('file', chunk, `part-${n}`)
        const res = await fetch('/api/asset/multipart', { method: 'POST', body: form })
        if (res.ok) { parts.push(await res.json()); break }
        if (++attempt >= 3) {
          const out = await res.json().catch(() => ({}))
          throw new Error((out as { error?: string }).error || `Part ${n} failed (${res.status})`)
        }
      }
      onProgress(n / total)
    }
    await post({ action: 'complete', key, uploadId, parts })
  } catch (e) {
    await post({ action: 'abort', key, uploadId }).catch(() => {})
    throw e
  }
  return key as string
}
