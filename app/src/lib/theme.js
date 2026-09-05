// theme.js — a restaurant's palette, resolved on the server, into real CSS.
//
// The platform applies these at runtime with `style.setProperty`, after fetching
// theme_config - which is exactly the re-skin a diner watches happen. Here they are
// computed once at publish time and written into `<head>`, so the very first paint is
// already that restaurant's colours. There is no second state to flash to.
//
// `VAR_MAP` is the platform's own `varMap`, key for key. Renaming any of it would mean
// rewriting their CSS, which is the one thing we are not doing.

export const VAR_MAP = {
  bg: "--bg", bg2: "--bg2", card: "--card", card2: "--card2", border: "--border",
  text: "--text", dim: "--dim", accent: "--accent", accent2: "--accent2",
  accent_text: "--accent-text", thumb_bg: "--thumb-bg", modal_bg: "--modal-bg",
  glow: "--glow", glow2: "--glow2", shadow: "--shadow",
  bg_image: "--bg-image", bg_size: "--bg-size", bg_repeat: "--bg-repeat",
  card_bg: "--card-bg", card_blur: "--card-blur", card_radius: "--card-radius",
  item_shadow: "--item-shadow", item_hover_shadow: "--item-hover-shadow",
  accent_edge: "--accent-edge", stage_bg: "--stage-bg",
  thumb_vignette: "--thumb-vignette",
  pill_bg: "--pill-bg", pill_active_bg: "--pill-active-bg",
  cta_bg: "--cta-bg", cta_shadow: "--cta-shadow",
  hero_color: "--hero-color", hero_shadow: "--hero-shadow",
  divider_bg: "--divider-bg", hero_bg: "--hero-bg", cat_color: "--cat-color",
  panel_ink: "--panel-ink", modal_ink: "--modal-ink",
  modal_bg_image: "--modal-bg-image",
  badge_bg: "--badge-bg", price_color: "--price-color",
  add_btn_color: "--add-btn-color",
};

// A value here is a gradient, a colour, a length or a url() - never a selector and never
// a brace. Anything else is a restaurant owner's typing on its way into a <style> block,
// so it is dropped rather than cleaned: a half-sanitised gradient renders wrong, which is
// worse than a missing one falling back to the template's default.
const SAFE = /^[-#\w\s,.%()/'"+*]+$/;

/** `night_`/`day_` prefixed keys plus bare ones, mapped to CSS custom properties. */
export function themeCss(cfg = {}, mode = "night") {
  const other = mode === "day" ? "night_" : "day_";
  const want = `${mode}_`;
  const out = new Map();
  for (const [rawKey, value] of Object.entries(cfg)) {
    if (typeof value !== "string" || !value.trim()) continue;
    if (rawKey.startsWith(other)) continue;
    const key = rawKey.startsWith(want) ? rawKey.slice(want.length) : rawKey;
    const cssVar = VAR_MAP[key];
    if (!cssVar || !SAFE.test(value)) continue;
    out.set(cssVar, value.trim());
  }
  return [...out].map(([k, v]) => `${k}:${v}`).join(";");
}

/** Settings that reach CSS rather than markup: the hero art, its height, the fonts. */
export function settingsCss(cfg = {}) {
  const bits = [];
  const hero = cfg.hero_image_url;
  if (hero && /^[^"'\\\s]+$/.test(hero)) bits.push(`--hero-image:url("${hero}")`);
  if (/^[\d.]+(svh|vh|px|rem)$/.test(String(cfg.hero_min_h || ""))) {
    bits.push(`--mg-hero-h:${cfg.hero_min_h}`);
  }
  for (const [key, cssVar] of [["font_body", "--font-body"],
                               ["font_heading", "--font-heading"]]) {
    const v = cfg[key];
    if (v && SAFE.test(v)) bits.push(`${cssVar}:${String(v).replace(/[;{}]/g, "")}`);
  }
  return bits.join(";");
}

/** Google Fonts, preconnected and loaded without blocking the first paint.
 *
 *  A font that arrives late reflows text that a diner is already reading, so the stack
 *  always names a real fallback and the sheet is fetched with `media="print"` swapped to
 *  `all` on load - the standard trick for a non-blocking stylesheet. */
export function fontLinks(cfg = {}) {
  const families = [cfg.font_body, cfg.font_heading]
    .filter((f) => f && /^[\w\s-]{1,40}$/.test(f))
    .map((f) => `family=${encodeURIComponent(f)}:wght@400;500;600;700`);
  if (!families.length) return "";
  const href = `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
  return (
    '<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    `<link rel="stylesheet" href="${href}" media="print" onload="this.media='all'">` +
    `<noscript><link rel="stylesheet" href="${href}"></noscript>`
  );
}
