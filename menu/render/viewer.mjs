// viewer.mjs — the 3D and AR behaviour, as a string that render.mjs inlines.
//
// **This deliberately matches what BetaReal already ships**, because diners in two of our
// restaurants are using that today and it works. Read from `index.html` in the platform
// repo (read-only - DECISIONS §9.7) and reproduced here rather than imported, since that
// repo is a different deploy and this one must not depend on it.
//
// What is kept identical, and why each one is not an implementation detail:
//
//   model-viewer 3.4.0 from ajax.googleapis.com, lazy-loaded as a module, FAIL OPEN.
//     Same version, so a rendering difference between old menus and new ones is never
//     something we have to chase. Fail open matters: if the CDN is unreachable the page
//     keeps its poster images and stays a working menu.
//
//   Posters first, live 3D after.
//     A thumbnail starts as a plain <img> that paints with the menu. Live viewers are
//     upgraded in afterwards, throttled ~150ms apart, and stay invisible until the model
//     has actually loaded. Each live card is its own WebGL context - that is the real
//     reason for the five-item cap (DECISIONS §7), not a design choice.
//
//   camera-orbit as "h v zoom", clamped to +-360 / 0-85 / 30-300%.
//     Same numbers a person already learned in the admin. A bowl framed from its own rim
//     is an empty ellipse, so this is the difference between a dish reading as food and
//     not.
//
//   iOS gets Quick Look through <a rel="ar"> holding an <img>, clicked inside the tap.
//     Not model-viewer's activateAR. Quick Look only fires from a real click on that
//     exact shape, and anything asynchronous before it loses the gesture and silently
//     does nothing.
//
// **What is deliberately NOT reproduced: the Android WebXR carousel.** The platform has a
// custom Three.js session that lets a diner swipe between dishes without leaving AR. It is
// a large module in Niko's repo, it is his, and copying it wholesale is neither ours to do
// nor wise to fork. Android here gets model-viewer's own scene-viewer/WebXR, which is the
// standard path and works. Porting or rebuilding the carousel is a decision to take
// deliberately, with him, not a thing to smuggle in.
//
// **One production workaround we do NOT need.** Their AR launcher bakes an `ar_scale`
// into the model and swaps in a y-offset-corrected blob so Quick Look seats the dish on
// the table instead of through it. That exists because their files are not sized. Ours
// are: `optimize.py` bakes real-world scale into the GLB and the USDZ, and `usdz.py`
// builds the USDZ from the OPTIMISED glb. So the file we hand Quick Look is already the
// right size in the right place, and none of that machinery is carried over.

export const VIEWER_JS = String.raw`
(() => {
  "use strict";
  const MV_SRC = "https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js";
  // One WebGL context per live card. Past a handful, mid-range Android drops the tab -
  // measured, and the reason the platform caps at five.
  const MAX_LIVE = 5;
  const $ = (s, r) => (r || document).querySelector(s);

  let mvPromise = null;
  function ensureMV() {
    if (mvPromise) return mvPromise;
    mvPromise = new Promise((resolve) => {
      if (window.customElements && customElements.get("model-viewer")) return resolve();
      const s = document.createElement("script");
      s.type = "module";
      s.src = MV_SRC;
      s.onload = () => customElements.whenDefined("model-viewer").then(resolve);
      // Fail OPEN. No library means posters stay posters and the menu still works.
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
    return mvPromise;
  }

  /** "h v zoom" -> a model-viewer camera-orbit. Anything malformed means the default
      framing, never a broken page. */
  function orbitOf(el) {
    const raw = (el.dataset.orbit || "").trim();
    if (!raw) return "";
    const p = raw.split(/\s+/).map(Number);
    if (p.length !== 3 || p.some((n) => !isFinite(n))) return "";
    const h = Math.max(-360, Math.min(360, p[0]));
    const v = Math.max(0, Math.min(85, p[1]));
    const z = Math.max(30, Math.min(300, p[2]));
    return h + "deg " + v + "deg " + z + "%";
  }

  const isIOS = () =>
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  /** Show a viewer once its model is really there.
   *
   *  This is three signals instead of one because ONE IS NOT ENOUGH, measured in Chrome
   *  against model-viewer 3.4.0 on 2026-09-05:
   *
   *      attributes                 progress->1   'load' fires   .loaded
   *      camera-controls               yes            NO          false
   *      camera-controls + eager       NO (0.9875)    NO          true
   *
   *  So 'load' never arrived at all, and whichever of the other two you pick, there is a
   *  configuration where it never becomes true. A viewer that is waiting for a signal
   *  that will not come stays at opacity 0 forever, which looks exactly like a model that
   *  failed to download - and the poster underneath makes it look almost right, which is
   *  why it would have taken a long time to notice.
   *
   *  Hence: reveal on whichever arrives first, and poll .loaded as the backstop. The poll
   *  is bounded, so a genuinely broken model stops costing anything after 15 seconds.
   */
  function reveal(mv, wrap) {
    let done = false;
    const show = () => {
      if (done) return;
      done = true;
      clearInterval(timer);
      wrap.classList.add("live");
    };
    mv.addEventListener("load", show, { once: true });
    mv.addEventListener("progress", (e) => {
      if (e.detail && e.detail.totalProgress >= 1) show();
    });
    let tries = 0;
    const timer = setInterval(() => {
      if (mv.loaded) show();
      else if ((tries += 1) > 60) clearInterval(timer);
    }, 250);
  }

  // ── thumbnails ────────────────────────────────────────────────────
  const pending = [];
  let live = 0, draining = false;

  function drain() {
    draining = false;
    if (live >= MAX_LIVE) return;
    const card = pending.shift();
    if (!card) return;
    upgrade(card);
    // Spaced out, so a screenful of dishes does not compile five shaders at once.
    if (pending.length) { draining = true; setTimeout(drain, 150); }
  }

  function upgrade(card) {
    if (card.dataset.upgraded || !card.isConnected) return;
    const src = card.dataset.glb;
    if (!src) return;
    card.dataset.upgraded = "1";
    live++;
    ensureMV().then(() => {
      if (!card.isConnected || !customElements.get("model-viewer")) return;
      const wrap = $(".shotwrap", card);
      if (!wrap) return;
      const mv = document.createElement("model-viewer");
      mv.setAttribute("camera-controls", "");
      mv.setAttribute("shadow-intensity", "0");
      mv.setAttribute("interaction-prompt", "none");
      mv.setAttribute("min-camera-orbit", "auto 0deg auto");
      mv.setAttribute("max-camera-orbit", "auto 85deg auto");
      mv.setAttribute("loading", "eager");
      const o = orbitOf(card);
      if (o) mv.setAttribute("camera-orbit", o);
      // A drag inside the viewer is a rotation; only a real tap opens the modal.
      let px = 0, py = 0;
      mv.addEventListener("pointerdown", (e) => { px = e.clientX; py = e.clientY; });
      mv.addEventListener("pointerup", (e) => {
        if (Math.abs(e.clientX - px) < 6 && Math.abs(e.clientY - py) < 6) openModal(card);
      });
      // Invisible until it has actually loaded, so the poster is never replaced by a
      // grey box mid-scroll. Revealing it is fiddlier than it should be - see reveal().
      reveal(mv, wrap);
      wrap.insertBefore(mv, wrap.firstChild);
      mv.setAttribute("src", src);
    });
  }

  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      pending.push(en.target);
      if (!draining) { draining = true; setTimeout(drain, 0); }
    }
  }, { rootMargin: "200px" });

  // ── the 3D modal ──────────────────────────────────────────────────
  let modal = null, current = null;

  function buildModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "mv-modal";
    modal.hidden = true;
    modal.innerHTML =
      '<div class="mv-sheet" role="dialog" aria-modal="true" aria-label="3D view">' +
        '<button class="mv-x" aria-label="Close">&#10005;</button>' +
        '<div class="mv-stage"></div>' +
        '<div class="mv-foot"><div class="mv-name"></div>' +
        '<button class="mv-ar" hidden></button></div>' +
      "</div>";
    modal.addEventListener("click", (e) => {
      if (e.target === modal || e.target.closest(".mv-x")) close();
    });
    $(".mv-ar", modal).addEventListener("click", () => current && launchAR(current));
    document.body.appendChild(modal);
    return modal;
  }

  function close() {
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = "";
    // Dropped, not hidden: a retained viewer keeps its WebGL context, and a diner who
    // opens four dishes would otherwise be holding four.
    $(".mv-stage", modal).innerHTML = "";
    current = null;
  }

  function openModal(card) {
    current = card;
    const m = buildModal();
    $(".mv-name", m).textContent = card.dataset.name || "";
    const arBtn = $(".mv-ar", m);
    const canAR = !!(card.dataset.usdz || card.dataset.glb);
    arBtn.hidden = !canAR;
    arBtn.textContent = isIOS() ? "View on your table" : "View in your space";
    m.hidden = false;
    document.body.style.overflow = "hidden";
    ensureMV().then(() => {
      if (!m || m.hidden || !customElements.get("model-viewer")) return;
      const stage = $(".mv-stage", m);
      stage.innerHTML = "";
      const mv = document.createElement("model-viewer");
      // Same attributes as the platform's modal viewer, so a dish looks the same in
      // both places.
      mv.setAttribute("camera-controls", "");
      mv.setAttribute("shadow-intensity", "1");
      mv.setAttribute("min-camera-orbit", "auto 0deg auto");
      mv.setAttribute("max-camera-orbit", "auto 85deg auto");
      const o = orbitOf(card);
      if (o) mv.setAttribute("camera-orbit", o);
      if (!isIOS() && card.dataset.glb) {
        // Android AR straight out of the modal viewer. The platform runs its own
        // Three.js carousel here; see this file's header for why that is not copied.
        mv.setAttribute("ar", "");
        mv.setAttribute("ar-modes", "webxr scene-viewer");
      }
      mv.setAttribute("src", card.dataset.glb);
      stage.appendChild(mv);
    });
  }

  // ── AR ────────────────────────────────────────────────────────────
  function launchAR(card) {
    const usdz = card.dataset.usdz;
    if (isIOS() && usdz) {
      // Quick Look fires only from a click on an <a rel="ar"> that CONTAINS an <img>,
      // and only inside the tap that started it. Nothing asynchronous may happen first
      // or the gesture is gone and this silently does nothing.
      const a = document.createElement("a");
      a.setAttribute("rel", "ar");
      a.href = usdz;
      a.appendChild(document.createElement("img"));
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 1000);
      return;
    }
    const mv = modal && $(".mv-stage model-viewer", modal);
    if (mv && typeof mv.activateAR === "function") { mv.activateAR(); return; }
    if (!modal || modal.hidden) openModal(card);
  }

  // ── wiring ────────────────────────────────────────────────────────
  function start() {
    const cards = [].slice.call(document.querySelectorAll(".item.has3d"));
    if (!cards.length) return;
    for (const c of cards) {
      io.observe(c);
      c.addEventListener("click", (e) => {
        if (e.target.closest("model-viewer")) return;  // handled by pointerup
        openModal(c);
      });
    }
    // iOS: hand Quick Look the USDZ from the card tap itself, so the AR button in the
    // modal is a second route rather than the only one.
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }

  if (document.readyState === "complete") start();
  else addEventListener("load", start, { once: true });
})();
`;

// The modal's own styles. Inlined with everything else - a stylesheet fetched later is
// the flash coming back (MENU-PLATFORM §2.1a), even for a panel that opens on tap.
export const VIEWER_CSS = String.raw`
  .shotwrap { position:relative; width:64px; height:64px; border-radius:8px;
              overflow:hidden; background:color-mix(in srgb, var(--muted) 12%, transparent) }
  .shotwrap model-viewer { position:absolute; inset:0; width:100%; height:100%;
              opacity:0; transition:opacity .25s; --poster-color:transparent }
  .shotwrap.live model-viewer { opacity:1 }
  .shotwrap.live .shot { opacity:0 }
  .item.has3d { cursor:pointer }
  .mv-modal { position:fixed; inset:0; z-index:9999; background:rgba(0,0,0,.62);
              display:flex; align-items:flex-end; justify-content:center }
  .mv-modal[hidden] { display:none }
  .mv-sheet { background:var(--paper); width:100%; max-width:40rem; border-radius:14px 14px 0 0;
              display:flex; flex-direction:column; max-height:88vh; position:relative }
  @media (min-width:640px){ .mv-modal{align-items:center} .mv-sheet{border-radius:14px} }
  .mv-stage { flex:1; min-height:min(58vh,26rem);
              background:color-mix(in srgb, var(--muted) 8%, transparent);
              border-radius:14px 14px 0 0 }
  .mv-stage model-viewer { width:100%; height:100%; --poster-color:transparent }
  .mv-foot { display:flex; align-items:center; gap:1rem; padding:.9rem 1rem 1.1rem }
  .mv-name { font-weight:600; flex:1 }
  .mv-ar { border:0; border-radius:999px; padding:.7rem 1.2rem; font:inherit;
           font-weight:600; background:var(--accent); color:var(--paper); cursor:pointer }
  .mv-x { position:absolute; top:.5rem; right:.5rem; z-index:2; border:0; width:2rem;
          height:2rem; border-radius:999px; cursor:pointer; font-size:1rem;
          background:color-mix(in srgb, var(--paper) 80%, transparent); color:var(--ink) }
`;
