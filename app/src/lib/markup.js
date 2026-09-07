// markup.js — the platform's page, produced on the server.
//
// **This is the change that makes a menu fast.** On the live platform the dishes do not
// exist until 290 KB of JavaScript has parsed and run, and the browser has nothing to
// paint but an empty shell - measured at ~1,010 ms of parse/eval before a single dish
// could even be requested, then ~890 ms waiting for the data. Here the dishes are in the
// HTML, so a phone paints a finished menu with no JavaScript at all.
//
// Every class name is the platform's. `.thumb-img[data-model]` and `data-global-idx` are
// what `_startThumbUpgrades` and `_upgradeThumb` query; `.item-left` / `.item-right` /
// `.item-actions` / `.qty-ctrl` / `.variants` are what their stylesheet is written against;
// `.cat-section` / `.category-header` / `.ar-featured-banner` are the list's own structure.
// They are a contract, not a style choice - rename one and a feature stops with no error.
//
// ── the line this file is now on the right side of ──────────────────────────────────
//
// Temo, after opening the deployed page on a phone:
//
//   > "make sure to differentiate what are normal website features and what are template
//   >  additions, like add to cart, category sorted, 3d on top, 3d and AR view, show to
//   >  waiter, view the cart, these and some others are baisc features not template
//   >  specific."
//
// So: **every card gets a cart button, its sizes and its add-ons, always.** Not because a
// template asked for them - there is nothing here a template can turn off. What a template
// changes is the palette, the fonts, the hero and the card shape, all of which are CSS.
// The previous version of this file rendered no cart button at all, and the reason was not
// a decision: `addToBasket` was a stub, so there was nothing for a button to call.

// Import attribute, not a bare specifier: this module is imported BOTH by Vite (which
// would take either) and by plain Node in `check_features.py`, and Node ESM refuses a
// JSON import without it. One spelling that works in both is worth the six characters.
import uiStrings from "./ui.json" with { type: "json" };

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** A menu is a stranger's typing the moment self-serve exists. */
export const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** Which language a field shows. The server renders the restaurant's primary language;
 *  every translation also travels on the element, so switching is a swap rather than a
 *  reload - the same principle as not fetching the menu in the first place. */
const pick = (item, field, lang) =>
  (lang !== "en" && item[`${field}_${lang}`]) || item[`${field}_en`] || "";

/** The platform's own strings, extracted rather than retyped (see extract_ui.py). Used
 *  here only for the labels that must be right in the FIRST frame - the 3D button and the
 *  3D block's heading. Everything else is set by the client, which knows the device. */
const ui = (lang) => uiStrings[lang] || uiStrings.en;

export function hero(cfg) {
  const any = cfg.hero_image_url || cfg.hero_logo_url || cfg.hero_video_url
    || cfg.hero_images;
  if (!any) return "";
  // Photo, crossfade layer and veil are separate elements in the platform and the CSS
  // positions all three; one div gets the height and none of the treatment.
  return `<section class="mg-hero" aria-hidden="true">` +
    `<div class="mg-hero-photo"></div>` +
    `<div class="mg-hero-next"></div>` +
    // Ships with NO src, on purpose. `_startHeroVideo` attaches one on idle, after the
    // poster photo has already painted the band, so a clip can never compete with the
    // menu for the first screenful - and it is skipped entirely on Data Saver, on 2G and
    // under prefers-reduced-motion.
    `<video id="mg-hero-video" class="mg-hero-video" preload="none" muted loop ` +
    `playsinline autoplay disablepictureinpicture tabindex="-1" aria-hidden="true"></video>` +
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
  const pill = (cat, en, ka, ru, active) =>
    `<button type="button" class="cat-pill${active ? " active" : ""}" ` +
    `data-cat="${e(cat)}" data-cat-en="${e(en)}"` +
    (ka ? ` data-cat-ka="${e(ka)}"` : "") + (ru ? ` data-cat-ru="${e(ru)}"` : "") + `>` +
    `${e(label({ name: en, name_ka: ka, name_ru: ru }, lang))}</button>`;
  return `<div id="cat-bar" class="cat-bar"><div class="cat-scroll">` +
    `<button type="button" class="cat-nav cat-nav-l" aria-label="Previous categories" hidden>&#8249;</button>` +
    `<div id="cat-filter" class="cat-filter">` +
    pill("", "All", "ყველა", "Все", true) +
    (has3d ? pill("__ar3d", "3D", "3D", "3D", false) : "") +
    cats.map((c) => pill(c.id, c.name, c.name_ka, c.name_ru, false)).join("") +
    `</div>` +
    `<button type="button" class="cat-nav cat-nav-r" aria-label="More categories" hidden>&#8250;</button>` +
    `</div></div>`;
}

const label = (c, lang) =>
  (lang === "ka" && c.name_ka) || (lang === "ru" && c.name_ru) || c.name;

/** Sizes, when a dish has them. A drinks list is unreadable without them: the item price
 *  there is a summary like "16 / 70" and the real numbers live in here.
 *
 *  Index 0 is selected here and `_variantIndex` may move it on the client - it prefers the
 *  first choice that has a PHOTO, so a pictureless "Veggie" does not become the default
 *  card state when the photo on file is the chicken one. Server-side that is a repaint of
 *  one pill, not a flash of the whole card. */
function variants(item, lang) {
  if (!item.variants?.length) return "";
  return `<div class="variants" role="radiogroup">` + item.variants.map((v, i) =>
    `<button type="button" class="variant${i === 0 ? " selected" : ""}" data-vi="${i}" ` +
    `role="radio" aria-checked="${i === 0}">` +
    `<span class="variant-name">${e(lang !== "en" && v.ka ? v.ka : v.en || v.ka || "")}</span>` +
    `<span class="variant-price">${e(v.price || "")}</span></button>`).join("") + `</div>`;
}

/** Extras, when a dish has them. Multi-select, and each combination is its own basket
 *  line - "burger + bacon" and "burger + bacon + cheese" are two orders, not one. */
function addons(item, lang) {
  if (!item.addons?.length) return "";
  return `<div class="addons">` + item.addons.map((a, i) =>
    `<button type="button" class="addon" data-ai="${i}" aria-pressed="false">` +
    `<span class="addon-l"><span class="addon-check" aria-hidden="true"></span>` +
    `<span class="addon-name">${e(lang !== "en" && a.ka ? a.ka : a.en || a.ka || "")}</span></span>` +
    `<span class="addon-price">+${e(a.price || "")}</span></button>`).join("") + `</div>`;
}

/** Add to basket. **Every card, every template, no exception** - see the header of this
 *  file. Starts as the cart icon; `_syncQtyCtrl` swaps in the stepper the moment the dish
 *  is in the basket, and does it to every copy of this control on the page at once (the
 *  card, the 3D modal and the lightbox share a `data-idx`, so they cannot disagree). */
const CART_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
  ' stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>' +
  '<path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>';

function qtyCtrl(i) {
  return `<div class="qty-ctrl" data-idx="${i}">` +
    `<button class="qty-add-btn" aria-label="Add to basket">${CART_SVG}</button>` +
    `<div class="qty-stepper">` +
    `<button class="qty-dec">&#8722;</button>` +
    `<span class="qty-num">1</span>` +
    `<button class="qty-inc">+</button>` +
    `</div></div>`;
}

/** One dish.
 *
 *  `promoted` renders the copy that lives in the virtual 3D block. Both copies carry the
 *  SAME `data-idx`, exactly as the platform does, so the basket, AR and the event sink all
 *  treat them as one dish - `.ar-featured` is a badge, not a second item.
 */
export function menuItem(item, i, lang, promoted = false) {
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
    // `data-idx` is the viewer's own array position and `data-id` is the dish's real id.
    // Both, because the ported code counts in positions and the event sink and the
    // show-to-staff QR store ids - and a position is meaningless the moment a dish is
    // hidden or reordered.
    ` data-idx="${i}" data-id="${e(item.id ?? "")}" data-name="${e(item.name_en)}"` +
    (item.name_ka ? ` data-name-ka="${e(item.name_ka)}"` : "") +
    (item.name_ru ? ` data-name-ru="${e(item.name_ru)}"` : "") +
    // The descriptions travel too, so the language switch is a swap and not a re-fetch.
    ` data-desc="${e(item.description_en || "")}"` +
    (item.description_ka ? ` data-desc-ka="${e(item.description_ka)}"` : "") +
    (item.description_ru ? ` data-desc-ru="${e(item.description_ru)}"` : "") +
    ` data-price="${e(item.price)}"` +
    (item.price_old ? ` data-price-old="${e(item.price_old)}"` : "") +
    (item.category_id ? ` data-cat="${e(item.category_id)}"` : "") +
    // **`data-3d` is not the same question as "has a model".** The owner can keep a dish's
    // model attached and still have it behave like a photo dish - `is_3d` off - and two of
    // Monday Greens' dishes are set that way today. Inferring 3D from the presence of a
    // GLB, which the runtime used to do, silently overrode that choice: the dish got no
    // badge and no button (correct) but still opened the 3D viewer on a tap and still got
    // preloaded into the AR carousel. One flag could not express it, so it is stated.
    (item.is_3d ? ` data-is3d="1"` : "") +
    (item.model ? ` data-glb="${e(item.model)}"` : "") +
    (item.model_usdz ? ` data-usdz="${e(item.model_usdz)}"` : "") +
    // The poster. `viewer.js` reads `thumbnail_url` for the modal's first frame, and it
    // must be on the card because the item list is rebuilt FROM the cards.
    (item.thumbnail_url ? ` data-poster="${e(item.thumbnail_url)}"` : "") +
    // How to frame the dish in 3D: "h v zoom", clamped by `_itemCameraOrbit`.
    (item.view_orbit ? ` data-orbit="${e(item.view_orbit)}"` : "") +
    (item.ar_scale !== 1 ? ` data-ar-scale="${e(item.ar_scale)}"` : "");

  // The first few cards are above the fold, so their photos are eager and the rest are
  // lazy. width/height are set so a late image cannot shove the text beside it - layout
  // shift is the other half of "looks slow" and costs nothing to prevent.
  const left = noImage ? "" :
    `<div class="item-left"><div class="thumb-wrap">` +
    `<img class="thumb-img"${item.thumbnail_url ? ` src="${e(item.thumbnail_url)}"` : ""}` +
    `${live ? ` data-model="${e(item.model)}"` : ""} data-global-idx="${i}" ` +
    `alt="${e(name)}" width="430" height="220" decoding="async" ` +
    `${!promoted && i < 4 ? 'fetchpriority="high"' : 'loading="lazy"'}>` +
    `<div class="thumb-vignette"></div>` +
    (item.is_3d ? `<span class="badge-3d">3D</span>` : "") +
    `</div></div>`;

  const actions = `<div class="item-actions"><p class="price">` +
    (item.price_old ? `<span class="price-was">${e(item.price_old)}</span>` : "") +
    `${e(item.price)}</p>${qtyCtrl(i)}</div>`;
  const nameHtml =
    `<p class="item-name" data-field="name" data-idx="${i}">${e(name)}</p>`;
  const descHtml =
    `<p class="ingredients" data-field="description" data-idx="${i}">${e(desc)}</p>`;
  const cls = "menu-item" + (noImage ? " no-image" : "") +
    (promoted ? " ar-featured" : "");

  // A text-only dish lays out differently in the platform: description and price go in
  // the body rather than a right-hand column beside a picture that is not there, and the
  // sizes and add-ons take a full-width row underneath instead of the narrow price column.
  if (noImage) {
    const extra = variants(item, lang) + addons(item, lang);
    return `<div class="${cls}"${data}>${nameHtml}${descHtml}` +
      `<div class="item-right">${actions}</div>` +
      (extra ? `<div class="no-image-extra">${extra}</div>` : "") +
      `</div>`;
  }
  return `<div class="${cls}"${data}>${nameHtml}${left}` +
    `<div class="item-right">${descHtml}${actions}` +
    `${variants(item, lang)}${addons(item, lang)}` +
    // The label is the platform's own string for this language. It is corrected on the
    // client the moment AR capability is known - a phone that can do real AR is offered
    // "VIEW ON TABLE" instead - but it must not be blank or English in the first frame.
    (item.is_3d
      ? `<button class="ar-btn" data-idx="${i}">${e(ui(lang).view3D)}</button>` : "") +
    `</div></div>`;
}

/** The list, grouped the way the platform groups it.
 *
 *  A section per category, in the owner's order, each with its heading - and above them
 *  all, the virtual 3D block: a banner and every model-backed dish, which is what "3d on
 *  top" means. `page.js` shows and hides these; it does not rebuild them.
 *
 *  The 3D dishes appear twice, here and in their own category, and both copies carry the
 *  same index. That duplication is deliberate and it is Temo's call from the platform's
 *  first version, which moved 3D items OUT of their categories and left diners unable to
 *  find them.
 */
export function menuList(menu, lang) {
  const items = menu.items;
  const threeD = items.map((it, i) => [it, i]).filter(([it]) => it.is_3d);
  const byCat = new Map(menu.categories.map((c) => [c.id, []]));
  const loose = [];
  items.forEach((it, i) => {
    const bucket = byCat.get(it.category_id);
    (bucket || loose).push([it, i]);
  });

  const sections = [];
  if (threeD.length) {
    const t = lang === "ka"
      ? { title: "AR / 3D კერძები", copy: "ნახე მაგიდაზე ან 3D-ში" }
      : { title: "AR / 3D items", copy: "View them on your table or in 3D" };
    sections.push(
      `<div class="cat-section" data-cat="__ar3d">` +
      `<div class="ar-featured-banner">` +
      `<span class="ar-featured-title">${e(t.title)}</span>` +
      `<span class="ar-featured-copy">${e(t.copy)}</span></div>` +
      threeD.map(([it, i]) => menuItem(it, i, lang, true)).join("") +
      `</div>`);
  }
  for (const cat of menu.categories) {
    const entries = byCat.get(cat.id) || [];
    if (!entries.length) continue;
    sections.push(
      `<div class="cat-section" data-cat="${e(cat.id)}">` +
      `<div class="category-header" data-cat-en="${e(cat.name)}"` +
      (cat.name_ka ? ` data-cat-ka="${e(cat.name_ka)}"` : "") +
      (cat.name_ru ? ` data-cat-ru="${e(cat.name_ru)}"` : "") +
      `>${e(label(cat, lang))}</div>` +
      entries.map(([it, i]) => menuItem(it, i, lang)).join("") +
      `</div>`);
  }
  // A dish whose category was deleted still has to appear somewhere. Its own section with
  // no heading, at the end - never dropped, because a dish missing from a menu is a dish
  // nobody can order.
  if (loose.length) {
    sections.push(`<div class="cat-section" data-cat="">` +
      loose.map(([it, i]) => menuItem(it, i, lang)).join("") + `</div>`);
  }
  return `<div class="menu-list" id="menu-list">${sections.join("")}</div>`;
}

/** The two fields that cannot honestly be read back out of the markup.
 *
 *  `shim.js` rebuilds the viewer's item list from the cards, which carry everything a dish
 *  needs - name, price, model, poster, camera angle - because the page was rendered
 *  complete. Sizes and add-ons are the exception: they are structured data with PRICES in
 *  them, and the basket does arithmetic on those. Scraping "70 ₾" out of a `<span>` to
 *  then multiply it is how a wrong total ends up in front of a paying customer.
 *
 *  So they travel as JSON, keyed by index, and only for the dishes that have any - 30 of
 *  Monday Greens' 170. Nothing else in the menu is duplicated between the markup and here.
 */
export function itemsJson(menu) {
  const out = {};
  menu.items.forEach((it, i) => {
    if (!it.variants?.length && !it.addons?.length) return;
    out[i] = {};
    if (it.variants?.length) out[i].v = it.variants;
    if (it.addons?.length) out[i].a = it.addons;
  });
  return out;
}

/** The platform's two floating buttons. `#lang-toggle` and `#theme-toggle` are
 *  position:fixed and styled per template in their sheet; inventing controls of our own
 *  would mean styling them from scratch and having them land on top of the pills.
 *
 *  `#theme-toggle` ships EMPTY. It is a 34px circle and `page.js` puts a sun or a moon in
 *  it on boot. It used to ship with the word "Night" in it, which is a word in a circle too
 *  small to hold one - Temo saw "a small button that does nothing", and it was in fact
 *  doing exactly what it was told into a box nobody could read.
 */
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
