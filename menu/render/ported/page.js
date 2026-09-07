// page.js — the platform features that are about the LIST rather than about a dish.
//
// Category filtering, the 3D-first ordering, the day/night switch and the language switch.
// Like `platform.js`, every one of these is a feature every menu has: a template changes
// how they LOOK, never whether they exist. Nothing here reads `data-template`.
//
// ── why this is adapted rather than copied, and where the line is ────────────────────
//
// The platform filters by re-rendering: `applyFilter` calls `renderMenuList(cat)`, which
// empties `#menu-list` and rebuilds every card from the array it fetched. It has to -
// there is nothing in its HTML until JavaScript puts it there.
//
// Our page arrives with all 170 cards already in it, grouped into `.cat-section`s, because
// that is the whole point of rendering on the server. So the same behaviour is reached by
// showing and hiding what is already there. The RULES are theirs, exactly:
//
//   `__ar3d` is a sentinel, not a category name, so a restaurant with a real category
//   called "3D" cannot collide with it.
//
//   A 3D dish appears in BOTH the 3D pill and its own category. Temo chose full
//   duplication after the platform's first version moved 3D items out of their categories
//   and diners stopped finding them.
//
//   In the "All" view the 3D block leads and then every category follows in menu order.
//   Inside a single selected category, 3D dishes come first. Both are `appendPrioritizedItems`
//   and `renderMenuList` in index.html, and both are why Temo's "3d does not appear on
//   top" was a real report and not a preference.
//
// One thing is NOT a copy and is marked where it happens: the sections use
// `display: contents`, so the `hidden` attribute cannot hide them - the author rule wins
// over the UA one. The cards and the header are hidden individually instead.

(function () {
  "use strict";

  const $$ = (s, root) => [].slice.call((root || document).querySelectorAll(s));
  const $ = (id) => document.getElementById(id);

  // The virtual category. Display-only: its cards carry the same `data-idx` as the ones in
  // the real category, so the basket, AR and analytics treat them as one dish.
  const AR_CAT = "__ar3d";

  // ── categories ────────────────────────────────────────────────────────────────────

  let _activeFilter = "";

  /** Everything in one section that the filter turns on and off.
   *
   *  Not the section element itself: `.cat-section { display: contents }` is an AUTHOR
   *  rule and `[hidden]` is a user-agent one, so author wins and a hidden section stays
   *  perfectly visible. That is a silent failure - the filter appears to do nothing, which
   *  is exactly what Temo reported - so the children are hidden instead, and this comment
   *  is here so nobody "simplifies" it back.
   */
  function partsOf(section) {
    return $$(".menu-item, .category-header, .ar-featured-banner", section);
  }

  /** 3D dishes first, in a single selected category. The platform's `appendPrioritizedItems`.
   *
   *  The original order is captured once, so switching back to "All" restores the
   *  restaurant's own sequence rather than leaving a category permanently re-sorted.
   */
  function orderSection(section, arFirst) {
    const cards = $$(".menu-item", section);
    if (!cards.length) return;
    if (!section.__order) section.__order = cards.slice();
    const want = arFirst
      ? section.__order.filter((c) => c.dataset.glb)
        .concat(section.__order.filter((c) => !c.dataset.glb))
      : section.__order;
    // Only touch the DOM when the order actually differs. Re-appending 20 cards on every
    // pill tap is 20 layout invalidations for nothing.
    const now = $$(".menu-item", section);
    if (want.length === now.length && want.every((c, i) => c === now[i])) return;
    for (const card of want) section.appendChild(card);
  }

  function applyFilter(cat) {
    const sections = $$(".cat-section");
    // A pill for a category that no longer has anything in it falls back to All, rather
    // than showing a diner an empty menu.
    if (cat && cat !== AR_CAT && !sections.some((s) => s.dataset.cat === cat)) cat = "";
    _activeFilter = cat;

    for (const section of sections) {
      const mine = section.dataset.cat || "";
      const on = cat === "" || mine === cat;
      for (const el of partsOf(section)) el.hidden = !on;
      // 3D first only inside a single selected category. In the All view the 3D block
      // above already leads, and the categories below keep the owner's own order.
      orderSection(section, on && cat !== "" && cat !== AR_CAT);
    }

    const bar = $("cat-filter");
    if (bar) {
      for (const p of $$(".cat-pill", bar)) {
        p.classList.toggle("active", (p.dataset.cat || "") === cat);
      }
    }
    // The AR buttons reset to their idle label: a filter change can hide the dish whose
    // model was mid-load, and a button left saying "Loading..." never stops.
    if (typeof setARButtonsState === "function") setARButtonsState(false);
  }

  function wireCategories() {
    const bar = $("cat-filter");
    if (!bar) return;
    bar.addEventListener("click", (ev) => {
      const pill = ev.target.closest(".cat-pill");
      if (!pill) return;
      const cat = pill.dataset.cat || "";
      window.track("category_filter", null, {
        category: cat === AR_CAT ? "3D" : (pill.textContent || "All"),
      });
      applyFilter(cat);
      // Back to the top of the list. Tapping "Desserts" after scrolling through Breakfast
      // otherwise lands the diner halfway down a category they just chose.
      const list = $("menu-list");
      if (list && _activeFilter) {
        const top = list.getBoundingClientRect().top + window.scrollY - 96;
        window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      }
    });

    // The scroll arrows only mean anything when the pills actually overflow, which depends
    // on the phone, the language and how many categories a restaurant has - so it is
    // measured rather than assumed. Monday Greens has 26.
    const left = document.querySelector(".cat-nav-l");
    const right = document.querySelector(".cat-nav-r");
    const sync = () => {
      const over = bar.scrollWidth > bar.clientWidth + 4;
      if (left) left.hidden = !over || bar.scrollLeft <= 2;
      if (right) {
        right.hidden = !over ||
          bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 2;
      }
    };
    const nudge = (dir) =>
      bar.scrollBy({ left: dir * bar.clientWidth * 0.7, behavior: "smooth" });
    if (left) left.addEventListener("click", () => nudge(-1));
    if (right) right.addEventListener("click", () => nudge(1));
    bar.addEventListener("scroll", sync, { passive: true });
    addEventListener("resize", sync);
    sync();
  }

  // ── language ──────────────────────────────────────────────────────────────────────
  //
  // Every translation is already in the page - the card carries `data-name-ka` and
  // `data-desc-ka`, the pill carries `data-cat-ka`. Switching is a swap, not a re-fetch
  // and not a re-render: a diner changing language must not watch the menu reload, which
  // is the same principle as the whole no-flash design.

  const LABEL = { en: "EN", ka: "ქარ", ru: "RU" };
  const CASED = { en: "En", ka: "Ka", ru: "Ru" };   // dataset keys: data-name-ka -> nameKa

  function applyLang(lang, langs) {
    document.documentElement.lang = lang;
    window.__lang = lang;
    try { localStorage.setItem("br-lang", lang); } catch (_) { /* private mode */ }

    const suffix = CASED[lang] || "";
    for (const card of $$(".menu-item")) {
      const d = card.dataset;
      const nameEl = card.querySelector(".item-name");
      if (nameEl) {
        const alt = lang === "en" ? d.name : (d["name" + suffix] || d.name);
        if (alt && nameEl.textContent !== alt) nameEl.textContent = alt;
      }
      const descEl = card.querySelector(".ingredients");
      if (descEl) {
        const alt = lang === "en" ? d.desc : (d["desc" + suffix] || d.desc);
        if (alt != null && descEl.textContent !== alt) descEl.textContent = alt;
      }
    }
    for (const el of $$(".cat-pill, .category-header")) {
      const d = el.dataset;
      const alt = lang === "en" ? d.catEn : (d["cat" + suffix] || d.catEn);
      if (alt && el.textContent !== alt) el.textContent = alt;
    }
    // The size and add-on pills carry their own translations, and the basket panel is
    // built from `UI[lang]` the next time it opens.
    for (const card of $$(".menu-item")) {
      const idx = parseInt(card.dataset.idx, 10);
      const item = (window.menuItems || [])[idx];
      if (!item || !(item.variants || []).length && !(item.addons || []).length) continue;
      const vBox = card.querySelector(".variants");
      if (vBox && typeof window._variantsHtml === "function") {
        vBox.outerHTML = window._variantsHtml(item, idx);
      }
      const aBox = card.querySelector(".addons");
      if (aBox && typeof window._addonsHtml === "function") {
        aBox.outerHTML = window._addonsHtml(item, idx);
      }
    }
    if (typeof window._updateBasketBar === "function") window._updateBasketBar();

    const btn = $("lang-toggle");
    if (btn && langs.length > 1) {
      // The button always offers the OTHER language, so its label is never the one you are
      // already reading.
      const next = langs[(langs.indexOf(lang) + 1) % langs.length];
      btn.textContent = LABEL[next] || next.toUpperCase();
      btn.dataset.next = next;
    }
  }

  function wireLanguage() {
    const btn = $("lang-toggle");
    if (!btn) return;
    const langs = (btn.dataset.langs || "en").split(",");
    let start = langs[0];
    try {
      const saved = localStorage.getItem("br-lang");
      if (saved && langs.indexOf(saved) >= 0) start = saved;
    } catch (_) { /* private mode */ }
    applyLang(start, langs);
    btn.addEventListener("click", () => {
      const to = btn.dataset.next || langs[0];
      window.track("lang", null, { to });
      applyLang(to, langs);
    });
  }

  // ── day / night ───────────────────────────────────────────────────────────────────
  //
  // The button is an icon, not a word: `#theme-toggle` is a 34px fixed circle in the
  // platform's stylesheet and a word does not fit in it. It shipped with the text "Night"
  // in it, which is why Temo saw "a small button that does nothing" - it was doing
  // something, into a box too small to show it.
  //
  // The icon shows what you will GET, not where you are: a sun while it is night.

  const SVG_SUN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41' +
    'M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
  const SVG_MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  // Scoped per restaurant. One phone can carry the menus of several restaurants on the
  // same origin, and a diner who wants Corner in daylight has not asked for that at
  // Monday Greens.
  function themeKey() {
    return "br-theme:" + (document.documentElement.dataset.tenant || "-");
  }

  function applyTheme(theme, persist) {
    const root = document.documentElement;
    const btn = $("theme-toggle");
    root.setAttribute("data-theme", theme);
    if (btn) {
      btn.innerHTML = theme === "night" ? SVG_SUN : SVG_MOON;
      const u = (window.UI && window.UI[window.__lang]) || (window.UI && window.UI.en) || {};
      btn.setAttribute("aria-label",
        theme === "night" ? (u.themeDay || "Day") : (u.themeNight || "Night"));
    }
    if (persist) {
      try { localStorage.setItem(themeKey(), theme); } catch (_) { /* private mode */ }
    }
  }

  function wireTheme() {
    const btn = $("theme-toggle");
    if (!btn) return;
    let stored = null;
    try {
      const v = localStorage.getItem(themeKey());
      if (v === "day" || v === "night") stored = v;
    } catch (_) { /* private mode */ }
    // The server already rendered the restaurant's own default into `data-theme`, so with
    // no stored choice this changes nothing and there is no flash.
    applyTheme(stored || document.documentElement.getAttribute("data-theme") || "night",
      false);
    btn.addEventListener("click", () => {
      const from = document.documentElement.getAttribute("data-theme");
      const to = from === "night" ? "day" : "night";
      window.track("theme_change", null, { from, to });
      applyTheme(to, true);
    });
  }

  window.applyFilter = applyFilter;
  window.applyLang = applyLang;
  window.applyTheme = applyTheme;

  function start() {
    wireCategories();
    wireLanguage();
    wireTheme();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
