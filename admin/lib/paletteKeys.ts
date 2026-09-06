// The palette key names, a third time.
//
// `menu/render_theme_keys.py` has them for the importer, `app/src/lib/theme.js` has them
// for the renderer as the platform's own varMap, and this is the copy the admin uses to
// tell a colour from a closing time. All three are the same set and `check_render.py`
// fails if they drift - a duplicated list that is CHECKED is safer here than a shared
// package, because the three consumers are three languages in two apps and the alternative
// is a build step between them.
//
// It matters because a restaurant's `theme_config` is one flat bag of ~104 keys mixing
// both kinds, and splitting it is the whole reason a theme editor can be a theme editor
// rather than a settings page with colours in it.

export const PALETTE_KEYS: ReadonlySet<string> = new Set([
  'bg',
  'bg2',
  'card',
  'card2',
  'border',
  'text',
  'dim',
  'accent',
  'accent2',
  'accent_text',
  'thumb_bg',
  'modal_bg',
  'glow',
  'glow2',
  'shadow',
  'bg_image',
  'bg_size',
  'bg_repeat',
  'card_bg',
  'card_blur',
  'card_radius',
  'item_shadow',
  'item_hover_shadow',
  'accent_edge',
  'stage_bg',
  'thumb_vignette',
  'pill_bg',
  'pill_active_bg',
  'cta_bg',
  'cta_shadow',
  'hero_color',
  'hero_shadow',
  'divider_bg',
  'hero_bg',
  'cat_color',
  'panel_ink',
  'modal_ink',
  'modal_bg_image',
  'badge_bg',
  'price_color',
  'add_btn_color',
])

/** A key may be bare or day_/night_ prefixed; the live restaurants carry 34 of each. */
export function isPaletteKey(key: string): boolean {
  return PALETTE_KEYS.has(key.replace(/^(day|night)_/, ''))
}
