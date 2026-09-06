// The palette key -> CSS custom property map, a fourth time.
//
// `menu/render_theme_keys.py` has the key SET for the importer, `app/src/lib/theme.js` has
// this MAP for the renderer (it is the platform's own varMap, key for key), and
// `lib/paletteKeys.ts` has the set for telling a colour from a closing time.
//
// This is the one the preview needs: it posts custom properties into the real page, so the
// names have to be the renderer's names exactly or a value would be applied to nothing.
// `check_render.py` fails the build when any of them drift.

export const VAR_MAP: Record<string, string> = {
  bg: '--bg',
  bg2: '--bg2',
  card: '--card',
  card2: '--card2',
  border: '--border',
  text: '--text',
  dim: '--dim',
  accent: '--accent',
  accent2: '--accent2',
  accent_text: '--accent-text',
  thumb_bg: '--thumb-bg',
  modal_bg: '--modal-bg',
  glow: '--glow',
  glow2: '--glow2',
  shadow: '--shadow',
  bg_image: '--bg-image',
  bg_size: '--bg-size',
  bg_repeat: '--bg-repeat',
  card_bg: '--card-bg',
  card_blur: '--card-blur',
  card_radius: '--card-radius',
  item_shadow: '--item-shadow',
  item_hover_shadow: '--item-hover-shadow',
  accent_edge: '--accent-edge',
  stage_bg: '--stage-bg',
  thumb_vignette: '--thumb-vignette',
  pill_bg: '--pill-bg',
  pill_active_bg: '--pill-active-bg',
  cta_bg: '--cta-bg',
  cta_shadow: '--cta-shadow',
  hero_color: '--hero-color',
  hero_shadow: '--hero-shadow',
  divider_bg: '--divider-bg',
  hero_bg: '--hero-bg',
  cat_color: '--cat-color',
  panel_ink: '--panel-ink',
  modal_ink: '--modal-ink',
  modal_bg_image: '--modal-bg-image',
  badge_bg: '--badge-bg',
  price_color: '--price-color',
  add_btn_color: '--add-btn-color',
}
