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
    // From the picker the menu starts at the top. Between kitchens the diner keeps their
    // place: the page stays where it was scrolled (Nika's call, 2026-10-11).
    if (source === "landing") window.scrollTo(0, 0);
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
    wirePusher();
    keepModalInKitchen();
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

  // The 3D view's arrows step through the list it was opened with, which here is every
  // kitchen's dishes (the platform re-renders one kitchen at a time, so its list never
  // held the others). Other kitchens' dishes go in marked "not 3D", which the arrows
  // skip; the indices stay the same, so the dish that was tapped is still the one shown.
  function kitchenOfCategory(name) {
    const prefix = String(name || "").split("—")[0].trim();
    return prefix === "Drinks" ? "drinks" : prefix === "Thai" ? "thai"
      : prefix === "Japanese" ? "japanese" : "georgian";
  }
  function keepModalInKitchen() {
    const open = window.openModal;
    if (typeof open !== "function") return;
    window.openModal = function (idx, items, ...rest) {
      const group = root.dataset.fmGroup;
      if (group && Array.isArray(items)) {
        items = items.map((it) => (it && kitchenOfCategory(it.category) !== group)
          ? Object.assign({}, it, { is_3d: false }) : it);
      }
      return open.call(this, idx, items, ...rest);
    };
  }

  // ── The kitchen waiters: in a kitchen's 3D view, "next" / "previous" has that kitchen's
  // waiter walk in and shove the dish off screen, and the next one slides in behind it.
  // Desktop only - on a phone he covers too much of the dish. An experiment (Nika,
  // 2026-10-11). It wraps the arrows rather than changing viewer.js:
  // it holds the click, plays, then replays the click for viewer.js to step the dish.
  const PUSHERS = {
    georgian: "/img/food-market/georgian-pusher.png",
    japanese: "/img/food-market/japanese-pusher.png",
    thai: "/img/food-market/thai-pusher.png",
  };
  let pushing = false, replaying = false;

  function wirePusher() {
    const modal = document.getElementById("modal");
    const viewer = document.getElementById("modal-viewer");
    if (!modal || !viewer) return;
    const guy = document.createElement("img");
    guy.id = "fm-pusher";
    guy.src = PUSHERS.georgian;
    guy.alt = "";
    guy.setAttribute("aria-hidden", "true");
    modal.appendChild(guy);

    const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wide = () => matchMedia("(min-width: 640px)").matches;
    // Fetch all three up front so the first push isn't a blank walk-on.
    Object.values(PUSHERS).forEach((u) => { const i = new Image(); i.src = u; });

    function shove(dir, step) {
      // dir +1 = next: he comes in from the right and pushes the dish left. -1 = mirrored.
      pushing = true;
      const W = innerWidth;
      const box = viewer.getBoundingClientRect();
      guy.src = PUSHERS[root.dataset.fmGroup];
      guy.style.display = "block";
      const gw = guy.getBoundingClientRect().width || 200;
      guy.style.marginLeft = `${-gw / 2}px`;          // centred, whatever his build
      // The dish sits mid-viewer; he stands just off its edge, hand on the plate.
      const dishHalf = Math.min(box.width * 0.34, box.height * 0.42);
      const from = dir * (W / 2 + gw);               // where he starts, off screen
      const at = dir * (dishHalf + gw * 0.32);       // shoulder against the dish
      const away = -dir * W * 1.1;                   // how far the dish goes
      const face = dir > 0 ? 1 : -1;                 // he faces the way he pushes

      const walk = guy.animate([
        { transform: `translateX(${from}px) scaleX(${face}) rotate(0deg)` },
        { transform: `translateX(${(from + at) / 2}px) scaleX(${face}) rotate(${-4 * dir}deg)`, offset: 0.5 },
        { transform: `translateX(${at}px) scaleX(${face}) rotate(${-9 * dir}deg)` },
      ], { duration: 420, easing: "ease-out", fill: "forwards" });

      walk.finished.then(() => {
        const ease = "cubic-bezier(.5,0,.75,0)";
        const push = [
          viewer.animate([{ transform: "translateX(0)" }, { transform: `translateX(${away}px) rotate(${-6 * dir}deg)` }],
            { duration: 520, easing: ease, fill: "forwards" }),
          guy.animate([
            { transform: `translateX(${at}px) scaleX(${face}) rotate(${-9 * dir}deg)` },
            { transform: `translateX(${at + away}px) scaleX(${face}) rotate(${-14 * dir}deg)` },
          ], { duration: 520, easing: ease, fill: "forwards" }),
        ];
        return Promise.all(push.map((a) => a.finished));
      }).then(() => {
        step();                                          // viewer.js swaps the dish
        guy.getAnimations().forEach((a) => a.cancel());
        guy.style.display = "none";
        viewer.getAnimations().forEach((a) => a.cancel());
        return viewer.animate([{ transform: `translateX(${-away * 0.6}px)`, opacity: 0 }, { transform: "translateX(0)", opacity: 1 }],
          { duration: 380, easing: "cubic-bezier(.2,.8,.3,1)" }).finished;
      }).catch(() => {}).finally(() => { pushing = false; });
    }

    for (const [id, dir] of [["modal-next", 1], ["modal-prev", -1]]) {
      const btn = document.getElementById(id);
      if (!btn) continue;
      // Capture on the button itself runs before viewer.js's own listener.
      btn.addEventListener("click", (ev) => {
        if (replaying || !PUSHERS[root.dataset.fmGroup] || still() || !wide()) return;
        ev.stopImmediatePropagation();
        if (pushing) return;
        shove(dir, () => { replaying = true; btn.click(); replaying = false; });
      }, true);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
