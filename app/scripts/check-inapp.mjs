// node --test app/scripts/check-inapp.mjs - the Instagram escape (lib/inapp.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { inAppBrowser, isIOSUA, escapeHref, bouncePage, realBrowserUrl } from "../src/lib/inapp.js";

// Real-shaped User-Agents.
const IG_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 380.0.0.22.85 (iPhone15,2; iOS 18_5; en_US; en; scale=3.00; 1179x2556; 742134080)";
const IG_ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.81 Mobile Safari/537.36 Instagram 350.0.0.42.89 Android";
const FB_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.38.107;FBBV/1;FBDV/iPhone15,2]";
const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const PAGE = "https://menu.example/d/0b6c1f7e-1111-4222-8333-944455556666";

test("tells the apps apart, and a real browser is none of them", () => {
  assert.equal(inAppBrowser(IG_IOS), "instagram");
  assert.equal(inAppBrowser(IG_ANDROID), "instagram");
  assert.equal(inAppBrowser(FB_IOS), "facebook");
  assert.equal(inAppBrowser(SAFARI), "");
  assert.equal(inAppBrowser(""), "");
  assert.ok(isIOSUA(IG_IOS) && !isIOSUA(IG_ANDROID));
});

test("the real browser lands on the same dish, AR first, tagged with where it came from", () => {
  const u = new URL(realBrowserUrl(PAGE + "?theme=dark", { app: "instagram", lang: "ka" }));
  assert.equal(u.pathname, new URL(PAGE).pathname);
  assert.equal(u.searchParams.get("ar"), "1");
  assert.equal(u.searchParams.get("from"), "instagram");
  assert.equal(u.searchParams.get("lang"), "ka");
});

test("not in an app: no escape at all - the normal AR button stays", () => {
  assert.equal(escapeHref({ app: "", ios: true, pageUrl: PAGE }), "");
});

test("iPhone: the button goes to OUR bounce page (a plain https link), never straight to instagram://", () => {
  const h = escapeHref({ app: "instagram", ios: true, pageUrl: PAGE, lang: "en" });
  const u = new URL(h);
  assert.equal(u.protocol, "https:");
  assert.equal(u.searchParams.get("out"), "1");
});

test("Android: a Chrome intent with the same dish as fallback", () => {
  const h = escapeHref({ app: "instagram", ios: false, pageUrl: PAGE });
  assert.match(h, /^intent:\/\/menu\.example\/d\/[0-9a-f-]+\?ar=1&from=instagram#Intent;scheme=https;package=com\.android\.chrome;S\.browser_fallback_url=https%3A%2F%2Fmenu\.example%2Fd%2F.*;end$/);
});

test("bounce page, Instagram iPhone: a DECLARATIVE meta refresh to extbrowser, URL-encoded", () => {
  const html = bouncePage({ app: "instagram", ios: true, pageUrl: PAGE, lang: "en" });
  const m = html.match(/<meta http-equiv="refresh" content="0;url=([^"]+)">/);
  assert.ok(m, "meta refresh present");
  const to = m[1].replace(/&amp;/g, "&");
  assert.ok(to.startsWith("instagram://extbrowser/?url=https%3A%2F%2Fmenu.example%2Fd%2F"));
  const back = new URL(decodeURIComponent(to.split("?url=")[1]));
  assert.equal(back.searchParams.get("ar"), "1");
  assert.equal(back.searchParams.get("from"), "instagram");
  // No scripted jump to the scheme: Instagram drops those silently.
  assert.doesNotMatch(html, /location[^<]*instagram:/);
  assert.match(html, /id="m" hidden/);           // the manual steps wait, then show
});

test("bounce page, Facebook iPhone: no jump that would fail, the steps show at once", () => {
  const html = bouncePage({ app: "facebook", ios: true, pageUrl: PAGE, lang: "ka" });
  assert.doesNotMatch(html, /http-equiv="refresh"/);
  assert.match(html, /<p id="m">/);
  assert.match(html, /lang="ka"/);
});
