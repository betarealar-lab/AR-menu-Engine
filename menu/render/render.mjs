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
  XR_JS, SHIM_JS, VIEWER_JS,
  TEMPLATE_CSS, PRESETS,
} from "./ported.mjs";
import { themeVars, themeMode } from "./theme.mjs";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** A menu is a stranger's typing the moment self-serve exists: dish names and
 *  descriptions are written by a restaurant we have never met and land in HTML. */
const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** 1250 -> "12.50". Integer minor units to the last possible moment, because 12.30 as a
 *  float is 12.299999999999999 and a menu that disagrees with the till by a tetri is a
 *  menu nobody trusts. */
const money = (minor, currency) => {
  const sym = { GEL: "₾", USD: "$", EUR: "€", GBP: "£" }[currency] || "";
  return `${sym}${(Math.round(minor) / 100).toFixed(2)}`;
};

/** Grouped for display without a query. The snapshot arrives ordered, so this is a
 *  partition - the ordering decision was made once, at publish time. */
const group = (snap) => {
  const cats = snap.categories || [];
  const byId = new Map(cats.map((c) => [c.id, { ...c, items: [] }]));
  const loose = { id: null, name: "", items: [] };
  for (const it of snap.items || []) {
    (byId.get(it.category_id) || loose).items.push(it);
  }
  const out = [...byId.values()].filter((c) => c.items.length);
  if (loose.items.length) out.push(loose);
  return out;
};

export function renderMenu(snap, opts = {}) {
  // Keys, never URLs, live in the snapshot (§2.6) - the buckets are private and a baked
  // URL would be one that expires inside an object meant to be immutable.
  const asset = (key) => (key ? `${opts.assetBase || "/a"}/${key}` : null);
  const items = snap.items || [];
  const sections = group(snap);
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

  // ── the card contract ───────────────────────────────────────────────────────────
  // This markup is the platform's, element for element and class for class, because
  // `_startThumbUpgrades` queries `.thumb-img[data-model]`, `_upgradeThumb` reads
  // `dataset.globalIdx` and closes over `.thumb-wrap`, and the whole of menu.css is
  // written against `.item-left` / `.item-right` / `.item-actions`. Renaming anything
  // here is a silent break, not a style choice.
  const card = (it) => {
    const m = it.model;
    const i = idxOf.get(it.id);
    const poster = asset(it.photo || m?.poster);
    const glb = m ? asset(m.draco) : null;
    const usdz = m?.usdz ? asset(m.usdz) : null;
    const noImage = !m && !poster;
    const price = money(it.price_minor, it.currency);

    // Everything the viewer needs travels on the element: no lookup, no second request,
    // nothing fetched before a diner can tap a dish.
    const data =
      ` data-idx="${i}" data-name="${e(it.name)}"` +
      ` data-desc="${e(it.description || "")}" data-price="${e(price)}"` +
      (glb ? ` data-glb="${e(glb)}"` : "") +
      (usdz ? ` data-usdz="${e(usdz)}"` : "") +
      (poster ? ` data-poster="${e(poster)}"` : "") +
      (m?.orbit ? ` data-orbit="${e(m.orbit)}"` : "") +
      (m?.scale_cm
        ? ` data-cm="${e(m.scale_cm)}" data-axis="${e(m.scale_axis || "width")}"`
        : "");

    const left = noImage ? "" : `<div class="item-left">
              <div class="thumb-wrap">
                <img class="thumb-img"${poster ? ` src="${e(poster)}"` : ""}${
                  glb ? ` data-model="${e(glb)}"` : ""
                } data-global-idx="${i}" alt="${e(it.name)}" loading="lazy" decoding="async">
                <div class="thumb-vignette"></div>
                ${m ? '<span class="badge-3d">3D</span>' : ""}
              </div>
            </div>`;

    return `
          <div class="menu-item${noImage ? " no-image" : ""}"${data}>
            <p class="item-name" data-field="name" data-idx="${i}">${e(it.name)}</p>
            ${left}
            <div class="item-right">
              <p class="ingredients" data-field="description" data-idx="${i}">${
                e(it.description || "")
              }</p>
              <div class="item-actions">
                <p class="price">${e(price)}</p>
              </div>
              ${m ? `<button class="ar-btn" data-idx="${i}">View 3D</button>` : ""}
            </div>
          </div>`;
  };

  const hero = `<div class="mg-hero">
      <h1 class="hero-title">${e(name)}</h1>
    </div>`;

  return `<!doctype html>
<html lang="en" data-template="${e(template)}" data-mode="${e(mode)}">
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
}

/* ── 5. what this page does NOT have yet ────────────────────────────────────────
   No basket and no photo lightbox in the self-serve menu (see ported/shim.js), so the
   controls that would drive them must not offer themselves. */
.qty-ctrl, #modal-qty-wrap, #basket-bar, #img-lightbox { display: none !important; }
</style>
</head>
<body>
${hero}
<main id="menu">
${sections
  .map((s) => `  <section class="menu-section">
    ${s.name ? `<h2 class="section-title">${e(s.name)}</h2>` : ""}
${s.items.map(card).join("")}
  </section>`)
  .join("\n")}
</main>
<footer class="menu-footer">${e(name)} &middot; v${e(snap.version ?? "?")}</footer>
${has3d ? VIEWER_HTML : ""}
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
