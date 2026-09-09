// platform.js — the features every menu has, whatever it looks like.
//
// **This file exists because I stubbed these instead of porting them.** `shim.js` used to
// contain:
//
//     window.addToBasket   = function () {};              // the basket
//     window._variantsHtml = function () { return ""; };  // glass / bottle
//
// ...plus nine fake hidden <div>s standing in for the photo lightbox. Those stubs let
// `viewer.js` boot without crashing, which is all they were written to do. They also
// removed half the product, and the page still looked plausible, so nothing caught it
// until Temo opened it on a phone in a restaurant:
//
//   > "this is not a copy of og monday greens it is something that tried to be a copy of a
//   >  copy and failed. and considering u have access to the files u should have done
//   >  better."
//
// He also drew the line this file is named after:
//
//   > "make sure to differentiate what are normal website features and what are template
//   >  additions, like add to cart, category sorted, 3d on top, 3d and AR view, show to
//   >  waiter, view the cart, these and some others are baisc features not template
//   >  specific."
//
// So: **platform features live here and every template gets them.** Add to cart, view the
// cart, show to waiter, variants, add-ons, the quantity stepper. A template changes the
// palette, the fonts, the hero and the card shape - it does not get to not have a basket.
// Nothing in this file reads `data-template`, and that is the point: there is no way for
// a template to switch a feature off, because there is no switch.
//
// (Category filtering, the 3D-first ordering, the theme switch and the language switch
// are the other platform features; they live in `page.js` because they are about the LIST
// rather than about a dish.)
//
// ── what is verbatim and what is adapted ─────────────────────────────────────────────
//
// The behaviour is the platform's, function for function, from `index.html`. Two things
// are genuinely different, and both are because our page is rendered on the SERVER:
//
//   1. **Wiring is delegated.** `renderMenuCard` attaches nine listeners to every card as
//      it builds it. Our cards are already in the HTML when this file runs, so there is
//      nothing to attach them during. One listener on `#menu-list` does the same job for
//      170 cards, and keeps working when the filter shows and hides them.
//
//   2. **Items come from `window.__ITEMS`.** Their `menuItems` array is what the fetch
//      returned. Ours is rebuilt from the cards (see `shim.js`), which carries everything
//      except variants and add-ons - those are structured data with prices in them and
//      cannot be read back out of markup honestly. So the server emits exactly those two
//      fields, for the ~18% of dishes that have them, and nothing else is duplicated.
//
// Three tenant special cases from the original are deliberately dropped: Mugsy's basket
// thumbnails, BAOMA's empty-basket suppression, and Burger Planet's three hardcoded
// delivery links. Each is one restaurant's arrangement, not a platform feature.

(function () {
  "use strict";

  // ── selections, shared with the lightbox and the modal ────────────────────────────
  // Kept on `window` because `viewer.js` reads them by those exact names. A diner who
  // picks "Bottle" on the card and then opens the dish sees Bottle selected there too;
  // that is one selection, stored once.
  window.__variantSel = window.__variantSel || {};
  window.__addonSel = window.__addonSel || {};

  // The basket. A Map keyed by `_basketKey` - not by item index - because one dish can be
  // in the basket twice with different sizes, and those are two lines, not one.
  window._basket = window._basket || new Map();

  // Which dishes this diner has already seen in 3D or in AR. `viewer.js` writes to them
  // and `addToBasket` reads them, because "did 3D make them order it" is the one number
  // this whole company is a bet on.
  window._arViewedItems = window._arViewedItems || new Set();
  window._modalViewedItems = window._modalViewedItems || new Set();
  window._xrAddedKeys = window._xrAddedKeys || new Set();

  const $ = (id) => document.getElementById(id);
  const esc = window._escapeHtml;

  // ── prices ────────────────────────────────────────────────────────────────────────
  // Their arithmetic, unchanged. Prices are free text on a menu ("16 / 70 ₾", "from 12"),
  // so the basket parses the digits out rather than assuming a number - and a line that
  // parses to nothing contributes nothing rather than NaN, which would poison the total.

  function _parsePrice(str) {
    return parseFloat(String(str).replace(/[^\d.]/g, "")) || 0;
  }
  function _fmtPrice(num) {
    const n = Math.round(num * 10) / 10;
    return n + " ₾";
  }
  // Unit price of a basket line = item price + any selected add-on prices.
  function _addonSum(entry) {
    const list = (entry.item && entry.item.addons) || [];
    return (entry.aIdx || []).reduce(
      (s, i) => s + _parsePrice(list[i] && list[i].price), 0);
  }
  // Base price = the chosen variant's price when the item has variants, otherwise the
  // item's own price. Add-on prices stack on top of either.
  function _lineBase(entry) {
    const item = entry.item;
    if (entry.vIdx != null && item.variants && item.variants[entry.vIdx]) {
      return _parsePrice(item.variants[entry.vIdx].price);
    }
    return _parsePrice(item.price);
  }
  function _lineUnit(entry) { return _lineBase(entry) + _addonSum(entry); }

  function _basketTotal() {
    let s = 0;
    window._basket.forEach((entry) => { s += _lineUnit(entry) * entry.qty; });
    return s;
  }
  function _basketCount() {
    let n = 0;
    window._basket.forEach(({ qty }) => { n += qty; });
    return n;
  }

  // Russian counts three ways and getting it wrong reads as a machine wrote the menu.
  function _ruPlural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  // ── the key ───────────────────────────────────────────────────────────────────────
  // "12", "12~v1", "12~v1#0,3". A dish, optionally a size, optionally a set of add-ons.
  // Sorted before joining so that picking bacon then cheese and cheese then bacon are the
  // same line rather than two.
  function _basketKey(globalIdx, vIdx, aIdxSorted) {
    let k = String(globalIdx);
    if (typeof vIdx === "number" && vIdx >= 0) k += "~v" + vIdx;
    if (aIdxSorted && aIdxSorted.length) k += "#" + aIdxSorted.join(",");
    return k;
  }

  // ── markup the modal and the lightbox ask for ─────────────────────────────────────
  // `viewer.js` calls all four of these while building its panels. They were the stubs
  // that returned "".

  // A saved customer choice wins; otherwise choose the first choice with a photo. That
  // prevents a pictureless first choice (for example Veggie) from becoming the default
  // card state when the available photo is Chicken.
  function _variantIndex(item, globalIdx) {
    const s = window.__variantSel[globalIdx];
    if (typeof s === "number" && item.variants && item.variants[s]) return s;
    const pictured = (item.variants || []).findIndex(
      (v) => v && v.image_url);
    return pictured >= 0 ? pictured : 0;
  }

  function _selectedVariantImage(item, globalIdx) {
    if (!item.variants || !item.variants.length) return "";
    const v = item.variants[_variantIndex(item, globalIdx)];
    return (v && v.image_url) || "";
  }

  function _choiceLabel(c, lang) {
    return (c && (c[lang] || c.en || c.ka)) || "";
  }

  // Single-select size/price pills (e.g. Glass / Bottle). Empty -> nothing shown.
  function _variantsHtml(item, globalIdx) {
    if (!item.variants || !item.variants.length) return "";
    const sel = _variantIndex(item, globalIdx);
    const rows = item.variants.map(function (v, i) {
      // Same rule as markup.js: the label is stored under its language code, so a
      // third language needs a key and not a code change.
      const n = esc(_choiceLabel(v, window.__lang));
      const p = esc(v.price || "");
      const on = i === sel;
      return `<button type="button" class="variant${on ? " selected" : ""}" data-vi="${i}"` +
        ` role="radio" aria-checked="${on}">` +
        `<span class="variant-name">${n}</span>` +
        `<span class="variant-price">${p}</span></button>`;
    }).join("");
    return `<div class="variants" role="radiogroup">${rows}</div>`;
  }

  function _addonsHtml(item, globalIdx) {
    if (!item.addons || !item.addons.length) return "";
    const sel = window.__addonSel[globalIdx] || [];
    const rows = item.addons.map(function (a, i) {
      const n = esc(_choiceLabel(a, window.__lang));
      const p = esc(a.price || "");
      const on = sel.indexOf(i) >= 0;
      return `<button type="button" class="addon${on ? " selected" : ""}" data-ai="${i}"` +
        ` aria-pressed="${on}">` +
        `<span class="addon-l"><span class="addon-check" aria-hidden="true"></span>` +
        `<span class="addon-name">${n}</span></span>` +
        `<span class="addon-price">+${p}</span></button>`;
    }).join("");
    return `<div class="addons">${rows}</div>`;
  }

  // Add-to-basket control. Shared by photo cards and text-only cards so the two cannot
  // drift apart. Starts as the cart button; `_syncQtyCtrl` swaps in the stepper once the
  // item is in the basket. The server renders one of these into every card - this copy is
  // for the modal and the lightbox, which build their panels at runtime.
  const CART_SVG =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ' stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>' +
    '<path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>';

  function _qtyCtrlHtml(globalIdx) {
    return `<div class="qty-ctrl" data-idx="${globalIdx}">` +
      `<button class="qty-add-btn" aria-label="Add to basket">${CART_SVG}</button>` +
      `<div class="qty-stepper">` +
      `<button class="qty-dec">&#8722;</button>` +
      `<span class="qty-num">1</span>` +
      `<button class="qty-inc">+</button>` +
      `</div></div>`;
  }

  // ── the basket ────────────────────────────────────────────────────────────────────

  function _updateBasketBar() {
    const count = _basketCount();
    const bar = $("basket-bar");
    if (!bar) return;
    const show = count > 0;
    bar.classList.toggle("visible", show);
    document.body.classList.toggle("basket-bar-visible", show);
    if (!show) return;
    $("basket-bar-count").textContent = count + " " + (
      window.__lang === "ka" ? "პროდუქტი"
        : window.__lang === "ru" ? _ruPlural(count, "товар", "товара", "товаров")
          : count === 1 ? "item" : "items");
    $("basket-bar-total").textContent = _fmtPrice(_basketTotal());
  }

  // Every control for one basket line, wherever it is on the page: the card, the 3D
  // modal, the lightbox. They share a `data-idx`, so they cannot disagree about a
  // quantity - which is the whole reason the platform keyed them that way.
  function _syncQtyCtrl(key) {
    const entry = window._basket.get(key);
    const qty = entry ? entry.qty : 0;
    document.querySelectorAll('.qty-ctrl[data-idx="' + key + '"]').forEach(function (ctrl) {
      const addBtn = ctrl.querySelector(".qty-add-btn");
      const stepper = ctrl.querySelector(".qty-stepper");
      const numEl = ctrl.querySelector(".qty-num");
      if (!addBtn || !stepper) return;
      if (qty > 0) {
        addBtn.style.display = "none";
        stepper.classList.add("visible");
        if (numEl) numEl.textContent = qty;
      } else {
        addBtn.style.display = "";
        stepper.classList.remove("visible");
      }
    });
  }

  function addToBasket(key, item, aIdx, vIdx) {
    if (!item) return;
    const isNew = !window._basket.has(key);
    if (!isNew) window._basket.get(key).qty++;
    else window._basket.set(key, {
      item: item, qty: 1, aIdx: aIdx || [],
      vIdx: typeof vIdx === "number" ? vIdx : null,
    });
    if (isNew) {
      // The number the company is a bet on: did the dish they added come after they
      // looked at it in 3D, or in AR, or neither.
      const bIdx = parseInt(key, 10);
      window.track("basket_add", bIdx, {
        after_ar: window._arViewedItems.has(bIdx),
        after_3d: window._modalViewedItems.has(bIdx),
      });
    }
    _syncQtyCtrl(key);
    _updateBasketBar();
    if (_panelOpen()) _renderBasketPanel();
  }

  function _setQty(key, qty) {
    if (qty <= 0) {
      if (window._basket.has(key)) window.track("basket_remove", parseInt(key, 10));
      window._basket.delete(key);
    } else if (window._basket.has(key)) {
      window._basket.get(key).qty = qty;
    }
    _syncQtyCtrl(key);
    _updateBasketBar();
    if (_panelOpen()) _renderBasketPanel();
  }

  function _panelOpen() {
    const p = $("basket-panel");
    return !!p && p.style.display === "flex";
  }

  function _renderBasketPanel() {
    const u = window.UI[window.__lang] || window.UI.en;
    const box = $("basket-items");
    if (!box) return;
    box.innerHTML = "";
    $("basket-title").textContent = u.basketTitle;
    $("basket-clear").textContent = u.clearBasket;
    $("basket-close").textContent = u.close;
    $("basket-total-label").textContent = u.total;
    $("basket-waiter-label").textContent = u.showWaiter;
    if (window._basket.size === 0) {
      box.innerHTML = `<p class="basket-empty">${esc(u.emptyBasket)}</p>`;
    } else {
      window._basket.forEach(function (entry, key) {
        const item = entry.item, qty = entry.qty, aIdx = entry.aIdx, vIdx = entry.vIdx;
        const line = _lineUnit(entry) * qty;
        const v = vIdx != null && item.variants && item.variants[vIdx];
        const varTxt = v ? _choiceLabel(v, window.__lang) : "";
        const addTxt = (aIdx && aIdx.length)
          ? aIdx.map(function (i) {
            const a = (item.addons || [])[i];
            return a ? _choiceLabel(a, window.__lang) : "";
          }).filter(Boolean).join(", ")
          : "";
        const row = document.createElement("div");
        row.className = "basket-item";
        row.innerHTML =
          `<div class="basket-item-info">` +
          `<span class="basket-item-name">${esc(window.t(item, "name"))}</span>` +
          (varTxt ? `<span class="basket-item-addons">${esc(varTxt)}</span>` : "") +
          (addTxt ? `<span class="basket-item-addons">+ ${esc(addTxt)}</span>` : "") +
          `</div>` +
          `<div class="basket-qty">` +
          `<button class="qty-btn" data-key="${esc(key)}" data-delta="-1">&#8722;</button>` +
          `<span class="qty-count">${qty}</span>` +
          `<button class="qty-btn" data-key="${esc(key)}" data-delta="1">+</button>` +
          `</div>` +
          `<span class="basket-item-price">${_fmtPrice(line)}</span>`;
        box.appendChild(row);
      });
    }
    $("basket-total").textContent = _fmtPrice(_basketTotal());
  }

  function _openBasket() {
    window.track("basket_open");
    _renderBasketPanel();
    const panel = $("basket-panel");
    panel.style.display = "flex";
    requestAnimationFrame(function () { panel.classList.add("active"); });
    document.body.style.overflow = "hidden";
  }
  function _closeBasket() {
    const panel = $("basket-panel");
    panel.classList.remove("active");
    setTimeout(function () { panel.style.display = "none"; }, 230);
    document.body.style.overflow = "";
  }

  function _clearBasket(counted) {
    if (counted && window._basket.size > 0) {
      // The one place a diner tells us the offer was wrong: a full basket, abandoned.
      const snapshot = [];
      let total = 0;
      window._basket.forEach(function (entry) {
        snapshot.push({
          name: entry.item.name, qty: entry.qty, price: _fmtPrice(_lineUnit(entry)),
        });
        total += _lineUnit(entry) * entry.qty;
      });
      window.track("basket_clear", null, {
        item_count: snapshot.length, items: snapshot,
        total_gel: Math.round(total * 10) / 10,
      });
    }
    const keys = Array.from(window._basket.keys());
    window._basket.clear();
    keys.forEach(_syncQtyCtrl);
    _updateBasketBar();
  }

  // ── show to staff ─────────────────────────────────────────────────────────────────
  // The basket is packed into a URL fragment and drawn as a QR. Staff scan it and get the
  // order on their own phone, resolved against the LIVE menu so prices are always current.
  // Everything is client-side and the library loads on the first tap, so a diner who never
  // orders never downloads it.

  let _qrLibPromise = null;
  function _loadQRLib() {
    if (window.qrcode) return Promise.resolve();
    if (_qrLibPromise) return _qrLibPromise;
    _qrLibPromise = new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = "/vendor/qrcode.js";
      s.onload = function () { resolve(); };
      s.onerror = function () { _qrLibPromise = null; reject(new Error("qr lib failed")); };
      document.head.appendChild(s);
    });
    return _qrLibPromise;
  }

  function _packOrder() {
    const it = [];
    window._basket.forEach(function (entry) {
      const item = entry.item;
      // The dish's REAL id, not its position. A position is meaningless to the staff page,
      // which re-resolves every line against the live menu - and meaningless five minutes
      // later if the owner hides a dish.
      if (!item || !item.id) return;
      // [id, qty] · [id, qty, [add-on idx]] · [id, qty, [add-on idx], variantIdx]
      const hasA = entry.aIdx && entry.aIdx.length;
      const hasV = typeof entry.vIdx === "number";
      if (hasV) it.push([item.id, entry.qty, hasA ? entry.aIdx : [], entry.vIdx]);
      else if (hasA) it.push([item.id, entry.qty, entry.aIdx]);
      else it.push([item.id, entry.qty]);
    });
    const payload = {
      v: 1,
      r: document.documentElement.dataset.tenant || "",
      ts: Date.now(),
      it: it,
    };
    // UTF-8-safe base64url. Georgian dish names are multi-byte and plain btoa throws on
    // them; the staff page decodes with the mirror of this.
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return { b64: b64, count: it.length };
  }

  async function _showWaiterQR() {
    const overlay = $("waiter-overlay");
    const box = $("waiter-qr");
    const u = window.UI[window.__lang] || window.UI.en;
    const packed = _packOrder();
    if (!packed.count) return;          // empty basket -> nothing to show

    $("waiter-overlay-title").textContent = u.showWaiter;
    $("waiter-overlay-hint").textContent = u.waiterHint;
    box.innerHTML = "";
    overlay.classList.add("active");
    document.body.style.overflow = "hidden";

    try {
      await _loadQRLib();
      const url = location.origin + "/w/" +
        encodeURIComponent(document.documentElement.dataset.tenant || "") +
        "#" + packed.b64;
      // Prefer 'M' (~15% error correction - most reliable scan across a table, in the
      // dark, on a cracked screen). A very large basket exceeds 'M' capacity, so fall
      // back to 'L' (~7%, more data) before giving up.
      let svg = null;
      for (const ecc of ["M", "L"]) {
        try {
          const qr = window.qrcode(0, ecc);   // 0 = auto-size version
          qr.addData(url);
          qr.make();
          svg = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
          break;
        } catch (_capacity) { /* try the next, lower-ECC level */ }
      }
      if (!svg) throw new Error("too large for a single code");
      box.innerHTML = svg;
      window.track("waiter_qr_shown", null, { item_count: packed.count });
    } catch (err) {
      box.innerHTML = '<p style="color:#b00020;font-size:0.85rem;padding:24px 12px;">' +
        "This order is too large for one code - please call the waiter over.</p>";
    }
  }

  function _closeWaiterOverlay() {
    $("waiter-overlay").classList.remove("active");
    document.body.style.overflow = "";
  }

  // ── published, because the ported viewer calls every one of these by name ──────────
  window._parsePrice = _parsePrice;
  window._fmtPrice = _fmtPrice;
  window._lineUnit = _lineUnit;
  window._basketTotal = _basketTotal;
  window._basketCount = _basketCount;
  window._ruPlural = _ruPlural;
  window._basketKey = _basketKey;
  window._variantIndex = _variantIndex;
  window._selectedVariantImage = _selectedVariantImage;
  window._variantsHtml = _variantsHtml;
  window._addonsHtml = _addonsHtml;
  window._qtyCtrlHtml = _qtyCtrlHtml;
  window._syncQtyCtrl = _syncQtyCtrl;
  window._updateBasketBar = _updateBasketBar;
  window._renderBasketPanel = _renderBasketPanel;
  window.addToBasket = addToBasket;
  window._setQty = _setQty;
  window._openBasket = _openBasket;
  window._closeBasket = _closeBasket;
  window._showWaiterQR = _showWaiterQR;

  // ── wiring ────────────────────────────────────────────────────────────────────────
  //
  // Everything below binds to markup that `chrome.html` puts in the page. If any of it is
  // missing the listeners throw, and a throw HERE would take `viewer.js` down with it -
  // which is exactly the failure that shipped. So it is wrapped, and it says which id it
  // could not find rather than dying anonymously on line 18 of something else.

  function wire() {
    const list = $("menu-list");
    if (list) {
      // One listener for every card, instead of nine per card. The cards are in the HTML
      // before this file runs, and the filter hides and shows them rather than rebuilding
      // them, so there is no moment at which a card needs its own listeners attached.
      list.addEventListener("click", onCardClick);
    }

    $("basket-bar").addEventListener("click", _openBasket);
    $("basket-bar-delete").addEventListener("click", function (e) {
      e.stopPropagation();
      _clearBasket(false);
    });
    $("basket-close").addEventListener("click", _closeBasket);
    $("basket-panel").addEventListener("click", function (e) {
      if (e.target === $("basket-panel")) _closeBasket();
    });
    $("basket-clear").addEventListener("click", function () {
      _clearBasket(true);
      _renderBasketPanel();
    });
    $("basket-items").addEventListener("click", function (e) {
      const btn = e.target.closest(".qty-btn");
      if (!btn) return;
      const entry = window._basket.get(btn.dataset.key);
      if (entry) _setQty(btn.dataset.key, entry.qty + parseInt(btn.dataset.delta, 10));
    });

    $("basket-waiter-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      _showWaiterQR();
    });
    $("waiter-overlay-close").addEventListener("click", _closeWaiterOverlay);
    $("waiter-overlay").addEventListener("click", function (e) {
      if (e.target === $("waiter-overlay")) _closeWaiterOverlay();
    });

    // Add to basket from inside AR, while the dish is standing on the diner's table.
    // Tapping it again removes it, but only if AR is what put it there - a dish added
    // from the menu and then seen in AR must not vanish on a stray tap.
    $("xr-add-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      const item = window.XR && window.XR.getCurrentItem && window.XR.getCurrentItem();
      if (!item || !window.menuItems) return;
      const idx = window.menuItems.indexOf(item);
      if (idx < 0) return;
      const key = String(idx);
      if (!window._basket.has(key)) {
        addToBasket(key, item);
        window._xrAddedKeys.add(key);
      } else if (window._xrAddedKeys.has(key)) {
        _setQty(key, 0);
        window._xrAddedKeys.delete(key);
      }
      $("xr-add-btn").classList.toggle("in-basket", window._basket.has(key));
    });
  }

  /** Every tap inside the menu list. The platform's per-card handlers, in one place.
   *
   *  Order matters and is theirs: the quantity controls and the option pills claim the
   *  tap first, because a diner adjusting a size is not asking to open the dish.
   */
  function onCardClick(ev) {
    const card = ev.target.closest(".menu-item[data-idx]");
    if (!card) return;
    const idx = parseInt(card.dataset.idx, 10);
    const item = (window.menuItems || [])[idx];
    if (!item) return;

    const hasV = !!(item.variants && item.variants.length);
    const hasA = !!(item.addons && item.addons.length);

    // ── the quantity control ──
    const add = ev.target.closest(".qty-add-btn");
    if (add) {
      ev.stopPropagation();
      if (hasV || hasA) {
        // A dish with sizes or add-ons always adds through "+", because each combination
        // is its own basket line and the inline stepper cannot express which one.
        const sel = (window.__addonSel[idx] || []).slice().sort((a, b) => a - b);
        const vSel = hasV ? _variantIndex(item, idx) : null;
        addToBasket(_basketKey(idx, vSel, sel), item, sel, vSel);
        add.classList.remove("just-added");
        void add.offsetWidth;                     // restart the animation
        add.classList.add("just-added");
      } else {
        addToBasket(String(idx), item);
      }
      return;
    }
    if (ev.target.closest(".qty-dec")) {
      ev.stopPropagation();
      const entry = window._basket.get(String(idx));
      if (entry) _setQty(String(idx), entry.qty - 1);
      return;
    }
    if (ev.target.closest(".qty-inc")) {
      ev.stopPropagation();
      addToBasket(String(idx), item);
      return;
    }

    // ── size pills ──
    const vBtn = ev.target.closest(".variant");
    if (vBtn) {
      ev.stopPropagation();
      const vi = parseInt(vBtn.dataset.vi, 10);
      window.__variantSel[idx] = vi;
      card.querySelectorAll(".variant").forEach(function (o) {
        const on = o === vBtn;
        o.classList.toggle("selected", on);
        o.setAttribute("aria-checked", on ? "true" : "false");
      });
      // The card price follows the size. A drink whose item price reads "16 / 70" is
      // showing a summary; the real number is the one the diner just chose.
      const pv = item.variants[vi];
      const priceEl = card.querySelector(".price");
      if (priceEl && pv) priceEl.textContent = pv.price || "";
      // A pictureless choice keeps the main photo; a pictured one swaps this card's photo
      // and never creates a second dish.
      const img = _selectedVariantImage(item, idx);
      if (img) {
        const mv = card.querySelector("model-viewer");
        if (mv) mv.remove();
        const wrap = card.querySelector(".thumb-wrap");
        if (wrap) wrap.classList.remove("thumb-model-ready");
        const thumb = card.querySelector(".thumb-img");
        if (thumb) {
          thumb.dataset.model = "";
          delete thumb.dataset.upgraded;
          thumb.src = img;
        }
      }
      return;
    }

    // ── add-on checkboxes ──
    const aBtn = ev.target.closest(".addon");
    if (aBtn) {
      ev.stopPropagation();
      const ai = parseInt(aBtn.dataset.ai, 10);
      const arr = window.__addonSel[idx] || (window.__addonSel[idx] = []);
      const at = arr.indexOf(ai);
      const on = at < 0;
      if (on) arr.push(ai); else arr.splice(at, 1);
      aBtn.classList.toggle("selected", on);
      aBtn.setAttribute("aria-pressed", on ? "true" : "false");
      return;
    }

    // ── the AR button ──
    if (ev.target.closest(".ar-btn")) {
      ev.stopPropagation();
      window.openAR(idx, window.menuItems);
      return;
    }

    // ── everything else opens the dish ──
    //
    // A 3D dish opens the 3D viewer; a photo dish opens the photo. Both are the platform's
    // behaviour, and the thumbnail is deliberately NOT handled here: once a poster
    // upgrades to a live <model-viewer>, `_upgradeThumb` puts its own pointer pair on it
    // so that a DRAG rotates the dish and only a real tap opens the modal. Handling the
    // thumbnail here as well would fight that - every rotation ends in a click that
    // bubbles, and the modal would open when the diner was turning the plate round.
    if (ev.target.closest(".thumb-wrap")) return;

    if (item.is_3d) window.openModal(idx, window.menuItems);
    else if (item.thumbnail_url) window.openLightbox(item.thumbnail_url,
      window.t(item, "name"), item, idx);
  }

  // Bound after the DOM exists but before `__bootViewer` runs, so a diner who taps a card
  // in the first second gets the same behaviour as one who waits.
  function start() {
    try {
      wire();
      _updateBasketBar();
    } catch (err) {
      // Named loudly on purpose. The whole reason this file exists is that a missing
      // element once produced a TypeError with no name on it, and the visible symptom was
      // "the menu is fine but nothing works" for two weeks.
      window.__platformError = err;
      console.error("[betareal] platform layer failed to wire - is chrome.html in the " +
        "page? Every basket, lightbox and AR control needs its markup present.", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
