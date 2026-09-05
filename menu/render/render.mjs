// render.mjs — a published snapshot becomes a complete page. No database, no re-skin.
//
// This is MENU-PLATFORM.md §2.1a, in Temo's own words: "we want template and unique menu
// to be the og custom build for them where users dont have to wait for a website to load
// and then reload."
//
// What the platform does today is the opposite. One generic index.html loads, JavaScript
// fetches the tenant's theme, and the page re-skins itself in front of the diner. Three
// states: blank, generic, branded. The middle one is the bug, and it is architectural.
//
// So this is a PURE FUNCTION: (snapshot, options) -> a complete HTML document, with the
// template's CSS and the restaurant's colours already inside <head> and every dish
// already in the markup. The first bytes the browser receives are that restaurant's
// menu. There is no second state to flash to, because there is no first state.
//
// Pure for a second reason (§2.2): the admin app's preview calls THIS function, and so
// does the live page. Not a reimplementation of it - it. Two implementations drift, and
// the day they do, an owner approves a preview that is not what diners get.
//
// ── The 3D and AR are PRODUCTION'S, not a rewrite ────────────────────────────────────
//
// An earlier version of this file reimplemented the viewer from reading the platform's
// source. It did not work, and Temo was right to reject it: "why not just copy the
// existing systems." A rewrite of something that already works on real phones in real
// restaurants is a downgrade however clean it looks.
//
// So `menu/render/ported/` holds the platform's own code, byte for byte - the 3D modal,
// the poster-to-live-thumbnail upgrade, the AR routing, iOS Quick Look, and the Three.js
// WebXR carousel. `ported/shim.js` is the only adapter: it supplies the nine symbols that
// code expects from the app it was lifted out of. `build_ported.py` turns them into
// `ported.mjs` so a Worker needs no filesystem.
//
// The consequence for THIS file is that the card markup must be the markup their code
// expects - `.menu-item` / `.thumb-wrap` / `.thumb-img[data-model]` - rather than a shape
// of our own. That is the right trade: their selectors are the contract, and matching
// them is what lets the code stay unedited.

import {
  VIEWER_CSS,
  VIEWER_HTML,
  XR_JS,
  SHIM_JS,
  VIEWER_JS,
} from "./ported.mjs";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Everything interpolated below goes through this. A dish called Chicken & <b>Chips</b>
 *  is a restaurant's typing, not markup, and a menu is user-generated content the moment
 *  self-serve exists. */
const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** 1250 -> "12.50". Integer minor units to the last possible moment, because 12.30 as a
 *  float is 12.299999999999999 and a menu that disagrees with the till by a tetri is a
 *  menu nobody trusts. */
const money = (minor, currency) => {
  const sym = { GEL: "₾", USD: "$", EUR: "€", GBP: "£" }[currency] || "";
  return `${sym}${(Math.round(minor) / 100).toFixed(2)}`;
};

/** Theme values become CSS custom properties, inline, in the head.
 *
 *  Filtered hard, because a theme is data a restaurant owner typed and it is being
 *  written into a style block. A value like `red; } body { display:none } .a{` would
 *  otherwise be a CSS injection with a very boring but very effective payload. */
const themeCss = (theme = {}) => {
  const safeKey = /^[a-z0-9_]{1,40}$/i;
  const safeVal = /^[a-zA-Z0-9 ,.'"()#%\/_-]{1,120}$/;
  return Object.entries(theme)
    .filter(([k, v]) => safeKey.test(k) && typeof v === "string" && safeVal.test(v))
    .map(([k, v]) => `    --${k.replace(/_/g, "-")}: ${v};`)
    .join("\n");
};

/** Grouped for display without a query. The snapshot arrives already ordered, so this is
 *  a partition, not a sort - the ordering decision was made once, at publish time. */
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
  const sections = group(snap);
  const items = snap.items || [];
  const has3d = items.some((i) => i.model);
  const name = snap.tenant?.name || "Menu";

  // The index a card carries is its index in the WHOLE menu, not in its section. The
  // ported viewer navigates with it (modal arrows, the AR carousel), so it has to match
  // the array shim.js builds - which it reads off these same cards, in document order.
  const idxOf = new Map(items.map((it, i) => [it.id, i]));

  const card = (it) => {
    const m = it.model;
    const i = idxOf.get(it.id);
    const poster = asset(it.photo || m?.poster);
    const glb = m ? asset(m.draco) : null;
    const usdz = m?.usdz ? asset(m.usdz) : null;
    // Everything the viewer needs travels on the element: no lookup, no second request,
    // nothing to fetch before a diner can tap a dish. shim.js reads these back into the
    // item shape production's code expects.
    const data =
      ` data-idx="${i}" data-name="${e(it.name)}"` +
      ` data-desc="${e(it.description || "")}"` +
      ` data-price="${e(money(it.price_minor, it.currency))}"` +
      (glb ? ` data-glb="${e(glb)}"` : "") +
      (usdz ? ` data-usdz="${e(usdz)}"` : "") +
      (poster ? ` data-poster="${e(poster)}"` : "") +
      (m?.orbit ? ` data-orbit="${e(m.orbit)}"` : "") +
      (m?.scale_cm
        ? ` data-cm="${e(m.scale_cm)}" data-axis="${e(m.scale_axis || "width")}"`
        : "");

    // `.thumb-wrap` / `.thumb-img[data-model]` / `data-global-idx` are the platform's own
    // selectors. `_startThumbUpgrades` queries exactly this and `_upgradeThumb` reads
    // exactly these attributes, so the markup is a contract - not a style choice.
    const thumb =
      m || poster
        ? `<div class="thumb-wrap">
            <img class="thumb-img"${poster ? ` src="${e(poster)}"` : ""}${
              glb ? ` data-model="${e(glb)}"` : ""
            } data-global-idx="${i}" alt="${e(it.name)}" loading="lazy" decoding="async">
            <div class="thumb-vignette"></div>
            ${m ? '<span class="badge-3d">3D</span>' : ""}
          </div>`
        : "";

    return `
      <li class="menu-item${m ? " has-3d" : " no-image"}"${data}>
        ${thumb}
        <div class="body">
          <h3>${e(it.name)}</h3>
          ${it.description ? `<p>${e(it.description)}</p>` : ""}
        </div>
        <div class="right">
          <div class="price">${e(money(it.price_minor, it.currency))}</div>
          ${m ? `<button class="ar-btn" data-idx="${i}">View 3D</button>` : ""}
        </div>
      </li>`;
  };

  return `<!doctype html>
<html lang="en" data-template="${e(snap.template || "plain")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${e(name)}</title>
<meta name="description" content="${e(name)} menu">
<style>
  :root {
    /* Defaults FIRST, the restaurant's values after, so theirs win by cascade order.
       The obvious-looking alternative - redeclaring a property in terms of itself, after
       the theme - is a self-reference, and such a property resolves to the
       guaranteed-invalid value. The page then renders with no colours at all, which
       looks like a theme that failed to load: the exact failure this design exists to
       make impossible. */
    --ink: #16130f;
    --paper: #faf7f2;
    --accent: #b4552d;
    --muted: #7a7168;
${themeCss(snap.theme)}
  }
  *,*::before,*::after { box-sizing: border-box }
  body { margin:0; background:var(--paper); color:var(--ink);
         font-family: var(--font-body, system-ui, -apple-system, sans-serif);
         -webkit-text-size-adjust:100%; }
  header { padding:2.4rem 1.2rem 1.2rem; text-align:center }
  h1 { font-family: var(--font-display, Georgia, serif); font-weight:600;
       font-size:clamp(1.7rem,6vw,2.6rem); margin:0; letter-spacing:-.01em }
  main { max-width:44rem; margin:0 auto; padding:0 1rem 4rem }
  h2 { font-family: var(--font-display, Georgia, serif); font-size:1.05rem;
       text-transform:uppercase; letter-spacing:.12em; color:var(--muted);
       border-bottom:1px solid color-mix(in srgb, var(--muted) 25%, transparent);
       padding-bottom:.4rem; margin:2.2rem 0 .4rem }
  main ul { list-style:none; margin:0; padding:0 }
  .menu-item { display:grid; grid-template-columns:auto 1fr auto; gap:.9rem;
          align-items:center; padding:.9rem 0;
          border-bottom:1px solid color-mix(in srgb, var(--muted) 14%, transparent) }
  .menu-item.has-3d { cursor:pointer }
  .body h3 { margin:0; font-size:1rem; font-weight:600 }
  .body p { margin:.2rem 0 0; font-size:.87rem; color:var(--muted); line-height:1.4 }
  .right { display:flex; flex-direction:column; align-items:flex-end; gap:.4rem }
  .price { font-variant-numeric:tabular-nums; font-weight:600; white-space:nowrap }
  .ar-btn { border:0; border-radius:999px; padding:.35rem .75rem; font:inherit;
            font-size:.72rem; font-weight:600; cursor:pointer;
            background:var(--accent); color:var(--paper) }
  .ar-btn[disabled] { opacity:.6 }
  footer { text-align:center; color:var(--muted); font-size:.75rem; padding:2rem 1rem }
  /* No basket in the self-serve menu yet (see ported/shim.js), so the ported markup's
     quantity controls have nothing behind them and must not offer themselves. */
  .qty-ctrl, #modal-qty-wrap, #basket-bar { display:none !important }

/* ── the platform's own viewer styles, verbatim ──────────────────────────────────
   Only when the menu actually has 3D on it. A photo-only restaurant should not carry
   18 KB of modal and WebXR-overlay CSS for machinery it never opens. */
${has3d ? VIEWER_CSS : ""}
</style>
</head>
<body>
<header><h1>${e(name)}</h1></header>
<main>
${sections
  .map(
    (s) => `  ${s.name ? `<h2>${e(s.name)}</h2>` : ""}
  <ul>${s.items.map(card).join("")}
  </ul>`
  )
  .join("\n")}
</main>
<footer>${e(name)} &middot; v${e(snap.version ?? "?")}</footer>
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
     the network or the GPU yet, and the menu is already readable by the time this runs. */
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
