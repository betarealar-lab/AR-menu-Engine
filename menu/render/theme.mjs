// theme.mjs — a template preset plus a tenant's overrides become CSS custom properties.
//
// This is the platform's theming model, reproduced rather than invented, because it is
// the thing that makes MENU-PLATFORM §2.2 possible: **a template is a palette, not a
// page.** One set of structural rules (`ported/menu.css`) consumes ~40 custom properties;
// a preset supplies them; a tenant overrides individual keys on top. Adding a restaurant
// look is then a row of data, never a per-tenant branch in a 619 KB file.
//
// Two things are ported exactly:
//
//   `VAR_MAP` is their `varMap` from index.html, key for key. A preset key like
//   `card_bg` becomes `--card-bg`, and every rule in menu.css already reads that name.
//   Renaming any of it would mean re-writing their CSS, which is the one thing we are
//   not doing.
//
//   The `night_` / `day_` prefixes. Every preset carries both palettes; the mode picks
//   one and the prefix is stripped before the map is applied.
//
// The difference from the platform: it applies these at RUNTIME with
// `style.setProperty`, after fetching theme_config - which is precisely the re-skin Temo
// objected to ("that shit takes time to load"). Here they are computed at publish time
// and written into the `<head>` before anything paints. Same variables, same CSS, no
// second state.

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

// A CSS value here is a gradient, a colour, a length or a url() - never a selector and
// never a brace. Anything else is a restaurant's typing finding its way into a <style>
// block, so it is dropped rather than sanitised: a half-cleaned gradient renders wrong,
// which is worse than a missing one falling back to the default in :root.
const SAFE_VALUE = /^[-#\w\s,.%()/'"+*]+$/;

/** Merge a preset with a tenant's own overrides and return `--var: value;` lines.
 *
 *  `mode` picks the night_/day_ half of the preset. A tenant key may be either prefixed
 *  (overriding one mode) or bare (overriding both), which is how the platform's theme
 *  editor writes them.
 */
export function themeVars(preset = {}, overrides = {}, mode = "day") {
  const other = mode === "day" ? "night_" : "day_";
  const want = mode + "_";
  const out = new Map();

  const take = (source) => {
    for (const [rawKey, value] of Object.entries(source || {})) {
      if (typeof value !== "string" || !value.trim()) continue;
      if (rawKey.startsWith(other)) continue;            // the palette we are not using
      const key = rawKey.startsWith(want) ? rawKey.slice(want.length) : rawKey;
      const cssVar = VAR_MAP[key];
      if (!cssVar) continue;                             // not a theming key
      if (!SAFE_VALUE.test(value)) continue;
      out.set(cssVar, value.trim());
    }
  };

  take(preset);      // the template
  take(overrides);   // the restaurant, on top

  return [...out].map(([k, v]) => `    ${k}: ${v};`).join("\n");
}

/** Which palette a tenant is on. Monday Greens is a daytime cafe and the platform
 *  defaults that template to the light one; everything else opens dark. Stored as a
 *  plain key so it is an editor toggle later, not a code change. */
export function themeMode(theme = {}, template = "") {
  const named = String(theme.mode || "").toLowerCase();
  if (named === "day" || named === "night") return named;
  return template === "monday_greens" ? "day" : "night";
}
