// Getting a diner out of Instagram's browser and into their real one, for AR.
//
// A link tapped in Instagram (an ad, a Story sticker, a bio, a DM) opens in Instagram's own
// browser. 3D works there. AR does not on iPhone: Instagram uses a WKWebView, where Quick
// Look cannot launch (model-viewer reports canActivateAR = false - model-viewer #2322 and
// discussion #1915, unfixed since 2020). Android's WebView has no WebXR either.
//
// So inside an in-app browser "View on your table" does not try AR. It sends the page to
// the phone's real browser, opened on the same dish with ?ar=1, where one more tap places it.
//
//   iPhone + Instagram   instagram://extbrowser/?url=...  - Meta's own scheme; opens the
//                        DEFAULT browser. It only fires from a declarative
//                        <meta http-equiv="refresh">: a scripted window.location to it is
//                        silently dropped. So the button links to our bounce page (?out=1),
//                        and the bounce page's meta refresh does the jump.
//   Android (any app)    intent://...;package=com.android.chrome - opened by a real link tap.
//                        Chrome, not "whatever is default", because Chrome is where WebXR and
//                        Scene Viewer are certain; S.browser_fallback_url covers a phone
//                        without Chrome.
//   iPhone + Facebook    no scheme known to work (x-safari-https stopped being reliable in
//                        Meta's webviews in 2025). The bounce page tells them the two taps.
//
// None of these schemes is documented or promised by Meta or Google. Check on real phones
// after any Instagram update.

/** "instagram" | "facebook" | "" - from the User-Agent, which both apps stamp. */
export function inAppBrowser(ua = "") {
  if (/Instagram/i.test(ua)) return "instagram";
  if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A/.test(ua)) return "facebook";
  return "";
}

export const isIOSUA = (ua = "") => /iPhone|iPad|iPod/.test(ua);

/** Where the dish should land in the real browser: same page, AR first, tagged. */
export function realBrowserUrl(pageUrl, { app, lang }) {
  const u = new URL(pageUrl);
  u.search = "";
  u.hash = "";
  u.searchParams.set("ar", "1");
  if (lang) u.searchParams.set("lang", lang);
  if (app) u.searchParams.set("from", app);
  return u.href;
}

/** What "View on your table" links to inside an in-app browser. "" = not in one. */
export function escapeHref({ app, ios, pageUrl, lang }) {
  if (!app) return "";
  const target = realBrowserUrl(pageUrl, { app, lang });
  if (ios) {
    const bounce = new URL(pageUrl);
    bounce.search = "";
    bounce.searchParams.set("out", "1");
    if (lang) bounce.searchParams.set("lang", lang);
    return bounce.href;
  }
  const t = new URL(target);
  return `intent://${t.host}${t.pathname}${t.search}#Intent;scheme=https;` +
         `package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(target)};end`;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const BOUNCE_TEXT = {
  en: { going: "Opening your browser…",
        manual: "If nothing happened: tap ••• in the top corner, then “Open in browser”.",
        back: "Back to the dish" },
  ka: { going: "იხსნება ბრაუზერი…",
        manual: "თუ არაფერი მოხდა: დააჭირე ••• ზედა კუთხეში, შემდეგ „Open in browser“.",
        back: "კერძზე დაბრუნება" },
  ru: { going: "Открываем браузер…",
        manual: "Если ничего не произошло: нажмите ••• вверху, затем «Открыть в браузере».",
        back: "Назад к блюду" },
};

/** The ?out=1 page. Instagram on iPhone gets the meta-refresh jump; anything else, the steps. */
export function bouncePage({ app, ios, pageUrl, lang }) {
  const T = BOUNCE_TEXT[lang] || BOUNCE_TEXT.en;
  const target = realBrowserUrl(pageUrl, { app, lang });
  const back = new URL(pageUrl);
  back.search = "";
  if (lang) back.searchParams.set("lang", lang);
  const jump = app === "instagram" && ios
    ? `<meta http-equiv="refresh" content="0;url=${esc("instagram://extbrowser/?url=" + encodeURIComponent(target))}">`
    : "";
  const manualNow = !jump;
  return `<!doctype html><html lang="${esc(lang || "en")}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex">${jump}<title>${esc(T.going)}</title>` +
    `<style>body{margin:0;min-height:100vh;display:grid;place-content:center;gap:14px;padding:24px;` +
    `text-align:center;font:15px/1.45 system-ui,-apple-system,sans-serif;background:#f4f2ee;color:#1b1a17}` +
    `p{margin:0}#m{color:#6f6a62}#m[hidden]{display:none}a{color:inherit;font-weight:600}</style></head><body>` +
    `<p>${esc(T.going)}</p><p id="m"${manualNow ? "" : " hidden"}>${esc(T.manual)}</p>` +
    `<p><a href="${esc(back.href)}">${esc(T.back)}</a></p>` +
    (manualNow ? "" : `<script>setTimeout(function(){document.getElementById("m").hidden=false},1500)</script>`) +
    `</body></html>`;
}
