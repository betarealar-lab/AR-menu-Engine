// shim.js — the ONLY adapter between the ported viewer and our page.
//
// `viewer.js`, `xr.js` and `hero.js` are VERBATIM from the live platform's index.html.
// They are not edited, because the whole point of taking them is that they already work on
// real phones in real restaurants. What they need from around them is listed here.
//
// **This file used to be where features went to die.** It contained:
//
//     window.addToBasket   = function () {};              // the basket
//     window._variantsHtml = function () { return ""; };  // glass / bottle
//
// ...and nine fake hidden <div>s wearing the photo lightbox's ids. Every one of those was
// written to stop `viewer.js` throwing, and every one of them silently deleted a feature.
// They are gone: the markup now comes from `chrome.html` and the behaviour from
// `platform.js`, both copied from the platform rather than invented here.
//
// The rule this file is now held to: **an adapter translates, it does not substitute.**
// Anything in here either renames one of our fields to one of theirs, or wires our page's
// own reality (an event sink, a table number, a config object) into a call they already
// make. If something starts returning "" or doing nothing, it does not belong here.

(function () {
  "use strict";

  // ── language ──────────────────────────────────────────────────────────────────────
  // The server rendered the restaurant's primary language into the markup, and it is on
  // the <html> element. Reading it back rather than defaulting to English means the first
  // frame and the first script agree - the platform's own version defaults to 'ka' and
  // then corrects itself, which is a flash.
  window.__lang = (document.documentElement.lang || "en").slice(0, 2);

  // `window.UI` comes from `ui.js`, extracted verbatim - all 42 strings in all three
  // languages. It used to be eleven English strings typed by hand here, which is how
  // Georgian diners were shown the word "undefined".

  // ── analytics ─────────────────────────────────────────────────────────────────────
  //
  // The viewer's own `track()` calls are unchanged and stay exactly where the platform put
  // them. Only the sink is ours.
  //
  // Names are TRANSLATED to our whitelist rather than passed through. The platform's
  // vocabulary grew over two years and has several spellings of the same idea; an open
  // name column becomes a junk drawer within a year and then no query can be trusted.
  // Anything unrecognised is counted locally and never sent.
  const EVENT_NAME = {
    view: "view", page_view: "view", page_load: "view", menu_view: "view",
    hero_pass: "hero_pass", scroll_past_hero: "hero_pass",
    category: "category", category_change: "category", category_filter: "category",
    open_modal: "item_open", view_3d: "item_open", item_open: "item_open",
    ar: "ar_open", ar_open: "ar_open", view_ar: "ar_open", ar_success: "ar_open",
    ar_placed: "ar_placed", ar_place: "ar_placed",
    // The funnel this company is a bet on: a dish added to the basket, and whether the
    // diner had seen it in 3D or in AR first.
    basket_add: "basket_add", basket_remove: "basket_remove",
    basket_open: "basket_open", basket_clear: "basket_clear",
    waiter_qr_shown: "waiter_qr",
    delivery: "delivery", order: "delivery",
    lang: "lang", theme: "theme", theme_change: "theme",
  };

  // Random, per tab, forgotten when it closes. Its only job is to tell one diner opening
  // four dishes apart from four diners opening one each. Deliberately sessionStorage and
  // not localStorage: a value that survives the tab is a value that follows somebody.
  function sessionId() {
    try {
      let id = sessionStorage.getItem("br_s");
      if (!id) {
        id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()))
          .replace(/-/g, "").slice(0, 24);
        sessionStorage.setItem("br_s", id);
      }
      return id;
    } catch (_) {
      // Private mode, or storage blocked. Still countable as one visit; just not
      // recognisable as the same one twice.
      return String(Date.now()) + String(Math.random()).slice(2, 8);
    }
  }

  const TENANT = (window.__CFG && window.__CFG.tenant_id) || "";

  // Which table this code was on. The per-table QR codes carry `?t=<n>`, and it is read
  // ONCE here rather than per event: a diner navigating within the menu keeps the same
  // table, and re-reading the URL would lose it the moment anything touched the query
  // string.
  const TABLE = (function () {
    try {
      const t = new URLSearchParams(location.search).get("t") || "";
      // Bounded and digits-only: it is printed on a card, not typed, so anything else is
      // somebody playing with the URL and does not belong in a restaurant's numbers.
      return /^\d{1,4}$/.test(t) ? t : "";
    } catch (_) { return ""; }
  })();

  let pending = [];
  let timer = null;

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!pending.length || !TENANT) return;
    const body = JSON.stringify({
      tenant: TENANT, session: sessionId(), events: pending.splice(0, 50),
    });
    try {
      // sendBeacon survives the page being closed, which is exactly when the last and most
      // interesting events happen. `fetch` with keepalive is the fallback; a plain fetch
      // would be cancelled by the navigation that triggered it.
      if (!(navigator.sendBeacon && navigator.sendBeacon("/e", body))) {
        fetch("/e", { method: "POST", body, keepalive: true }).catch(function () {});
      }
    } catch (_) { /* never let a count break a menu */ }
  }

  window.__events = [];
  window.track = function (event, itemIndex, extra) {
    window.__events.push({ event, itemIndex, extra, t: Date.now() });
    const name = EVENT_NAME[event];
    if (!name || !TENANT) return;

    // The viewer counts in its own array positions; the sink wants the dish's real id,
    // which the card already carries because the page was rendered complete.
    let item = "";
    const el = document.querySelector('.menu-item[data-idx="' + itemIndex + '"]');
    if (el && el.dataset && el.dataset.id) item = el.dataset.id;

    const meta = (extra && typeof extra === "object") ? Object.assign({}, extra) : {};
    if (TABLE) meta.t = TABLE;
    pending.push({ name: name, item: item, meta: meta });
    // Batched. One beacon per burst rather than one per tap: opening a dish fires three
    // events within a second and three requests to say so is three times the cost for the
    // same information.
    if (pending.length >= 20) flush();
    else if (!timer) timer = setTimeout(flush, 4000);
  };

  // The last flush, and the one that matters most - a diner who reached AR and then closed
  // the tab is the whole funnel. `visibilitychange` fires where `unload` does not, which
  // is every iOS browser.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);

  // The platform's marker for "this visitor did something". Ours fires the one event it
  // is really for and then gets out of the way.
  let _interacted = false;
  window._trackFirstInteraction = function (type) {
    if (_interacted) return;
    _interacted = true;
    window.track("hero_pass", null, { via: type || "" });
  };

  window.idle = function (fn) {
    (window.requestIdleCallback || function (f) { return setTimeout(f, 1); })(fn);
  };

  // ── text helpers the render path calls for every dish ─────────────────────────────

  window._cleanText = window._cleanText || function (v) {
    return v == null ? "" : String(v).trim();
  };

  // The platform's per-field translation picker: t(item, 'name') returns the _ka or _ru
  // variant when one exists for the current language.
  window.t = function (item, field) {
    if (!item) return "";
    const lang = window.__lang;
    if (lang === "ru" && item[field + "_ru"]) return window._cleanText(item[field + "_ru"]);
    if (lang === "ka" && item[field + "_ka"]) return window._cleanText(item[field + "_ka"]);
    return window._cleanText(item[field]);
  };

  window._escapeHtml = window._escapeHtml || function (v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  // theme_config stores lists as JSON strings - hero_images, drink_categories. Their
  // parser, verbatim, because a malformed value must yield an empty list rather than throw
  // and take the rest of the boot with it.
  window._parseConfigList = function (raw) {
    const t = String(raw || "").trim();
    if (!t) return [];
    try {
      const list = JSON.parse(t);
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
  };

  // The modal price, with an optional struck-through "was".
  window._setPriceWithOld = function (el, price, priceOld) {
    if (!el) return;
    el.textContent = "";
    const was = window._cleanText(priceOld);
    if (was) {
      const sp = document.createElement("span");
      sp.className = "price-was";
      sp.textContent = was;
      el.appendChild(sp);
    }
    el.appendChild(document.createTextNode(window._cleanText(price)));
  };

  // Per-item camera angle, in the platform's own key format so `_itemCameraOrbit` works
  // unmodified: theme_config["item_view_<idx>"] = "h v zoom".
  window._themeConfig = window._themeConfig || {};

  /** Build the item list the viewer works on, out of the cards already in the page.
   *
   *  Nothing is fetched and the snapshot is not re-parsed: every card already carries its
   *  model url, its usdz, its name, its price and its camera angle, because the page was
   *  rendered complete. This reads them back.
   *
   *  The two exceptions are `variants` and `addons`. Those are structured data with prices
   *  in them - "Glass 16 ₾ / Bottle 70 ₾" - and reading prices back out of markup to then
   *  do arithmetic with them is the kind of shortcut that puts a wrong total in front of a
   *  paying customer. The server emits them as JSON in `window.__ITEMS`, keyed by index,
   *  for the ~18% of dishes that have any. Everything else stays in the markup, once.
   */
  window.menuItems = [];
  function build() {
    const extras = window.__ITEMS || {};
    const cards = [].slice.call(document.querySelectorAll(".menu-item[data-idx]"));
    const out = [];
    for (const el of cards) {
      const d = el.dataset;
      const i = parseInt(d.idx, 10);
      // The 3D pill renders a second card for the same dish, exactly as the platform does
      // (both carry the same index so the basket, AR and analytics treat them as one
      // item). Only the first one becomes an entry.
      if (out[i]) continue;
      // Keyed by the dish's REAL id, because `_itemCameraOrbit` looks up
      // `_themeConfig["item_view_" + item.id]`. Keyed by index it silently missed every
      // time and every model opened at the default angle.
      if (d.orbit && d.id) window._themeConfig["item_view_" + d.id] = d.orbit;
      const ex = extras[i] || extras[String(i)] || {};
      const desc = el.querySelector(".ingredients");
      out[i] = {
        // The dish's real id, for the staff QR and for the event sink. A position is
        // meaningless to both.
        id: d.id || "",
        name: d.name || "",
        name_ka: d.nameKa || "",
        name_ru: d.nameRu || "",
        description: desc ? desc.textContent.trim() : "",
        description_ka: "",
        price: d.price || "",
        price_old: d.priceOld || "",
        // Their field names. `model` is the GLB a viewer loads, `usdz` is what Quick Look
        // gets. Both are already at real-world size, which is why `ar_scale` is 1 for
        // anything from our pipeline and only an imported model carries a multiplier.
        model: d.glb || "",
        model_url: d.glb || "",
        usdz: d.usdz || "",
        usdz_url: d.usdz || "",
        thumbnail_url: d.poster || "",
        ar_scale: d.arScale ? parseFloat(d.arScale) : 1,
        // The card's own answer, not "does it have a GLB". See markup.js on `data-is3d`:
        // a dish can keep its model and still be a photo dish, and that is the owner's
        // call to make.
        is_3d: d.is3d === "1",
        text_only: el.classList.contains("no-image"),
        variants: ex.v || [],
        addons: ex.a || [],
      };
    }
    // A hole here would mean a card claimed an index no other card did, which cannot
    // happen from our renderer - but `menuItems[i]` is indexed by the whole viewer, so a
    // sparse array is worth collapsing loudly rather than carrying.
    for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = { id: "", name: "" };
    window.menuItems = out;
    return out;
  }

  window.__bootViewer = function () {
    build();
    // `viewer.js` keeps its OWN `let menuItems` at the top of the bundle's shared scope,
    // and uses it for `menuItems.indexOf(item)` when it reports which dish was viewed.
    // Left empty, every 3D and AR event was filed against index -1 - the counts existed
    // and were all wrong. Both names now point at one array.
    try { menuItems = window.menuItems; } catch (_) { /* viewer.js absent (tests) */ }

    if (typeof _startThumbUpgrades === "function") _startThumbUpgrades();
    // Preload the AR carousel's models in the background, exactly as the platform does
    // after its menu renders, so the first AR tap finds them decoded.
    const ar = window.menuItems.filter(function (i) { return i.is_3d; });
    if (ar.length && window.XR && window.XR.backgroundPreload) {
      window.idle(function () { window.XR.backgroundPreload(ar); });
    }
    // The modal is bound to the THUMBNAIL here rather than in the delegated card handler,
    // because once a poster upgrades to a live <model-viewer>, `_upgradeThumb` puts its own
    // pointerdown/pointerup pair on the viewer so a DRAG rotates the dish and only a real
    // tap opens the modal. A delegated click on the card would fight that: every rotation
    // ends in a click that bubbles, and the modal opens when the diner was only turning
    // the plate round.
    document.querySelectorAll(".thumb-img").forEach(function (img) {
      const idx = parseInt(img.dataset.globalIdx, 10);
      const item = window.menuItems[idx];
      if (!item) return;
      img.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (item.is_3d) openModal(idx, window.menuItems);
        else if (item.thumbnail_url) {
          openLightbox(item.thumbnail_url, window.t(item, "name"), item, idx);
        }
      });
    });
    // Every quantity control on the page starts in the right state - the basket survives a
    // filter change, and a diner who added two coffees and then tapped "Coffee" must still
    // see 2.
    document.querySelectorAll(".qty-ctrl[data-idx]").forEach(function (c) {
      if (typeof window._syncQtyCtrl === "function") window._syncQtyCtrl(c.dataset.idx);
    });
    if (typeof setARButtonsState === "function") setARButtonsState(false);
  };
})();
