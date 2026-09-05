// render.mjs — a published snapshot becomes a complete page, in a chosen template.
//
// MENU-PLATFORM.md §2.1a, in Temo's words: "we want template and unique menu to be the og
// custom build for them where users dont have to wait for a website to load and then
// reload." The platform does the opposite - a generic page loads, JavaScript fetches the
// theme, and the diner watches it re-skin. Here the theme is computed at publish time and
// written into `<head>` before anything paints. There is no second state.
//
// ── What a template IS, which was the thing worth learning ───────────────────────────
//
// Reading the platform to replicate Monday Greens turned up that **a template is not a
// layout.** It is:
//
//   1. a PRESET - ~38 values (`night_card_bg`, `day_accent`, ...) mapped onto ~40 CSS
//      custom properties by `theme.mjs`;
//   2. optionally, a handful of `[data-template="name"]` rules for the few things a
//      palette cannot express;
//   3. the SAME markup and the same structural CSS as every other template.
//
// So "Monday Greens" is 38 numbers and 28 CSS rules over shared bones. That is why
// `extract_css.py` came back with 18 templates and `extract_presets.py` with 22 presets
// without either being written by hand - and it is what makes a new restaurant look a row
// of data rather than a branch in a 619 KB file (§2.2).
//
// ── The 3D and AR base ───────────────────────────────────────────────────────────────
//
// `ported/` holds the platform's own viewer, byte for byte: the 3D modal, the
// poster-to-live-thumbnail upgrade, AR routing, iOS Quick Look and the Three.js WebXR
// carousel. It is the BASE every template gets for free, because it is driven entirely by
// the card contract below - `.menu-item` / `.item-left` / `.thumb-wrap` /
// `.thumb-img[data-model]` / `data-global-idx`. A future custom template changes the
// palette and the rules; it does not touch the viewer, and it inherits AR by emitting
// these class names.
//
// `ported/shim.js` is the only adapter and the only file to edit.

import {
  FULL_CSS, VIEWER_HTML,
  XR_JS, SHIM_JS, VIEWER_JS, PAGE_JS,
  PRESETS,
} from "./ported.mjs";
import { themeVars, themeMode } from "./theme.mjs";
import { e, hero, header, catBar, menuList, toggles } from "./components.mjs";

export function renderMenu(snap, opts = {}) {
  // Keys, never URLs, live in the snapshot (§2.6) - the buckets are private and a baked
  // URL would be one that expires inside an object meant to be immutable.
  const asset = (key) => (key ? `${opts.assetBase || "/a"}/${key}` : null);
  const items = snap.items || [];
  const has3d = items.some((i) => i.model);
  const name = snap.tenant?.name || "Menu";

  const template = PRESETS[snap.template] ? snap.template : "";
  const preset = PRESETS[template] || {};
  const mode = themeMode(snap.theme, template, snap.settings || {});
  const vars = themeVars(preset, snap.theme, mode);

  // The index on a card is its index in the WHOLE menu, not its section. The ported
  // viewer navigates with it - modal arrows, the AR carousel - and it must match the
  // array shim.js builds, which it reads off these same cards in document order.
  const idxOf = new Map(items.map((it, i) => [it.id, i]));

  // Settings that have to reach CSS rather than markup. The platform sets these at
  // runtime with style.setProperty after fetching theme_config; here they are resolved
  // at publish time, which is the whole no-flash difference.
  const s = snap.settings || {};
  const heroImg = s.hero_image_url
    ? `    --hero-image: url("${String(s.hero_image_url).replace(/["\\]/g, "")}");`
    : "";
  const heroH = /^[\d.]+(svh|vh|px|rem)$/.test(String(s.hero_min_h || ""))
    ? `    --mg-hero-h: ${s.hero_min_h};`
    : "";
  const fonts =
    (s.font_body ? `    --font-body: ${String(s.font_body).replace(/[;{}]/g, "")};\n` : "") +
    (s.font_heading ? `    --font-heading: ${String(s.font_heading).replace(/[;{}]/g, "")};` : "");

  const primary = (snap.tenant?.languages || ["en"])[0];
  // Their stylesheet keys off these, not off a scheme of our own. `data-theme` in
  // particular selects the whole night/day half of every template, and naming it
  // `data-mode` (as an earlier version did) means none of those rules match at all.
  const attrs = [
    `data-template="${e(template)}"`,
    `data-theme="${e(mode)}"`,
    `data-tenant="${e(snap.tenant?.slug || "")}"`,
    `data-brand-slug="${e(snap.tenant?.slug || "")}"`,
    `data-phone-layout="${e(s.phone_layout || "list")}"`,
    s.hero_image_url ? 'data-hero-image="true"' : "",
    s.hero_image_url ? 'data-generic-hero="true"' : "",
  ].filter(Boolean).join(" ");

  return `<!doctype html>
<html lang="${e(primary)}" ${attrs}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${e(name)}</title>
<meta name="description" content="${e(name)} menu">
<style>
/* ── 1. the platform's ENTIRE stylesheet, verbatim ─────────────────────────────────
   Not a subset. CSS is order- and cascade-dependent, so a filtered stylesheet is a
   different stylesheet - which is how four separate "it renders but looks wrong" bugs
   happened before this file stopped being clever. See extract_css.py. */
${FULL_CSS}

/* ── 2. the restaurant's palette, resolved at PUBLISH time ────────────────────────
   LAST, so it beats the defaults their sheet ships. The platform sets these at runtime
   with style.setProperty after fetching theme_config, which is exactly the re-skin a
   diner watches happen; here they are already in the head before the first paint. */
:root {
${vars}
${heroImg}
${heroH}
${fonts}
}

/* ── 3. what this page does NOT have yet ────────────────────────────────────────── */
.qty-ctrl, #modal-qty-wrap, #basket-bar, #img-lightbox { display: none !important; }
</style>
</head>
<body>
${toggles(snap)}
${hero(snap)}
${header(snap)}
${catBar(snap)}
${menuList(snap, opts)}
${has3d ? VIEWER_HTML : ""}
${!has3d ? `<script>\n${PAGE_JS}\n</script>` : ""}
${
  has3d
    ? `<script>
${XR_JS}
</script>
<script>
${SHIM_JS}
</script>
<script>
${VIEWER_JS}
</script>
<script>
${PAGE_JS}
</script>
<script>
  /* Boot after first paint. Everything above only DEFINES things - nothing has touched
     the network or the GPU, and the menu is readable by the time this runs. */
  if (document.readyState === "complete") window.__bootViewer();
  else addEventListener("load", function () { window.__bootViewer(); }, { once: true });
</script>`
    : ""
}
</body>
</html>`;
}

// node render.mjs snapshot.json > out.html
if (process.argv[1] && process.argv[1].endsWith("render.mjs")) {
  const { readFileSync } = await import("node:fs");
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node render.mjs <snapshot.json|-> [assetBase]");
    process.exit(2);
  }
  // "-" is stdin, which is how preview.py and the checks call it - so they render with
  // this exact module rather than a copy of it.
  const snap = JSON.parse(readFileSync(path === "-" ? 0 : path, "utf8"));
  process.stdout.write(renderMenu(snap, { assetBase: process.argv[3] || "/a" }));
}
