/*! BetaReal embed loader v1 - https://betareal.ge
 *
 * Runs on the RESTAURANT'S page, not ours, so it is written to be a good guest:
 * one small file, no dependencies, no cookies, nothing global but `window.__betareal`,
 * nothing that runs before their page has parsed, and nothing that can throw into theirs.
 *
 * Two jobs, both optional - every dish still works if this file never loads:
 *
 *   1. <betareal-dish dish="<id>"></betareal-dish>  becomes the dish's frame, with the
 *      permissions a frame needs for AR already set. For people who prefer a tag to an
 *      iframe; the block the admin hands out is an iframe already.
 *
 *   2. iPhone AR. Apple's Quick Look is launched by a click on <a rel="ar">, and from
 *      inside a cross-origin frame that is not something Apple documents. So on an iPhone
 *      the frame says hello, and this file draws the "View on your table" button on
 *      THEIR page, over the frame, where the tap is a top-level click that simply works.
 *      Without this file, the frame's own button opens the dish on its own page instead.
 */
(function () {
  "use strict";
  if (window.__betareal) return;

  var script = document.currentScript;
  var ORIGIN;
  try { ORIGIN = new URL(script && script.src ? script.src : "", location.href).origin; }
  catch (_) { return; }
  window.__betareal = { v: 1, origin: ORIGIN };

  var ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var ALLOW = "xr-spatial-tracking; fullscreen";
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
              (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  // ── 1. <betareal-dish> ──────────────────────────────────────────────────────────────
  function upgrade(el) {
    if (el.getAttribute("data-br-ready")) return;
    var id = (el.getAttribute("dish") || "").trim();
    if (!ID.test(id)) return;
    el.setAttribute("data-br-ready", "1");

    var q = [];
    ["lang", "theme", "load", "title"].forEach(function (k) {
      var v = el.getAttribute(k);
      if (v) q.push(k + "=" + encodeURIComponent(v));
    });
    var f = document.createElement("iframe");
    f.src = ORIGIN + "/d/" + id + (q.length ? "?" + q.join("&") : "");
    f.title = el.getAttribute("label") || "Dish in 3D";
    f.loading = "lazy";
    f.setAttribute("allow", ALLOW);
    f.setAttribute("allowfullscreen", "");
    var aspect = el.getAttribute("aspect") || "4/3";
    f.style.cssText = "display:block;width:100%;aspect-ratio:" + aspect +
                      ";border:0;border-radius:" + (el.getAttribute("radius") || "12px");
    if (!el.style.display) el.style.display = "block";
    if (!el.style.position) el.style.position = "relative";
    el.appendChild(f);
  }
  function scan() {
    var tags = document.getElementsByTagName("betareal-dish");
    for (var i = 0; i < tags.length; i++) upgrade(tags[i]);
  }

  // ── 2. iPhone AR, drawn on the parent ───────────────────────────────────────────────
  function frameFor(win) {
    var fs = document.getElementsByTagName("iframe");
    for (var i = 0; i < fs.length; i++) if (fs[i].contentWindow === win) return fs[i];
    return null;
  }

  function quickLook(usdz) {
    var a = document.createElement("a");
    a.setAttribute("rel", "ar");
    a.href = usdz;
    // Quick Look only answers a click on <a rel="ar"> whose FIRST child is an <img>.
    a.appendChild(document.createElement("img"));
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 1000);
  }

  function mountButton(frame, msg, source) {
    if (frame.getAttribute("data-br-ar")) return;
    frame.setAttribute("data-br-ar", "1");

    // Where to hang it: the block's own wrapper when there is one, otherwise a
    // zero-height box right after the frame, so the button can sit over the frame's
    // bottom edge without moving the frame (moving an iframe reloads it).
    var host = frame.parentNode;
    var anchor;
    if (host && host.nodeType === 1 &&
        (host.hasAttribute("data-betareal-dish") || host.tagName === "BETAREAL-DISH")) {
      if (!host.style.position) host.style.position = "relative";
      anchor = document.createElement("span");
      anchor.style.cssText = "position:absolute;left:0;right:0;bottom:0;height:0;display:block";
      host.appendChild(anchor);
    } else {
      anchor = document.createElement("span");
      anchor.style.cssText = "position:relative;display:block;height:0;width:100%";
      frame.parentNode.insertBefore(anchor, frame.nextSibling);
    }

    // A shadow root, so nothing in their stylesheet can restyle, hide or break it.
    var box = document.createElement("span");
    box.style.cssText = "position:absolute;left:0;right:0;bottom:14px;display:flex;justify-content:center;pointer-events:none;z-index:2";
    anchor.appendChild(box);
    var root = box.attachShadow ? box.attachShadow({ mode: "closed" }) : box;
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = String(msg.label || "View on your table").slice(0, 60);
    b.setAttribute("style",
      "all:initial;pointer-events:auto;cursor:pointer;font:600 14px/1 system-ui,-apple-system,sans-serif;" +
      "padding:11px 18px;border-radius:999px;background:" + msg.bg + ";color:" + msg.fg + ";" +
      "box-shadow:0 4px 14px rgba(0,0,0,.18);-webkit-tap-highlight-color:transparent");
    b.addEventListener("click", function () {
      quickLook(msg.usdz);
      try { source.postMessage({ betareal: 1, type: "ar-launched" }, ORIGIN); } catch (_) {}
    });
    root.appendChild(b);
  }

  window.addEventListener("message", function (e) {
    // Only our own frames. Anything else that posts here is not talking to us.
    if (e.origin !== ORIGIN) return;
    var m = e.data;
    if (!m || m.betareal !== 1 || m.type !== "hello") return;
    if (!isIOS) return;
    var frame = frameFor(e.source);
    if (!frame) return;
    // The file comes from our frame, but it is still checked: a .usdz, served by us or over
    // https - nothing that could make their page navigate somewhere else. (Our own origin
    // is what makes a local http test work; in production both halves are https.)
    var usdz = String(m.usdz || "");
    try {
      var u = new URL(usdz);
      if (!/\.usdz$/i.test(u.pathname)) return;
      if (u.origin !== ORIGIN && u.protocol !== "https:") return;
    } catch (_) { return; }
    // Colours are only ever a hex value - never a string that could carry more CSS.
    var hex = function (c, d) { return /^#[0-9a-f]{3,8}$/i.test(String(c || "")) ? c : d; };
    mountButton(frame, { usdz: usdz, label: m.label,
                         bg: hex(m.bg, "#1b1a17"), fg: hex(m.fg, "#fff") }, e.source);
    try { e.source.postMessage({ betareal: 1, type: "parent-ar" }, ORIGIN); } catch (_) {}
  });

  // A frame says hello once, when it loads - which may be before this file did (it is
  // async, and their page decides when it runs). So on start, and whenever the page
  // changes, ask every one of our frames that has not been answered to say it again.
  function ping() {
    if (!isIOS) return;
    var fs = document.getElementsByTagName("iframe");
    for (var i = 0; i < fs.length; i++) {
      var f = fs[i];
      if (f.getAttribute("data-br-ar") || String(f.src).indexOf(ORIGIN + "/d/") !== 0) continue;
      try { f.contentWindow.postMessage({ betareal: 1, type: "ping" }, ORIGIN); } catch (_) {}
    }
  }

  // Their page may still be parsing, or may add dishes later (a tab, a modal, a SPA).
  function start() {
    scan();
    ping();
    if (window.MutationObserver) {
      var t = 0;
      new MutationObserver(function () {
        scan();
        clearTimeout(t);
        t = setTimeout(ping, 300);
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
