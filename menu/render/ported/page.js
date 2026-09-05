// page.js — the menu page's own behaviour: category filtering and the language switch.
//
// NOT ported. `viewer.js` and `xr.js` are the platform's code because they are the part
// that already works on real phones and would be idiotic to rewrite. This is the other
// kind: UI glue that is a dozen lines when written against markup we control, and would
// be several hundred if lifted out of an app that also has a basket, three fixture
// loaders, drink categories and per-tenant special cases woven through the same
// functions.
//
// The behaviour it reproduces is the platform's, and two details are deliberate:
//
//   The 3D pill is a SENTINEL (`__ar3d`), not a category name, so a restaurant with a
//   real category called "3D" does not collide with it.
//
//   A 3D dish appears in BOTH the 3D pill and its own category. Temo chose that
//   explicitly after the platform's first version moved 3D items out of their categories
//   and diners could not find them any more.

(function () {
  "use strict";

  const $$ = (s) => [].slice.call(document.querySelectorAll(s));

  // ── categories ────────────────────────────────────────────────────
  function applyFilter(cat) {
    for (const card of $$(".menu-item")) {
      const mine = card.dataset.cat || "";
      const is3d = !!card.dataset.glb;
      card.hidden = !(cat === "" || (cat === "__ar3d" ? is3d : mine === cat));
    }
    // A section heading with nothing under it is worse than no heading, and the
    // platform's list has none - the cards carry their own category.
    const bar = document.getElementById("cat-filter");
    if (bar) {
      for (const p of bar.querySelectorAll(".cat-pill")) {
        p.classList.toggle("active", (p.dataset.cat || "") === cat);
      }
    }
  }

  function wireCategories() {
    const bar = document.getElementById("cat-filter");
    if (!bar) return;
    bar.addEventListener("click", (ev) => {
      const pill = ev.target.closest(".cat-pill");
      if (pill) applyFilter(pill.dataset.cat || "");
    });

    // The scroll arrows only mean anything when the pills actually overflow, which
    // depends on the phone, the language and how many categories a restaurant has -
    // so it is measured rather than assumed. Monday Greens has 26.
    const scroller = bar;
    const left = document.querySelector(".cat-nav-l");
    const right = document.querySelector(".cat-nav-r");
    const sync = () => {
      const over = scroller.scrollWidth > scroller.clientWidth + 4;
      if (left) left.hidden = !over || scroller.scrollLeft <= 2;
      if (right) {
        right.hidden =
          !over ||
          scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 2;
      }
    };
    const nudge = (dir) =>
      scroller.scrollBy({ left: dir * scroller.clientWidth * 0.7, behavior: "smooth" });
    if (left) left.addEventListener("click", () => nudge(-1));
    if (right) right.addEventListener("click", () => nudge(1));
    scroller.addEventListener("scroll", sync, { passive: true });
    addEventListener("resize", sync);
    sync();
  }

  // ── language ──────────────────────────────────────────────────────
  // Every translation is already in the page - the card carries `data-name-ka` and the
  // server rendered the primary language into the text. Switching is a swap, not a
  // re-fetch and not a re-render: a diner changing language must not watch the menu
  // reload, which is the same principle as the whole no-flash design.
  function applyLang(lang) {
    document.documentElement.lang = lang;
    window.__lang = lang;
    for (const card of $$(".menu-item")) {
      const el = card.querySelector(".item-name");
      if (!el) continue;
      const ka = card.dataset.nameKa;
      const en = card.dataset.name;
      const wanted = lang !== "en" && ka ? ka : en;
      if (wanted && el.textContent !== wanted) el.textContent = wanted;
    }
    for (const p of $$(".cat-pill")) {
      const ka = p.dataset.catKa;
      if (!p.dataset.catEn) p.dataset.catEn = p.textContent;
      p.textContent = lang !== "en" && ka ? ka : p.dataset.catEn;
    }
    for (const b of $$(".lang-pill")) {
      b.classList.toggle("active", b.dataset.lang === lang);
    }
  }

  function wireLanguage() {
    const bar = document.querySelector(".lang-bar");
    if (!bar) return;
    bar.addEventListener("click", (ev) => {
      const b = ev.target.closest(".lang-pill");
      if (b) applyLang(b.dataset.lang);
    });
  }

  function start() {
    wireCategories();
    wireLanguage();
  }

  if (document.readyState === "complete") start();
  else addEventListener("load", start, { once: true });
})();
