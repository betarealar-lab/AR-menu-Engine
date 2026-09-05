// components.mjs — the platform's page, section by section.
//
// The first replication took production's CSS and put it on markup of my own. Their
// stylesheet is written against a specific tree, so it landed on nothing and the result
// looked worse than either half alone. This is that tree:
//
//     <section class="mg-hero">          full-bleed photo, veil, optional logo
//     <div class="header">               logo + brand title
//     <div id="cat-bar" class="cat-bar"> sticky category pills
//     <div class="menu-list" id="menu-list">   the cards
//
// Element for element and class for class, because every one of those names is either a
// CSS hook in `ported/menu.css` or a selector `ported/viewer.js` queries. They are a
// contract, not a style choice.
//
// Each export is a plain function returning an HTML string, which is deliberately the
// shape an Astro component wraps with no logic moved: `<Fragment set:html={hero(snap)} />`
// today, a real `.astro` file tomorrow, same output either way.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** A menu is a stranger's typing the moment self-serve exists. */
export const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** Assets arrive as either an R2 key (ours, private, served by the Worker) or an absolute
 *  URL (imported, already public). One field, told apart by the scheme, so a template
 *  never has to know where a dish's files live. */
export const assetUrl = (v, base = "/a") =>
  !v ? null : /^https?:\/\/|^data:/.test(v) ? v : `${base}/${v}`;

/** 2800 -> "28 ₾". Number first, symbol after, matching what the live data stores as
 *  free text - a diner comparing the two pages should not be able to spot a difference
 *  this small. `price_text` overrides for the cases no single number can express. */
export function price(item) {
  if (item.price_text) return item.price_text;
  const sym = { GEL: "₾", USD: "$", EUR: "€", GBP: "£" }[item.currency] || "";
  const n = (Math.round(item.price_minor || 0) / 100)
    .toFixed(2)
    .replace(/\.00$/, "");
  return sym ? `${n} ${sym}` : n;
}

const priceOld = (item) =>
  item.price_old_minor
    ? price({ ...item, price_minor: item.price_old_minor, price_text: null })
    : "";

/** The hero. Photo, crossfade layer and veil are separate elements in the platform, and
 *  the CSS positions all three - a single div gets the height and none of the treatment.
 *  `aria-hidden` because it carries no information a screen reader needs; the brand name
 *  is in the header below it as a real heading. */
export function hero(snap) {
  const s = snap.settings || {};
  const img = assetUrl(s.hero_image_url);
  if (!img && !s.hero_logo_url) return "";
  return `<section class="mg-hero" aria-hidden="true">
    <div class="mg-hero-photo"></div>
    <div class="mg-hero-next"></div>
    <div class="mg-hero-veil"></div>
    ${s.hero_logo_url
      ? `<img class="mg-hero-logo" src="${e(assetUrl(s.hero_logo_url))}" alt="">`
      : ""}
  </section>`;
}

export function header(snap) {
  const s = snap.settings || {};
  const logo = assetUrl(s.logo_url);
  return `<div class="header">
    ${logo ? `<img id="tenant-logo" class="tenant-logo" src="${e(logo)}" alt="" decoding="async">` : ""}
    <h1 id="brand-title" data-brand>${e(snap.tenant?.name || "Menu")}</h1>
  </div>`;
}

/** The category bar, including the two virtual categories the platform invents.
 *
 *  `__ar3d` is a sentinel rather than a real category name, so a restaurant that actually
 *  has a category called "3D" does not collide with it. And a 3D dish appears in BOTH the
 *  3D pill and its real category - Temo chose full duplication deliberately when the
 *  platform's first version moved 3D items out of their categories and diners could not
 *  find them.
 */
export function catBar(snap) {
  const cats = snap.categories || [];
  const has3d = (snap.items || []).some((i) => i.model);
  if (!cats.length && !has3d) return "";
  const pill = (cat, label, labelKa, active) =>
    `<button type="button" class="cat-pill${active ? " active" : ""}" data-cat="${e(cat)}"` +
    (labelKa ? ` data-cat-ka="${e(labelKa)}"` : "") +
    `>${e(label)}</button>`;
  return `<div id="cat-bar" class="cat-bar">
    <div class="cat-scroll">
      <button type="button" class="cat-nav cat-nav-l" aria-label="Scroll categories left" hidden>&#8249;</button>
      <div id="cat-filter" class="cat-filter">
        ${pill("", "All", "ყველა", true)}
        ${has3d ? pill("__ar3d", "3D", "3D", false) : ""}
        ${cats.map((c) => pill(c.id, c.name, c.name_ka, false)).join("\n        ")}
      </div>
      <button type="button" class="cat-nav cat-nav-r" aria-label="Scroll categories right" hidden>&#8250;</button>
    </div>
  </div>`;
}

/** Sizes, when a dish has them. 30 of Monday Greens' 170 items do, and a drinks list is
 *  unreadable without them - the item price there is a summary like "16 / 70" and the
 *  real numbers live here. */
function variants(item) {
  const list = item.variants || [];
  if (!list.length) return "";
  const one = (v, i) =>
    `<button type="button" class="variant${i === 0 ? " selected" : ""}" data-vi="${i}"` +
    ` role="radio" aria-checked="${i === 0}">` +
    `<span class="variant-name">${e(v.en || v.ka || "")}</span>` +
    `<span class="variant-price">${e(v.price || "")}</span></button>`;
  return `<div class="variants" role="radiogroup">${list.map(one).join("")}</div>`;
}

/** One dish.
 *
 *  `.thumb-img[data-model]` and `data-global-idx` are what `_startThumbUpgrades` and
 *  `_upgradeThumb` query, and `.item-left` / `.item-right` / `.item-actions` are what
 *  menu.css is written against. Renaming any of them stops the 3D with no error at all,
 *  which is why check_render.py asserts each one.
 */
export function menuItem(item, i, opts = {}) {
  const base = opts.assetBase || "/a";
  const m = item.model;
  const poster = assetUrl(item.photo || m?.poster, base);
  const glb = m ? assetUrl(m.draco, base) : null;
  const usdz = m?.usdz ? assetUrl(m.usdz, base) : null;
  // Three flags, three meanings. `text_only` is a compact row with no media at all;
  // a dish with no photo and no model is the same shape by circumstance.
  const noImage = item.text_only || (!m && !poster);
  // The card thumbnail is a live model only when the owner asked for it. Off keeps the
  // photo, which saves a download and a WebGL context - the platform's `thumb_3d`.
  const liveThumb = m && m.live_thumb !== false;

  const data =
    ` data-idx="${i}" data-name="${e(item.name)}"` +
    (item.name_ka ? ` data-name-ka="${e(item.name_ka)}"` : "") +
    ` data-desc="${e(item.description || "")}" data-price="${e(price(item))}"` +
    (item.category_id ? ` data-cat="${e(item.category_id)}"` : "") +
    (glb ? ` data-glb="${e(glb)}"` : "") +
    (usdz ? ` data-usdz="${e(usdz)}"` : "") +
    (poster ? ` data-poster="${e(poster)}"` : "") +
    (m?.orbit ? ` data-orbit="${e(m.orbit)}"` : "") +
    (m?.ar_scale && m.ar_scale !== 1 ? ` data-ar-scale="${e(m.ar_scale)}"` : "") +
    (m?.scale_cm
      ? ` data-cm="${e(m.scale_cm)}" data-axis="${e(m.scale_axis || "width")}"`
      : "");

  const left = noImage
    ? ""
    : `<div class="item-left">
          <div class="thumb-wrap">
            <img class="thumb-img"${poster ? ` src="${e(poster)}"` : ""}${
              glb && liveThumb ? ` data-model="${e(glb)}"` : ""
            } data-global-idx="${i}" alt="${e(item.name)}" loading="lazy" decoding="async">
            <div class="thumb-vignette"></div>
            ${m ? '<span class="badge-3d">3D</span>' : ""}
          </div>
        </div>`;

  const nameHtml =
    `<p class="item-name" data-field="name" data-idx="${i}">${e(item.name)}</p>`;
  const descHtml = item.description
    ? `<p class="ingredients" data-field="description" data-idx="${i}">${
        e(item.description)
      }</p>`
    : "";
  const actions = `<div class="item-actions">
            <p class="price">${
              priceOld(item) ? `<span class="price-was">${e(priceOld(item))}</span>` : ""
            }${e(price(item))}</p>
          </div>`;

  // The platform lays a text-only dish out differently: description and price go in the
  // card body rather than in a right-hand column beside a picture that is not there.
  if (noImage) {
    return `
      <div class="menu-item no-image"${data}>
        ${nameHtml}
        ${descHtml}
        <div class="item-right">${actions}</div>
        ${variants(item) ? `<div class="no-image-extra">${variants(item)}</div>` : ""}
      </div>`;
  }

  return `
      <div class="menu-item"${data}>
        ${nameHtml}
        ${left}
        <div class="item-right">
          ${descHtml}
          ${actions}
          ${variants(item)}
          ${m ? `<button class="ar-btn" data-idx="${i}">View 3D</button>` : ""}
        </div>
      </div>`;
}

export function menuList(snap, opts = {}) {
  const items = snap.items || [];
  return `<div class="menu-list" id="menu-list">${items
    .map((it, i) => menuItem(it, i, opts))
    .join("")}
  </div>`;
}

/** A language switch, only when the restaurant actually publishes more than one.
 *
 *  Monday Greens has `en` and `ka` on all 170 items; it does NOT have `ru`, though the
 *  platform has the column - which is why languages are a per-tenant list here rather
 *  than three fixed columns. A tenant with one language gets no toggle at all. */
export function langBar(snap) {
  const langs = snap.tenant?.languages || ["en"];
  if (langs.length < 2) return "";
  const label = { en: "EN", ka: "ქარ", ru: "RU" };
  return `<div class="lang-bar" role="group" aria-label="Language">${langs
    .map(
      (l, i) =>
        `<button type="button" class="lang-pill${i === 0 ? " active" : ""}" ` +
        `data-lang="${e(l)}">${e(label[l] || l.toUpperCase())}</button>`
    )
    .join("")}</div>`;
}
