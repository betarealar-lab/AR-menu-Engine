// The theme screen's data layer.
//
// The platform stores a restaurant's look as ~104 rows in a `theme_config` key/value
// table, mixing two entirely different kinds of thing: 68 colours and 36 facts about the
// restaurant (address, hours, hero images, fonts, delivery links). We store the first in
// `tenants.theme` and the second in `tenants.settings`, both jsonb, both on the one row.
//
// The screen does not need to know that. It works on a flat `Record<string, string>` bag
// and always did, so loading merges the two and saving splits them again. Which side a key
// belongs on is `isPaletteKey`, the same rule `menu/import_tenant.py` used to split the
// live restaurants when they were imported.
//
// Two reasons the split is worth keeping rather than storing one blob:
//
//   A template supplies colours and a restaurant overrides them. Settings are never a
//   template's business, so a template change must not be able to touch an address.
//
//   The renderer resolves the palette into CSS custom properties at publish time and
//   writes them into <head> (app/src/lib/theme.js). It reads `theme`. Anything that is not
//   a colour sitting in there is a value that gets serialised into every page for nothing.

import { createClient } from '@/lib/supabase/client'
import { isPaletteKey } from '@/lib/paletteKeys'

export type ThemeConfig = Record<string, string>

export async function loadThemeConfig(tenantId: string): Promise<ThemeConfig> {
  const supabase = createClient()
  const { data } = await supabase.from('tenants')
    .select('theme, settings, template_id').eq('id', tenantId).single()
  if (!data) return {}

  return {
    ...((data.settings as ThemeConfig) || {}),
    ...((data.theme as ThemeConfig) || {}),
    // The platform keeps the chosen template in the same bag, as `template_key`. Ours is a
    // real column with a foreign meaning - it decides which stylesheet is served - so the
    // column is the truth and this is the copy the screen reads.
    template_key: (data.template_id as string) || '',
  }
}

export async function saveThemeConfig(tenantId: string, config: ThemeConfig) {
  const supabase = createClient()

  const theme: ThemeConfig = {}
  const settings: ThemeConfig = {}
  for (const [key, value] of Object.entries(config)) {
    // The camera angles moved onto `models` (0003_model_view): the angle describes how to
    // frame a mesh, so it travels with the mesh rather than being retyped for a second
    // dish. If one reaches this bag it is stale - dropping it is right, writing it back
    // would resurrect a key nothing reads.
    if (key.startsWith('item_view_')) continue
    if (key === 'template_key') continue
    if (typeof value !== 'string') continue
    ;(isPaletteKey(key) ? theme : settings)[key] = value
  }

  const patch: Record<string, unknown> = { theme, settings }
  const template = config.template_key
  if (template) {
    patch.template_id = template
    // Written to BOTH, because the renderer reads `template_key` out of settings the way
    // the live restaurants store it, and the column is what everything else joins on.
    // Neither can go stale while they are set together.
    settings.template_key = template
  }

  const { error } = await supabase.from('tenants').update(patch).eq('id', tenantId)
  return error
}

/** Which templates a restaurant may choose. Only listed ones, plus whichever it is already
 *  on - otherwise moving off an unlisted template would be a one-way door. */
export async function loadTemplates(currentId: string) {
  const supabase = createClient()
  const { data } = await supabase.from('templates')
    .select('id, name, listed').order('name')
  return (data || []).filter(t => t.listed || t.id === currentId)
}

/** Change the template and nothing else.
 *
 *  NOT saveThemeConfig with one key: that function writes both bags whole, which is right
 *  for the theme screen (it loaded the whole bag first) and destroys everything for a
 *  caller that only has one key. Setup did exactly that - picking a look wiped the
 *  restaurant's name, address and hours. This merges. */
export async function setTemplate(tenantId: string, templateId: string) {
  const supabase = createClient()
  const { data } = await supabase.from('tenants').select('settings').eq('id', tenantId).single()
  const settings = { ...((data?.settings as ThemeConfig) || {}), template_key: templateId }
  const { error } = await supabase.from('tenants')
    .update({ template_id: templateId, settings }).eq('id', tenantId)
  return error
}
