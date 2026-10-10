// ─── fm.js — Food & Market's kitchens: the picker, the tabs, "← Kitchens" ──────────────
//
// The platform's `_fmSyncLanding` / `_setGroup` / landing-tile handlers, for a page whose
// cards arrive already tagged with `data-fm-kitchen` (markup.js). Which kitchen is on
// screen is one attribute, `html[data-fm-group]`, and the stylesheet hides the rest - so
// the category filter in page.js keeps working unchanged inside a kitchen.
//
// Inert on every other restaurant: it returns at once unless the page is Food & Market.
(function () {
  const root = document.documentElement;
  if (root.dataset.tenant !== "food-market-main") return;

  const KITCHENS = ["georgian", "thai", "japanese", "drinks"];
  const LABELS = {
    en: { georgian: "Georgian & More", thai: "Thai", japanese: "Japanese", drinks: "Drinks" },
    ka: { georgian: "ქართული და სხვა", thai: "ტაილანდური", japanese: "იაპონური", drinks: "სასმელები" },
  };
  const track = (name, meta) => { if (typeof window.track === "function") window.track(name, null, meta); };

  function setUrl(kitchen) {
    const url = new URL(location.href);
    if (kitchen) url.searchParams.set("menu", kitchen); else url.searchParams.delete("menu");
    history.replaceState(history.state, "", url);
  }

  // The 3D block and the "3D" pill only when this kitchen has a 3D dish in it.
  function sync3d(kitchen) {
    const block = document.querySelector('.cat-section[data-cat="__ar3d"]');
    const any = !!(block && block.querySelector(`.menu-item[data-fm-kitchen="${kitchen}"]`));
    if (block) block.toggleAttribute("data-fm-empty", !any);
    const pill = document.querySelector('.cat-pill[data-cat="__ar3d"]');
    if (pill) pill.hidden = !any;
  }

  function setGroup(kitchen) {
    if (!KITCHENS.includes(kitchen)) return;
    root.dataset.fmGroup = kitchen;
    document.querySelectorAll(".group-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.group === kitchen));
    sync3d(kitchen);
    // Back to "All" inside the new kitchen, as the platform does.
    if (typeof window.applyFilter === "function") window.applyFilter("");
    const scroll = document.querySelector(".cat-filter");
    if (scroll) scroll.scrollLeft = 0;
  }

  function enter(kitchen, source) {
    setUrl(kitchen);
    root.dataset.fmLanding = "0";
    track("menu_group", { group: kitchen, source });
    setGroup(kitchen);
    window.scrollTo(0, 0);
  }

  function start() {
    document.querySelectorAll("#fm-kitchen-landing .fm-kitchen-tile").forEach((btn) =>
      btn.addEventListener("click", () => enter(btn.dataset.kitchen, "landing")));
    const groups = document.getElementById("menu-groups");
    if (groups) groups.addEventListener("click", (ev) => {
      const b = ev.target.closest(".group-btn");
      if (b && b.dataset.group !== root.dataset.fmGroup) enter(b.dataset.group, "tab");
    });
    const back = document.getElementById("fm-back-to-kitchens");
    if (back) back.addEventListener("click", () => {
      setUrl(null);
      root.dataset.fmLanding = "1";
      window.scrollTo(0, 0);
    });
    sync3d(root.dataset.fmGroup || "georgian");
    // The motion script (fm-motion.js) primes its scroll reveal when the list changes or
    // `data-fm-motion` flips. Our list is already in the HTML and never changes, so flip
    // the attribute once after it has attached its observers.
    setTimeout(() => {
      if (!root.hasAttribute("data-fm-motion")) return;
      root.removeAttribute("data-fm-motion");
      root.setAttribute("data-fm-motion", "");
    }, 0);

    // Tab labels follow the language switch. page.js calls its own applyLang directly,
    // so this listens for the `lang` attribute it sets rather than wrapping the function.
    new MutationObserver(() => {
      const lab = LABELS[root.lang] || LABELS.en;
      document.querySelectorAll(".group-btn").forEach((b) => {
        const span = b.querySelector("span:last-child");
        (span || b).textContent = lab[b.dataset.group];
      });
    }).observe(root, { attributes: true, attributeFilter: ["lang"] });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
