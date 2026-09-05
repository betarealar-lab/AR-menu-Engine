// shim.js — everything the ported viewer expects from the app it was lifted out of.
//
// `viewer.js` and `xr.js` are VERBATIM from the live platform's index.html. They are not
// edited, because the whole point of taking them is that they already work on real phones
// in real restaurants. What they need from around them is small and listed here, and this
// file is the only place our menu and their code meet.
//
// Nine symbols, and each stub says honestly what it is:
//
//   menuItems              built from the page's own cards, in their item shape
//   _themeConfig           carries per-item camera angles, same key format
//   UI / window.__lang     the English strings the viewer shows
//   track                  analytics. A no-op HERE, with a queue, because the menu has
//                          no analytics yet and a silent drop would be a lie
//   idle                   requestIdleCallback with a setTimeout fallback
//   _trackFirstInteraction the funnel marker. No-op for the same reason as track
//   addToBasket / _setQty / _syncQtyCtrl / _basketKey / _basket
//                          the basket. There ISN'T one in the self-serve menu yet, so
//                          these are stubs and the qty controls are hidden by CSS. When
//                          the basket is built, this is where it connects.

(function () {
  "use strict";

  // ── DOM the ported code wires up at top level ─────────────────────────────────
  // `viewer.js` binds its listeners as the script runs, not lazily. Any element it
  // expects and does not find is `null.addEventListener` - a TypeError that aborts the
  // REST of the block, leaving every `let` after it in the temporal dead zone. The
  // symptom is baffling: openModal exists (function declarations hoist) but throws
  // "Cannot access '_mvPromise' before initialization" when called.
  //
  // These nine are the photo LIGHTBOX - tap a photo-only dish to see it full size. We
  // have no item photos yet (`items.photo_key` exists and nothing writes to it), so the
  // feature has nothing to show and its markup was not ported. Stubs rather than edits
  // to viewer.js: when photos arrive, port the real markup and delete this list.
  ["img-lightbox", "lightbox-panel", "lightbox-img", "lightbox-name", "lightbox-desc",
   "lightbox-price", "lightbox-options", "lightbox-close", "lightbox-qty"
  //
  // The stubs need CHILDREN too, not just ids: the wiring reaches inside them, e.g.
  // `_lbQtyCtrl.querySelector('.qty-add-btn').addEventListener(...)`. An empty <div>
  // gets one line further and fails the same way.
  ].forEach(function (id) {
    if (document.getElementById(id)) return;
    const el = document.createElement("div");
    el.id = id;
    el.hidden = true;
    el.style.display = "none";
    if (id.endsWith("qty")) {
      ["qty-add-btn", "qty-dec", "qty-inc"].forEach(function (cls) {
        const b = document.createElement("button");
        b.className = cls;
        el.appendChild(b);
      });
    }
    document.body.appendChild(el);
  });

  window.__lang = "en";
  window.UI = {
    en: {
      view: "View 3D",
      view3D: "View 3D",
      viewAR: "View on your table",
      loading: "Loading...",
      onTable: "On your table",
      floating: "Floating",
      singleBtn: "One dish",
      carouselBtn: "All dishes",
      hideUI: "Hide controls",
      showUI: "Show controls",
      hintScan: "Move your phone slowly to find a surface",
      hintStep: "Point at your table",
      hintTap: "Tap to place",
      arNoModel: "This dish has no 3D model yet.",
      arNoUsdz: "AR is not ready for this dish yet.",
      arModelMissing: "The 3D model could not be loaded.",
      arFailed: "AR could not start on this device.",
      arUnsupported: "This device does not support AR.",
    },
  };

  // Analytics. The engine has a verdict log; the MENU has no event pipeline yet
  // (MENU-PLATFORM §2.5 - events go to an append-only sink, deliberately not built).
  // Queued rather than dropped so that when the sink exists, the calls are already in
  // the right places and nothing has to be re-instrumented.
  window.__events = [];
  window.track = function (event, itemIndex, extra) {
    window.__events.push({ event, itemIndex, extra, t: Date.now() });
  };
  window._trackFirstInteraction = function () {};

  window.idle = function (fn) {
    (window.requestIdleCallback || function (f) { return setTimeout(f, 1); })(fn);
  };

  // No basket in the self-serve menu yet. Stubs rather than deletions, so `viewer.js`
  // stays byte-identical to production and a future basket is a matter of filling these
  // in rather than re-porting.
  window._basket = new Map();
  window._basketKey = function (idx) { return String(idx); };
  window.addToBasket = function () {};
  window._setQty = function () {};
  window._syncQtyCtrl = function () {};

  // The platform's per-field translation picker, reproduced rather than stubbed because
  // it is on the render path for every dish name and description: t(item, 'name')
  // returns the _ka or _ru variant when one exists for the current language. The menu is
  // English-only today, so this is the fallback branch - but it is here in full so that
  // adding Georgian means putting name_ka on the item, exactly as production does it,
  // rather than discovering this function missing later.
  window._cleanText = window._cleanText || function (v) {
    return v == null ? "" : String(v).trim();
  };
  window.t = function (item, field) {
    const lang = window.__lang;
    if (lang === "ru" && item[field + "_ru"]) return _cleanText(item[field + "_ru"]);
    if (lang === "ka" && item[field + "_ka"]) return _cleanText(item[field + "_ka"]);
    return _cleanText(item[field]);
  };

  window._escapeHtml = window._escapeHtml || function (v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  // Reproduced from the platform verbatim in behaviour: the modal price, with an
  // optional struck-through "was". Not a stub, because it is on the render path for
  // every dish in the 3D modal and returning nothing would leave the price blank.
  window._setPriceWithOld = function (el, price, priceOld) {
    if (!el) return;
    el.textContent = "";
    const was = _cleanText(priceOld);
    if (was) {
      const sp = document.createElement("span");
      sp.className = "price-was";
      sp.textContent = was;
      el.appendChild(sp);
    }
    el.appendChild(document.createTextNode(_cleanText(price)));
  };

  // Variants (sizes) and add-ons. A real platform feature that the self-serve schema has
  // no columns for yet - `items` has name, price, description and one model, and adding
  // variants is a migration plus admin UI, not a shim. Returning "" is exactly what the
  // platform's own functions do for an item without them, so the modal renders the same
  // way it does for a plain dish.
  window.__variantSel = {};
  window.__addonSel = {};
  window._variantIndex = function () { return 0; };
  window._variantsHtml = function () { return ""; };
  window._addonsHtml = function () { return ""; };

  // Per-item camera angle, in the platform's own key format so `_itemCameraOrbit` works
  // unmodified: theme_config["item_view_<id>"] = "h v zoom".
  window._themeConfig = {};

  /** Build the item list the viewer works on, out of the cards already in the page.
   *
   *  The snapshot is not re-parsed and nothing is fetched: every card already carries its
   *  model url, its usdz, its name and its camera angle, because the page was rendered
   *  complete (MENU-PLATFORM §2.1a). This just reads them back.
   */
  window.menuItems = [];
  function build() {
    const cards = [].slice.call(document.querySelectorAll(".menu-item[data-idx]"));
    window.menuItems = cards.map(function (el, i) {
      const d = el.dataset;
      if (d.orbit) window._themeConfig["item_view_" + i] = d.orbit;
      return {
        id: i,
        name: d.name || "",
        name_ka: "",
        description: d.desc || "",
        description_ka: "",
        price: d.price || "",
        // Their field names. `model` is the GLB a viewer loads, `usdz` is what Quick Look
        // gets. Both are already at real-world size - see viewer.mjs on why `ar_scale`
        // is 1 here and not a number somebody has to maintain.
        model: d.glb || "",
        model_url: d.glb || "",
        usdz: d.usdz || "",
        usdz_url: d.usdz || "",
        thumbnail_url: d.poster || "",
        ar_scale: 1,
        is_3d: !!d.glb,
        text_only: !d.glb,
      };
    });
    return window.menuItems;
  }

  window.__bootViewer = function () {
    build();
    if (typeof _startThumbUpgrades === "function") _startThumbUpgrades();
    // Preload the AR carousel's models in the background, exactly as the platform does
    // after its menu renders, so the first AR tap finds them decoded.
    const ar = window.menuItems.filter(function (i) { return i.is_3d; });
    if (ar.length && window.XR && window.XR.backgroundPreload) {
      window.idle(function () { window.XR.backgroundPreload(ar); });
    }
    // The platform binds the modal to the THUMBNAIL, not the card:
    //     thumbImg.addEventListener('click', () => openModal(globalIdx, menuItems))
    // ...and once a poster upgrades to a live <model-viewer>, `_upgradeThumb` puts its
    // own pointerdown/pointerup pair on the viewer so a DRAG rotates the dish and only a
    // real tap opens the modal. Binding the card instead - which an earlier version did -
    // fights that: every rotation ends in a click that bubbles, and the modal opens when
    // the diner was only turning the plate round.
    document.querySelectorAll(".thumb-img").forEach(function (img) {
      const idx = parseInt(img.dataset.globalIdx, 10);
      if (!(window.menuItems[idx] || {}).is_3d) return;
      img.addEventListener("click", function () { openModal(idx, window.menuItems); });
    });
    // The name and the price are not the plate, so tapping them is unambiguous and opens
    // the modal directly.
    document.querySelectorAll(".menu-item[data-idx]").forEach(function (el) {
      const idx = parseInt(el.dataset.idx, 10);
      if (!(window.menuItems[idx] || {}).is_3d) return;
      el.querySelectorAll(".item-name, .price").forEach(function (hit) {
        hit.style.cursor = "pointer";
        hit.addEventListener("click", function (ev) {
          ev.stopPropagation();
          openModal(idx, window.menuItems);
        });
      });
    });
    document.querySelectorAll(".ar-btn").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        ev.stopPropagation();
        openAR(parseInt(b.dataset.idx, 10), window.menuItems);
      });
    });
    if (typeof setARButtonsState === "function") setARButtonsState(false);
  };
})();
