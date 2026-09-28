// The whole BetaReal library: every model, whose it is, and where it is used.
//
// Temo, 2026-09-28: "every model is betareal's on default, it is then assigned to a
// restaurant. if it is made in a restaurant's 3D studio then it is automatically the
// restaurant's. but every model is visible on betareal library." And its QRs and links
// belong there too, not only on each restaurant's Dish pages screen.
//
// So this reads EVERY model (a super admin reads all of them through is_member_of), with:
//   owner    NULL = BetaReal's (0030), else the restaurant it was made for or assigned to
//   uses     every dish, in any restaurant, that points at it - with that dish's page
//            address and switch (0033), when the dish is really 3D (0035)
//
// Ownership and sharing are separate on purpose. Every model is shared (0027) - borrowable
// by any restaurant - whoever owns it. Assigning a model to a restaurant makes it that
// restaurant's (it appears in their 3D Studio as theirs); it does not take it away from
// other restaurants already using it.

import { createClient } from '@/lib/supabase/client'
import { dishPageUrl } from '@/lib/data/dishLinks'

const menuOrigin = () => (process.env.NEXT_PUBLIC_MENU_ORIGIN || '').replace(/\/$/, '')
const assetUrl = (key: string | null | undefined) =>
  !key ? '' : key.startsWith('http') ? key : `${menuOrigin()}/a/${key}`

export type ModelUse = {
  itemId: string
  tenantId: string
  tenantName: string
  dishName: string
  /** The dish shows this model as 3D: `is_3d` on, and the model approved. */
  live3d: boolean
  visible: boolean
  /** The dish page, when there is one to show (3D dishes only - 0035). */
  link: { token: string; url: string; active: boolean } | null
  pagesActive: boolean
}

export type LibModel = {
  id: string
  title: string
  ownerId: string | null
  ownerName: string
  state: 'draft' | 'approved' | 'rejected'
  archived: boolean
  glb: string
  usdz: string
  poster: string
  scaleCm: number | null
  scaleAxis: string | null
  createdUtc: string
  uses: ModelUse[]
}

export type TenantLite = { id: string; name: string; slug: string }

/** In chunks: a PostgREST `in.(...)` filter rides in the URL, and a library of a few
 *  thousand models would exceed what a URL can carry. */
async function inChunks<T>(ids: string[], run: (chunk: string[]) => PromiseLike<{ data: unknown }>) {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await run(ids.slice(i, i + 150))
    out.push(...((data || []) as T[]))
  }
  return out
}

export async function loadAllModels(): Promise<{ models: LibModel[]; tenants: TenantLite[]; error: string }> {
  const supabase = createClient()
  const [m, t, e] = await Promise.all([
    supabase.from('models')
      .select('id, tenant_id, title, dish, tenant_state, archived, draco_key, usdz_key, poster_key, ' +
              'external_glb, external_usdz, scale_cm, scale_axis, created_utc')
      .order('created_utc', { ascending: false }),
    supabase.from('tenants').select('id, name, slug').order('name'),
    supabase.from('tenant_embed').select('tenant_id, pages_active'),
  ])
  if (m.error) return { models: [], tenants: [], error: m.error.message }

  type M = { id: string; tenant_id: string | null; title: string | null; dish: string
             tenant_state: LibModel['state']; archived: boolean; draco_key: string | null
             usdz_key: string | null; poster_key: string | null; external_glb: string | null
             external_usdz: string | null; scale_cm: number | null; scale_axis: string | null
             created_utc: string }
  type I = { id: string; tenant_id: string; name: string; is_3d: boolean; visible: boolean; model_id: string }
  type L = { item_id: string; token: string; active: boolean }

  const rows = (m.data || []) as unknown as M[]
  const tenants = (t.data || []) as TenantLite[]
  const tName = new Map(tenants.map(x => [x.id, x.name]))
  const pagesOff = new Set(((e.data || []) as { tenant_id: string; pages_active: boolean }[])
    .filter(x => x.pages_active === false).map(x => x.tenant_id))

  const items = await inChunks<I>(rows.map(r => r.id), c =>
    supabase.from('items').select('id, tenant_id, name, is_3d, visible, model_id').in('model_id', c))
  const links = await inChunks<L>(items.map(i => i.id), c =>
    supabase.from('dish_links').select('item_id, token, active').in('item_id', c))
  const linkBy = new Map(links.map(l => [l.item_id, l]))
  const approved = new Set(rows.filter(r => r.tenant_state === 'approved').map(r => r.id))

  const usesBy = new Map<string, ModelUse[]>()
  for (const it of items) {
    const live3d = it.is_3d && approved.has(it.model_id)
    const l = linkBy.get(it.id)
    const use: ModelUse = {
      itemId: it.id, tenantId: it.tenant_id, tenantName: tName.get(it.tenant_id) || '',
      dishName: it.name, live3d, visible: it.visible,
      link: live3d && l ? { token: l.token, url: dishPageUrl(l.token), active: l.active } : null,
      pagesActive: !pagesOff.has(it.tenant_id),
    }
    usesBy.set(it.model_id, [...(usesBy.get(it.model_id) || []), use])
  }

  const models = rows.map(r => ({
    id: r.id,
    title: r.title || r.dish,
    ownerId: r.tenant_id,
    ownerName: r.tenant_id ? tName.get(r.tenant_id) || 'a restaurant' : 'BetaReal',
    state: r.tenant_state,
    archived: !!r.archived,
    glb: assetUrl(r.draco_key || r.external_glb),
    usdz: assetUrl(r.usdz_key || r.external_usdz),
    poster: assetUrl(r.poster_key),
    scaleCm: r.scale_cm, scaleAxis: r.scale_axis,
    createdUtc: r.created_utc,
    uses: (usesBy.get(r.id) || []).sort((a, b) => a.tenantName.localeCompare(b.tenantName)),
  }))
  return { models, tenants, error: '' }
}

/** Make a model a restaurant's, or give it back to BetaReal (NULL).
 *
 *  `shared` stays true either way: every model is in the library (0027), and a library
 *  model must be shared (0030). Dishes in OTHER restaurants that already use it keep it. */
export async function assignModel(modelId: string, tenantId: string | null) {
  const { error } = await createClient().from('models')
    .update({ tenant_id: tenantId, shared: true }).eq('id', modelId)
  if (error?.code === '23505') {
    return 'That restaurant already has a model for this dish and variant. Rename one of them first.'
  }
  return error?.message || ''
}

/** A restaurant's dishes, for "put this model on a dish". */
export async function loadDishesOf(tenantId: string) {
  const { data } = await createClient().from('items')
    .select('id, name, model_id').eq('tenant_id', tenantId).order('name')
  return (data || []) as { id: string; name: string; model_id: string | null }[]
}
