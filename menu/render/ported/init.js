// init.js — start the hero and venue features the way the platform starts them.
//
// `hero.js` is the platform's code, verbatim: the hero video, the hero-photo crossfade,
// the venue block (address, hours, map), the delivery and social links, and the featured
// strip. In their app all of it is kicked off from inside `applyRemoteTheme`, once
// theme_config has come back from Supabase.
//
// Our page has no theme_config to fetch - the server already resolved it - so this does
// the same kicking off from `window.__CFG`, which the page inlines. That object is the
// SETTINGS only: hero art, hours, links, fonts. A few hundred bytes, not the menu.
//
// The order is theirs and it matters: a configured video takes the band over and the
// photos become its poster, because two crossfades on one element is a flicker, not a
// feature.

(function () {
  "use strict";

  // Their sets, for the two templates that matter. Monday Greens takes the photo
  // gallery; elegant_black (Corner at Tabidze) does not, but does take the video.
  const HERO_GALLERY = new Set(["monday_greens", "burger_lions", "elegant_black"]);

  function start() {
    const cfg = window.__CFG || {};

    // **A diner opened the menu.** The first row of the funnel and the denominator of
    // every percentage under it.
    //
    // The platform fires this from inside `buildMenu`, which is the function that fetches
    // the dishes - and we deleted that function, because our dishes arrive in the HTML.
    // The event went with it and nobody noticed, so the analytics screen showed "Opened
    // the menu: 0" above "Got past the hero: 4" and "Placed it on a table: 1". A funnel
    // that widens as it goes is not a small reporting bug; it is the one screen a paying
    // restaurant looks at to decide whether any of this works, saying something obviously
    // untrue.
    //
    // First, before the hero and before the viewer, because it must survive a diner who
    // closes the tab immediately - which is itself a number worth having.
    try { window.track("view"); } catch (e) { /* never let a count break a menu */ }
    // hero.js and viewer.js both read the global config the platform sets.
    window._themeConfig = Object.assign(window._themeConfig || {}, cfg);

    try {
      if (typeof _applyVenueInfo === "function") _applyVenueInfo(cfg);
      if (typeof _applyVenueLinks === "function") _applyVenueLinks(cfg);
      if (typeof _applyVenueMap === "function") _applyVenueMap(cfg);
    } catch (e) { console.warn("venue block:", e); }

    const template = document.documentElement.dataset.template || "";
    let shots = [];
    try {
      shots = typeof _parseHeroImages === "function"
        ? _parseHeroImages(cfg.hero_images) : [];
    } catch (e) { shots = []; }
    if (!shots.length && cfg.hero_image_url) shots = [cfg.hero_image_url];

    let videoOn = false;
    try {
      // Deliberately never on the critical path: the band paints from the poster on the
      // first frame and the clip is attached on idle. Skipped entirely on Data Saver, on
      // 2G and under prefers-reduced-motion - their rules, kept.
      if (typeof _startHeroVideo === "function") videoOn = !!_startHeroVideo(cfg);
    } catch (e) { console.warn("hero video:", e); }

    try {
      if (!videoOn && HERO_GALLERY.has(template) && shots.length > 1
          && typeof _startHeroGallery === "function") {
        _startHeroGallery(shots);
      }
    } catch (e) { console.warn("hero gallery:", e); }

    // Per-tenant hero height, e.g. "56.25vw" for a full 16:9 band.
    if (cfg.hero_min_h) {
      document.documentElement.style.setProperty("--mg-hero-h", cfg.hero_min_h);
    }

    // 360-degree auto-spin in the 3D viewer. Off unless the owner turned it on.
    window.__spinEnabled = /^(1|true|on|yes)$/i.test(String(cfg.spin_enabled || "").trim());
    const spin = document.getElementById("modal-spin");
    if (spin && !window.__spinEnabled) spin.style.display = "none";

    // ── the 3D, last, and NOT optional ────────────────────────────────────────────
    //
    // `__bootViewer` reads the cards back into the item list the viewer works on, binds
    // the thumbnails, starts the poster-to-live-3D upgrades and warms the AR carousel.
    //
    // **Nothing called it.** It was defined in `shim.js` and invoked from nowhere, so on
    // every deployed page `menuItems` stayed `[]`: no thumbnail ever became a live model,
    // no AR model was ever preloaded, and every 3D and AR event was filed against item
    // index -1. The page looked complete, so it took a person on a phone to notice - the
    // same shape of failure as the stubs, and the reason `check_render.py` now asserts
    // that this call exists rather than only that the file does.
    //
    // Deferred to idle: it touches 175 cards and can wait until after the first paint,
    // which is the whole reason the menu is in the HTML.
    try {
      window.idle(function () { window.__bootViewer(); });
    } catch (e) {
      console.error("[betareal] the 3D viewer failed to boot", e);
    }
  }

  if (document.readyState === "complete") start();
  else addEventListener("load", start, { once: true });
})();
