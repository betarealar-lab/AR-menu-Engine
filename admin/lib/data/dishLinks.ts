// Dish pages (0033): one public page per dish at /p/<token>, printed on flyers and posters.
//
// Reading is open to a restaurant's own members (RLS on dish_links). Every change - off,
// on, reroll, the restaurant-wide switch - is a super-admin FUNCTION in the database, so
// the UI hiding a button is never the only thing standing between a restaurant that
// stopped paying and a page that still works.

import { createClient } from '@/lib/supabase/client'

const menuOrigin = () => (process.env.NEXT_PUBLIC_MENU_ORIGIN || '').replace(/\/$/, '')
const assetUrl = (key: string | null | undefined) =>
  !key ? '' : key.startsWith('http') ? key : `${menuOrigin()}/a/${key}`

export type DishLink = {
  itemId: string
  token: string
  url: string
  active: boolean
  rotatedUtc: string | null
  name: string
  category: string
  photo: string
  has3d: boolean
  visible: boolean
}

export const dishPageUrl = (token: string) => `${menuOrigin()}/p/${token}`

export async function loadDishLinks(tenantId: string): Promise<{
  links: DishLink[]; pagesActive: boolean; error: string
}> {
  const supabase = createClient()
  const [l, i, c, e] = await Promise.all([
    supabase.from('dish_links').select('item_id, token, active, rotated_utc').eq('tenant_id', tenantId),
    supabase.from('items').select('id, name, category_id, photo_key, model_id, is_3d, visible, position')
      .eq('tenant_id', tenantId),
    supabase.from('categories').select('id, name, position').eq('tenant_id', tenantId),
    supabase.from('tenant_embed').select('pages_active').eq('tenant_id', tenantId).maybeSingle(),
  ])
  type L = { item_id: string; token: string; active: boolean; rotated_utc: string | null }
  type I = { id: string; name: string; category_id: string | null; photo_key: string | null
             model_id: string | null; is_3d: boolean; visible: boolean; position: number | null }
  type C = { id: string; name: string; position: number | null }
  const items = new Map(((i.data || []) as I[]).map(x => [x.id, x]))
  const cats = new Map(((c.data || []) as C[]).map(x => [x.id, x]))
  const links = ((l.data || []) as L[]).flatMap(r => {
    const it = items.get(r.item_id)
    if (!it) return []
    const cat = it.category_id ? cats.get(it.category_id) : undefined
    return [{
      itemId: r.item_id, token: r.token, url: dishPageUrl(r.token), active: r.active,
      rotatedUtc: r.rotated_utc, name: it.name, category: cat?.name || '',
      photo: assetUrl(it.photo_key), has3d: !!it.model_id && it.is_3d, visible: it.visible,
      _sort: [cat?.position ?? 1e9, it.position ?? 1e9] as [number, number],
    }]
  }).sort((a, b) => a._sort[0] - b._sort[0] || a._sort[1] - b._sort[1] || a.name.localeCompare(b.name))
    .map(({ _sort, ...rest }) => { void _sort; return rest })
  const pagesActive = (e.data as { pages_active?: boolean } | null)?.pages_active ?? true
  return { links, pagesActive, error: l.error?.message || i.error?.message || '' }
}

export async function setDishLinkActive(itemId: string, active: boolean) {
  const { error } = await createClient().rpc('set_dish_link_active', { p_item: itemId, p_active: active })
  return error?.message || ''
}

export async function rerollDishLink(itemId: string): Promise<{ token: string; error: string }> {
  const { data, error } = await createClient().rpc('reroll_dish_link', { p_item: itemId })
  return { token: (data as string) || '', error: error?.message || '' }
}

export async function setDishPagesActive(tenantId: string, active: boolean) {
  const { error } = await createClient().rpc('set_dish_pages_active', { p_tenant: tenantId, p_active: active })
  return error?.message || ''
}
