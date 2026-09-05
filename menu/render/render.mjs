// render.mjs — a published snapshot becomes a complete page. No database, no re-skin.
//
// This is MENU-PLATFORM.md §2.1a, the thing Temo asked for in his own words: "we want
// template and unique menu to be the og custom build for them where users dont have to
// wait for a website to load and then reload."
//
// What exists today does the opposite. One generic index.html loads, JavaScript fetches
// the tenant's theme, and the page re-skins itself in front of the diner. Three states:
// blank, generic, branded. The middle one is the bug, and it is architectural - no amount
// of shrinking the payload removes it.
//
// So this is a PURE FUNCTION: (snapshot, options) -> a complete HTML document, with the
// template's CSS and the restaurant's colours already inside <head> and every dish
// already in the markup. The first bytes the browser receives are that restaurant's
// menu. There is no second state to flash to, because there is no first state.
//
// It is pure for a second reason that matters as much (§2.2): the admin app's preview
// calls THIS function, and so does the live page. Not a reimplementation of it - it. Two
// implementations drift, and the day they do, an owner approves a preview that is not
// what diners get.
//
// Runs unchanged in a Cloudflare Worker, in Astro, and in Node. No imports on purpose.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Everything interpolated below goes through this. A dish called `Chicken & <b>Chips</b>`
 *  is a restaurant's typing, not markup, and a menu is user-generated content the moment
 *  self-serve exists. */
const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** 1250 -> "12.50". Integer minor units all the way to the last possible moment, because
 *  12.30 as a float is 12.299999999999999 and a menu that disagrees with the till by a
 *  tetri is a menu nobody trusts. */
const money = (minor, currency) => {
  const sym = { GEL: "₾", USD: "$", EUR: "€", GBP: "£" }[currency] || "";
  return `${sym}${(Math.round(minor) / 100).toFixed(2)}`;
};

/** Theme values become CSS custom properties, inline, in the head.
 *
 *  Filtered hard, because a theme is data a restaurant owner typed and it is being
 *  written into a <style> block. `--x: red; } body { display:none } .a{` would otherwise
 *  be a CSS injection with a very boring but very effective payload. Keys and values are
 *  both restricted to what a design token can legitimately contain. */
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
  // Where the Worker serves bucket bytes from. Keys, never URLs, live in the snapshot
  // (§2.6) - the buckets are private and a baked URL would be one that expires inside an
  // object that is supposed to be immutable.
  const asset = (key) => (key ? `${opts.assetBase || "/a"}/${key}` : null);
  const sections = group(snap);
  const has3d = (snap.items || []).some((i) => i.model);
  const name = snap.tenant?.name || "Menu";

  const card = (it) => {
    // Scale carries its AXIS as well as its number. "4 cm" alone is not a size - the
    // real records use `height` as often as `width`, and a 26 cm plate and a 4 cm stack
    // of chicken are both correct readings of a bare 4. Dropping the axis here would put
    // dishes on tables at the wrong size in a way that looks like a bad model.
    const m = it.model;
    const poster = asset(it.photo || m?.poster);
    return `
      <li class="item${m ? " has3d" : ""}"${m ? ` data-glb="${e(asset(m.draco))}"` : ""}${
        m?.usdz ? ` data-usdz="${e(asset(m.usdz))}"` : ""
      }${m?.scale_cm ? ` data-cm="${e(m.scale_cm)}" data-axis="${e(m.scale_axis || "width")}"` : ""}>
        ${poster ? `<img class="shot" src="${e(poster)}" alt="" loading="lazy" decoding="async">` : ""}
        <div class="body">
          <h3>${e(it.name)}${m ? ` <span class="tag">3D</span>` : ""}</h3>
          ${it.description ? `<p>${e(it.description)}</p>` : ""}
        </div>
        <div class="price">${e(money(it.price_minor, it.currency))}</div>
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
  /* The restaurant's colours, inline, before anything paints. NOT a class the client
     adds, NOT a stylesheet fetched after first paint - either of those is the flash
     coming back. */
  :root {
    /* Defaults FIRST, the restaurant's values after, so theirs win by cascade order.
       The obvious-looking alternative - redeclaring a property in terms of itself,
       after the theme - is a self-reference, and such a property resolves
       to the guaranteed-invalid value. The page then renders with no colours at all,
       which looks like the theme failed to load: the exact failure this whole design
       exists to make impossible. */
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
  ul { list-style:none; margin:0; padding:0 }
  .item { display:grid; grid-template-columns:auto 1fr auto; gap:.9rem;
          align-items:start; padding:.9rem 0;
          border-bottom:1px solid color-mix(in srgb, var(--muted) 14%, transparent) }
  /* Reserved, so a late image cannot shove the text it sits beside. */
  .shot { width:64px; height:64px; object-fit:cover; border-radius:8px; background:
          color-mix(in srgb, var(--muted) 12%, transparent) }
  .body h3 { margin:0; font-size:1rem; font-weight:600 }
  .body p { margin:.2rem 0 0; font-size:.87rem; color:var(--muted); line-height:1.4 }
  .price { font-variant-numeric:tabular-nums; font-weight:600; white-space:nowrap }
  .tag { font-size:.62rem; letter-spacing:.09em; vertical-align:middle;
         padding:.15em .45em; border-radius:4px; background:var(--accent);
         color:var(--paper) }
  footer { text-align:center; color:var(--muted); font-size:.75rem; padding:2rem 1rem }
  @media (prefers-reduced-motion:no-preference){ .item{ transition:background .15s } }
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
${
  has3d
    ? `<script type="module">
  /* The ONLY script on the page, and it runs after the menu is already readable.
     model-viewer is ~250 KB and each live 3D card spawns its own WebGL context - the
     real reason for the five-item cap (DECISIONS §7). None of that is allowed anywhere
     near first paint: the menu is a menu before this file has been asked for. */
  const cards = [...document.querySelectorAll(".item.has3d")];
  if (cards.length) {
    addEventListener("load", () => {
      const io = new IntersectionObserver((es) => {
        for (const en of es) if (en.isIntersecting) { io.unobserve(en.target); }
      });
      cards.forEach((c) => io.observe(c));
    }, { once: true });
  }
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
