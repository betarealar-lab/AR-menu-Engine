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
  VIEWER_CSS, MENU_CSS, VIEWER_HTML,
  XR_JS, SHIM_JS, VIEWER_JS, PAGE_JS,
  TEMPLATE_CSS, PRESETS,
} from "./ported.mjs";
import { themeVars, themeMode } from "./theme.mjs";
import { e, hero, header, catBar, menuList, langBar } from "./components.mjs";

export function renderMenu(snap, opts = {}) {
  // Keys, never URLs, live in the snapshot (§2.6) - the buckets are private and a baked
  // URL would be one that expires inside an object meant to be immutable.
  const asset = (key) => (key ? `${opts.assetBase || "/a"}/${key}` : null);
  const items = snap.items || [];
  const has3d = items.some((i) => i.model);
  const name = snap.tenant?.name || "Menu";

  const template = snap.template && TEMPLATE_CSS[snap.template] !== undefined
    ? snap.template
    : (PRESETS[snap.template] ? snap.template : "");
  const preset = PRESETS[template] || {};
  const mode = themeMode(snap.theme, template);
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

  return `<!doctype html>
<html lang="${e(primary)}" data-template="${e(template)}" data-mode="${e(mode)}"
      data-tenant="${e(snap.tenant?.slug || "")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${e(name)}</title>
<meta name="description" content="${e(name)} menu">
<style>
/* ── 1. the structural menu, the platform's own ─────────────────────────────────
   This carries their DEFAULT :root palette too, which is why it comes first: a template
   that omits a variable must fall back to something sensible rather than to nothing. */
${MENU_CSS}

/* ── 2. this template's own rules ───────────────────────────────────────────────── */
${(template && TEMPLATE_CSS[template]) || ""}

/* ── 3. the 3D + AR layer, only when the menu has 3D on it ──────────────────────── */
${has3d ? VIEWER_CSS : ""}

/* ── 4. the restaurant's palette, resolved at PUBLISH time ──────────────────────
   LAST, and that placement is load-bearing: menu.css ships its own :root defaults, and
   an earlier version put this block first, so every default quietly overrode the
   template. The page came out with no background at all and the cause was ordering, not
   a missing variable.

   The platform sets these at runtime with style.setProperty after fetching theme_config,
   which is exactly the re-skin a diner watches happen. Same variables, same CSS, written
   before the first paint instead of after it. */
:root {
${vars}
${heroImg}
${heroH}
${fonts}
}

/* ── 5. what this page does NOT have yet ────────────────────────────────────────
   No basket and no photo lightbox in the self-serve menu (see ported/shim.js), so the
   controls that would drive them must not offer themselves. */
.qty-ctrl, #modal-qty-wrap, #basket-bar, #img-lightbox { display: none !important; }
</style>
</head>
<body>
${hero(snap)}
${header(snap)}
${langBar(snap)}
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
