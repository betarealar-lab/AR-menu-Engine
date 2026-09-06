// The menu screen's data layer. New schema underneath, the shape the screen already
// speaks on top.
//
// The platform's menu page is 1,222 lines of working UI - six filters, quality flags for
// missing translations and prices, drink categories, per-item camera views. Rewriting all
// of that to change where the data comes from would be the expensive kind of mistake. So
// the component keeps its view-model and every query lives here.
//
// This is a VIEW-MODEL, not a compatibility shim, and the difference matters. Nothing in
// the database is shaped like the old schema; there is no view called `menu_items` and no
// trigger pretending there is. The mapping is explicit, in one file, and when a screen is
// ready to speak the new shape natively it stops calling these and nothing else moves.
//
//   menu_items          ->  items
//   name_en / name_ka   ->  name + i18n->'ka'->>'name'   (a language bag, not two columns)
//   price "16 ₾"        ->  price_minor, or price_text where a number cannot say it
//   model / model_usdz  ->  models.draco_key / usdz_key, through items.model_id
//   sort_order          ->  position
//   restaurant_id       ->  tenant_id
//   theme_config rows   ->  tenants.settings and tenants.theme (jsonb, one row)
//
// Every call here goes through the browser client, as the signed-in user, so RLS is what
// decides whether any of it is allowed.

import { createClient } from '@/lib/supabase/client'

export type Category = { id: string; name_en: string; name_ka: string; sort_order: number }

export type MenuItem = {
  id: string
  name_en: string; name_ka: string
  description_en: string; description_ka: string
  price: string
  category_id: string | null
  model: string; model_usdz: string
  sort_order: number
  visible: boolean
  ar_scale: number
  thumbnail_url: string
  thumb_3d: boolean
  is_3d: boolean
  text_only: boolean
  featured: boolean
  /** Not in the platform's shape. The library is pointers, not copies (MENU-PLATFORM §3),
   *  so the screen needs the id to change which model a dish points at. */
  model_id: string | null
  variants: { [lang: string]: string }[]
}

export type MenuSettings = {
  phoneLayout: 'list' | 'twin'
  spinEnabled: boolean
  drinkCategories: string | null
  itemViews: Record<string, string>
}

/** A private R2 key is served by the MENU APP, which owns the buckets, the cache headers
 *  and the CORS a 3D viewer needs. The admin is a different origin, so a bare `/a/<key>`
 *  would 404 here - it has to be absolute. An absolute URL is left alone: the live
 *  restaurants still carry r2.dev links in their imported data. */
const assetUrl = (key: string | null | undefined) =>
  !key ? '' : key.startsWith('http') ? key
    : `${process.env.NEXT_PUBLIC_MENU_ORIGIN || ''}/a/${key}`

/** Minor units to what a person reads. `price_text` wins when it is set, because a dish
 *  priced "16 / 70" is a dish no integer can describe. */
function priceText(row: { price_minor: number | null; price_text: string | null }) {
  if (row.price_text) return row.price_text
  if (!row.price_minor) return ''
  return `${(row.price_minor / 100).toFixed(2).replace(/\.00$/, '')} ₾`
}

/** ...and back. Anything that is not a plain number is kept as text rather than rounded
 *  into something wrong: a menu that disagrees with the till is a menu nobody trusts. */
export function parsePrice(text: string): { price_minor: number; price_text: string | null } {
  const cleaned = text.trim().replace(',', '.')
  const plain = cleaned.replace(/[^\d.]/g, '')
  const looksSimple = /^\d+(\.\d{1,2})?\s*₾?$/.test(cleaned) && plain !== ''
  if (!looksSimple) return { price_minor: 0, price_text: cleaned || null }
  return { price_minor: Math.round(parseFloat(plain) * 100), price_text: null }
}

/** What one row of the joined query actually holds.
 *
 *  Written out rather than inferred: without generated database types, supabase-js cannot
 *  type an embedded resource and falls back to an error type, so every field access below
 *  becomes a compile error that says nothing about the real shape. Declaring it here also
 *  means a column renamed in a migration breaks the build in ONE place. */
type ItemRow = {
  id: string
  name: string | null
  description: string | null
  i18n: Record<string, { name?: string; description?: string }> | null
  price_minor: number | null
  price_text: string | null
  category_id: string | null
  position: number | null
  visible: boolean
  photo_key: string | null
  model_id: string | null
  is_3d: boolean
  thumb_3d: boolean
  text_only: boolean
  featured: boolean
  variants: { [lang: string]: string }[] | null
  // PostgREST returns an embedded one-to-one as an object, but has returned an array in
  // past versions and still does for some shapes. Both are handled at the call site.
  models: { id: string; draco_key: string | null; usdz_key: string | null
            view_orbit: string | null; scale_cm: number | null } | null
}

type CategoryRow = {
  id: string
  name: string | null
  i18n: Record<string, string> | null
  position: number | null
}

export async function loadMenu(tenantId: string) {
  const supabase = createClient()

  const [{ data: cats }, { data: rows }, { data: tenant }] = await Promise.all([
    supabase.from('categories')
      .select('id, name, i18n, position')
      .eq('tenant_id', tenantId).order('position'),
    // One join instead of a second round trip: the model's keys and its camera angle
    // travel with the dish that points at them.
    supabase.from('items')
      .select('id, name, description, i18n, price_minor, price_text, category_id, ' +
              'position, visible, photo_key, model_id, is_3d, thumb_3d, text_only, ' +
              'featured, variants, ' +
              'models ( id, draco_key, usdz_key, view_orbit, scale_cm )')
      .eq('tenant_id', tenantId).order('position'),
    // Four theme_config lookups in the platform collapse to one row here.
    supabase.from('tenants').select('settings').eq('id', tenantId).single(),
  ])

  const categories: Category[] = ((cats || []) as unknown as CategoryRow[]).map(c => ({
    id: c.id,
    name_en: c.name || '',
    name_ka: (c.i18n as Record<string, string> | null)?.ka || '',
    sort_order: c.position ?? 0,
  }))

  const rowList = (rows || []) as unknown as ItemRow[]

  const items: MenuItem[] = rowList.map(r => {
    const ka = r.i18n?.ka || {}
    const model = Array.isArray(r.models) ? r.models[0] : r.models
    return {
      id: r.id,
      name_en: r.name || '',
      name_ka: ka.name || '',
      description_en: r.description || '',
      description_ka: ka.description || '',
      price: priceText(r),
      category_id: r.category_id,
      model: assetUrl(model?.draco_key),
      model_usdz: assetUrl(model?.usdz_key),
      sort_order: r.position ?? 0,
      visible: !!r.visible,
      // Real-world size is baked into the shipped file, not applied by the viewer, so this
      // is always 1. Kept because the platform's UI reads it.
      ar_scale: 1,
      thumbnail_url: assetUrl(r.photo_key),
      thumb_3d: !!r.thumb_3d,
      is_3d: !!r.is_3d,
      text_only: !!r.text_only,
      featured: !!r.featured,
      model_id: r.model_id,
      variants: r.variants || [],
    }
  })

  const s = (tenant?.settings as Record<string, string> | null) || {}
  const settings: MenuSettings = {
    phoneLayout: s.phone_layout === 'twin' ? 'twin' : 'list',
    spinEnabled: /^(1|true|on|yes)$/i.test(String(s.spin_enabled ?? '')),
    drinkCategories: s.drink_categories ?? null,
    // The angle lives on the MODEL now, not on the item (0003_model_view): it describes
    // how to frame a mesh, and attaching that mesh to a second dish should carry the
    // framing with it. Keyed by item id here only because that is what the screen expects.
    itemViews: Object.fromEntries(
      rowList
        .map(r => {
          const m = Array.isArray(r.models) ? r.models[0] : r.models
          return m?.view_orbit ? [r.id, m.view_orbit] : null
        })
        .filter(Boolean) as [string, string][],
    ),
  }

  return { categories, items, settings }
}

export async function saveItem(
  tenantId: string,
  id: string | null,
  form: Omit<MenuItem, 'id'>,
) {
  const supabase = createClient()
  const price = parsePrice(form.price)

  const i18n: Record<string, { name?: string; description?: string }> = {}
  if (form.name_ka.trim() || form.description_ka.trim()) {
    i18n.ka = {}
    if (form.name_ka.trim()) i18n.ka.name = form.name_ka.trim()
    if (form.description_ka.trim()) i18n.ka.description = form.description_ka.trim()
  }

  const row = {
    tenant_id: tenantId,
    name: form.name_en.trim(),
    description: form.description_en.trim(),
    ...price,
    category_id: form.category_id || null,
    position: form.sort_order ?? 0,
    visible: form.visible,
    is_3d: form.is_3d,
    thumb_3d: form.thumb_3d,
    text_only: form.text_only,
    featured: form.featured,
    model_id: form.model_id || null,
    i18n,
    variants: form.variants || [],
  }

  if (id) {
    const { error } = await supabase.from('items').update(row).eq('id', id)
    return { id, error }
  }
  const { data, error } = await supabase.from('items').insert(row).select('id').single()
  return { id: data?.id ?? null, error }
}

export async function deleteItem(id: string) {
  const supabase = createClient()
  const { error } = await supabase.from('items').delete().eq('id', id)
  return error
}

export async function saveCategory(
  tenantId: string,
  id: string | null,
  form: { name_en: string; name_ka: string; sort_order: number },
) {
  const supabase = createClient()
  const row = {
    tenant_id: tenantId,
    name: form.name_en.trim(),
    i18n: form.name_ka.trim() ? { ka: form.name_ka.trim() } : {},
    position: form.sort_order ?? 0,
  }
  if (id) {
    const { error } = await supabase.from('categories').update(row).eq('id', id)
    return { id, error }
  }
  const { data, error } = await supabase.from('categories')
    .insert(row).select('id').single()
  return { id: data?.id ?? null, error }
}

/** Deleting a category keeps its dishes: the foreign key is `on delete set null`, so they
 *  fall into "no category" and can be re-filed. Tidying up must not be able to destroy a
 *  morning's typing. */
export async function deleteCategory(id: string) {
  const supabase = createClient()
  const { error } = await supabase.from('categories').delete().eq('id', id)
  return error
}

/** Settings that are not colours: which of them exist is `app/src/lib/fields.js`, and the
 *  menu app reads exactly these keys. Merged, never replaced - this screen must not be
 *  able to wipe the palette. */
export async function saveSettings(tenantId: string, patch: Record<string, string>) {
  const supabase = createClient()
  const { data: row } = await supabase.from('tenants')
    .select('settings').eq('id', tenantId).single()
  const settings = { ...((row?.settings as Record<string, string>) || {}), ...patch }
  for (const [k, v] of Object.entries(patch)) if (!v) delete settings[k]
  const { error } = await supabase.from('tenants').update({ settings }).eq('id', tenantId)
  return error
}

/** The starting camera angle, onto the MODEL the dish points at. A dish with no model has
 *  nothing to frame, which the screen should not let happen but the data layer must not
 *  assume. */
export async function saveItemView(modelId: string | null, orbit: string) {
  if (!modelId) return null
  const supabase = createClient()
  const { error } = await supabase.from('models')
    .update({ view_orbit: orbit || null }).eq('id', modelId)
  return error
}

/** The whole list at once. Moving one dish changes several positions, and a half-applied
 *  reorder is a menu with two dishes claiming third place. */
export async function reorder(table: 'items' | 'categories', ids: string[]) {
  const supabase = createClient()
  for (let i = 0; i < ids.length; i++) {
    const { error } = await supabase.from(table).update({ position: i }).eq('id', ids[i])
    if (error) return error
  }
  return null
}
