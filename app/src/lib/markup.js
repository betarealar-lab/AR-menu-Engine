// markup.js — the platform's page, produced on the server.
//
// **This is the change that makes a menu fast.** Today the dishes do not exist until 290
// KB of JavaScript has parsed and run; the browser has nothing to paint but an empty
// shell. Here the dishes are in the HTML, so the first bytes a phone receives are the
// finished menu and it paints them with no JavaScript at all.
//
// Measured on the live page for context: ~1,010 ms of parse/eval before a single dish
// could be requested, then ~890 ms waiting for the data. Both are removed by rendering
// here instead of there.
//
// Every class name is the platform's. `.thumb-img[data-model]` and `data-global-idx` are
// what `_startThumbUpgrades` and `_upgradeThumb` query; `.item-left` / `.item-right` /
// `.item-actions` are what their stylesheet is written against. They are a contract, not
// a style choice - rename one and the 3D stops with no error at all.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** A menu is a stranger's typing the moment self-serve exists. */
export const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** Which language a field shows. The server renders the restaurant's primary language;
 *  every translation also travels on the element, so switching is a swap rather than a
 *  reload - the same principle as not fetching the menu in the first place. */
const pick = (item, field, lang) =>
  (lang !== "en" && item[`${field}_${lang}`]) || item[`${field}_en`] || "";

export function hero(cfg) {
  if (!cfg.hero_image_url && !cfg.hero_logo_url) return "";
  // Photo, crossfade layer and veil are separate elements in the platform and the CSS
  // positions all three; one div gets the height and none of the treatment.
  return `<section class="mg-hero" aria-hidden="true">` +
    `<div class="mg-hero-photo"></div>` +
    `<div class="mg-hero-next"></div>` +
    `<div class="mg-hero-veil"></div>` +
    (cfg.hero_logo_url
      ? `<img class="mg-hero-logo" src="${e(cfg.hero_logo_url)}" alt="" fetchpriority="high">`
      : "") +
    `</section>`;
}

export function header(menu, cfg, lang) {
  const name = (lang !== "en" && cfg.site_name_ka) || cfg.site_name || menu.tenant.name;
  return `<div class="header">` +
    (cfg.logo_url
      ? `<img id="tenant-logo" class="tenant-logo" src="${e(cfg.logo_url)}" alt="" ` +
        `decoding="async" fetchpriority="high">`
      : "") +
    `<h1 id="brand-title" data-brand>${e(name)}</h1></div>`;
}

/** The category bar, including the virtual "3D" pill.
 *
 *  `__ar3d` is a sentinel rather than a category name, so a restaurant that really does
 *  have a category called "3D" cannot collide with it. A 3D dish appears in BOTH that
 *  pill and its own category - full duplication, chosen deliberately after the platform's
 *  first version moved 3D items out of their categories and diners stopped finding them. */
export function catBar(menu, lang) {
  const cats = menu.categories.filter((c) =>
    menu.items.some((i) => i.category_id === c.id));
  const has3d = menu.items.some((i) => i.is_3d);
  if (!cats.length && !has3d) return "";
  const pill = (cat, en, ka, active) =>
    `<button type="button" class="cat-pill${active ? " active" : ""}" ` +
    `data-cat="${e(cat)}" data-cat-en="${e(en)}"${ka ? ` data-cat-ka="${e(ka)}"` : ""}>` +
    `${e(lang !== "en" && ka ? ka : en)}</button>`;
  return `<div id="cat-bar" class="cat-bar"><div class="cat-scroll">` +
    `<button type="button" class="cat-nav cat-nav-l" aria-label="Previous categories" hidden>&#8249;</button>` +
    `<div id="cat-filter" class="cat-filter">` +
    pill("", "All", "ყველა", true) +
    (has3d ? pill("__ar3d", "3D", "3D", false) : "") +
    cats.map((c) => pill(c.id, c.name, c.name_ka, false)).join("") +
    `</div>` +
    `<button type="button" class="cat-nav cat-nav-r" aria-label="More categories" hidden>&#8250;</button>` +
    `</div></div>`;
}

/** Sizes, when a dish has them. A drinks list is unreadable without them: the item price
 *  there is a summary like "16 / 70" and the real numbers live in here. */
function variants(item, lang) {
  if (!item.variants?.length) return "";
  return `<div class="variants" role="radiogroup">` + item.variants.map((v, i) =>
    `<button type="button" class="variant${i === 0 ? " selected" : ""}" data-vi="${i}" ` +
    `role="radio" aria-checked="${i === 0}">` +
    `<span class="variant-name">${e(lang !== "en" && v.ka ? v.ka : v.en || v.ka || "")}</span>` +
    `<span class="variant-price">${e(v.price || "")}</span></button>`).join("") + `</div>`;
}

export function menuItem(item, i, lang) {
  const name = pick(item, "name", lang);
  const desc = pick(item, "description", lang);
  // Three flags, three meanings. `text_only` is a compact row with no media at all; a
  // dish with neither photo nor model is that shape by circumstance.
  const noImage = item.text_only || (!item.model && !item.thumbnail_url);
  // The card thumbnail becomes a live model only when the owner asked for it - the
  // platform's `thumb_3d`. Off keeps the photo, which saves a download and a WebGL
  // context; on is the thing nobody else in this category has.
  const live = item.is_3d && item.thumb_3d && item.model;

  const data =
    ` data-idx="${i}" data-name="${e(item.name_en)}"` +
    (item.name_ka ? ` data-name-ka="${e(item.name_ka)}"` : "") +
    ` data-price="${e(item.price)}"` +
    (item.category_id ? ` data-cat="${e(item.category_id)}"` : "") +
    (item.model ? ` data-glb="${e(item.model)}"` : "") +
    (item.model_usdz ? ` data-usdz="${e(item.model_usdz)}"` : "") +
    (item.ar_scale !== 1 ? ` data-ar-scale="${e(item.ar_scale)}"` : "");

  // The first few cards are above the fold, so their photos are eager and the rest are
  // lazy. width/height are set so a late image cannot shove the text beside it - layout
  // shift is the other half of "looks slow" and costs nothing to prevent.
  const left = noImage ? "" :
    `<div class="item-left"><div class="thumb-wrap">` +
    `<img class="thumb-img"${item.thumbnail_url ? ` src="${e(item.thumbnail_url)}"` : ""}` +
    `${live ? ` data-model="${e(item.model)}"` : ""} data-global-idx="${i}" ` +
    `alt="${e(name)}" width="430" height="220" decoding="async" ` +
    `${i < 4 ? 'fetchpriority="high"' : 'loading="lazy"'}>` +
    `<div class="thumb-vignette"></div>` +
    (item.is_3d ? `<span class="badge-3d">3D</span>` : "") +
    `</div></div>`;

  const actions = `<div class="item-actions"><p class="price">` +
    (item.price_old ? `<span class="price-was">${e(item.price_old)}</span>` : "") +
    `${e(item.price)}</p></div>`;
  const nameHtml =
    `<p class="item-name" data-field="name" data-idx="${i}">${e(name)}</p>`;
  const descHtml = desc
    ? `<p class="ingredients" data-field="description" data-idx="${i}">${e(desc)}</p>` : "";

  // A text-only dish lays out differently in the platform: description and price go in
  // the body rather than a right-hand column beside a picture that is not there.
  if (noImage) {
    return `<div class="menu-item no-image"${data}>${nameHtml}${descHtml}` +
      `<div class="item-right">${actions}</div>` +
      (item.variants?.length
        ? `<div class="no-image-extra">${variants(item, lang)}</div>` : "") +
      `</div>`;
  }
  return `<div class="menu-item"${data}>${nameHtml}${left}` +
    `<div class="item-right">${descHtml}${actions}${variants(item, lang)}` +
    (item.is_3d ? `<button class="ar-btn" data-idx="${i}">3D</button>` : "") +
    `</div></div>`;
}

export function menuList(menu, lang) {
  return `<div class="menu-list" id="menu-list">` +
    menu.items.map((it, i) => menuItem(it, i, lang)).join("") +
    `</div>`;
}

/** The platform's two floating buttons. `#lang-toggle` and `#theme-toggle` are
 *  position:fixed and styled per template in their sheet; inventing controls of our own
 *  would mean styling them from scratch and having them land on top of the pills. */
export function toggles(menu) {
  const langs = menu.tenant.languages || ["en"];
  const label = { en: "EN", ka: "ქარ", ru: "RU" };
  const next = langs.find((l) => l !== langs[0]);
  return `<button id="theme-toggle" aria-label="Toggle theme"></button>` +
    (next
      ? `<button id="lang-toggle" aria-label="Toggle language" ` +
        `data-langs="${e(langs.join(","))}">${e(label[next] || next.toUpperCase())}</button>`
      : "");
}
