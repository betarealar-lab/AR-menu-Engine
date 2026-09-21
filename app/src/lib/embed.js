// embed.js — one dish, for a page that is not ours.
//
// `/d/<item id>` is two things at once, and both are the same page:
//
//   a LINK      opened on its own - an Instagram bio, a WhatsApp message, a QR on a
//               delivery bag. Always works: it is our page, on our domain.
//   an EMBED    inside an <iframe> on a restaurant's own website. Governed by that
//               restaurant's `tenant_embed` row (0028): switched off, or on a site that is
//               not on their list, it shows the dish's photo and nothing else.
//
// The decision is kept here, away from the markup, so it can be tested without a browser
// (`check_embed.mjs`) - it is the part that decides whether a paying restaurant's dish
// shows up, and it is the part nobody would notice breaking until a client did.
//
// **What the allowed-sites list is and is not.** It is abuse control and attribution: it
// stops a dish we made for one restaurant being shown on some other site. It is not
// security - nothing on a public page is - and there is no DRM for a GLB. The browser
// enforces it through `frame-ancestors`, which a page cannot opt out of, so it holds
// against anybody pasting the iframe onto their own site.

import { envFrom } from "./env.js";
import { priceOf, assetUrl } from "./menu.js";

/** Item ids are uuids (0001). Anything else is not worth a database round trip. */
export const DISH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "https://www.Restaurant-X.ge/menu" -> "restaurant-x.ge". A leading www. is dropped
 *  because every entry already covers its subdomains; keeping it would make
 *  "www.x.ge" on the list refuse "x.ge" itself, which nobody means. */
export function normalizeSite(value) {
  let s = String(value || "").trim().toLowerCase();
  if (!s) return "";
  if (!/^[a-z]+:\/\//.test(s)) s = `https://${s}`;
  let host;
  try { host = new URL(s).hostname; } catch { return ""; }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  // A hostname, not a pattern: no wildcards, no spaces, at least one dot or localhost.
  if (!/^[a-z0-9.-]+$/.test(host) || (!host.includes(".") && host !== "localhost")) return "";
  return host;
}

/** Is `host` one of `sites`, or a subdomain of one? */
export function hostAllowed(host, sites) {
  const h = normalizeSite(host);
  if (!h) return false;
  return sites.some((s) => h === s || h.endsWith(`.${s}`));
}

/** Parse the configured list of OUR OWN origins - the admin, for its preview - which may
 *  always frame a dish, whatever the restaurant's list says. Reuses PREVIEW_ORIGINS, the
 *  variable the menu page already trusts for exactly this job. */
export function ownOrigins(raw) {
  return String(raw || "").split(",").map((s) => s.trim()).filter(Boolean)
    .filter((s) => { try { return !!new URL(s).host; } catch { return false; } });
}

/**
 * What to serve.
 *
 *   dish        public_dish()'s answer, normalised by loadDish
 *   dest        the request's Sec-Fetch-Dest: "iframe" when framed, "document" when opened
 *   refererHost where the frame sits, from Referer (strict-origin by default, so a host)
 *   own         our own origins (admin preview)
 *
 * Returns { mode: "full" | "photo", restrict: string[] | null } - `restrict` is the list
 * that becomes frame-ancestors, or null for "may be framed anywhere".
 */
export function decide({ dish, dest = "", refererHost = "", own = [] }) {
  if (!dish.has3d || !dish.embed.active) return { mode: "photo", restrict: null };

  const sites = dish.embed.sites;
  if (!sites.length) return { mode: "full", restrict: null };

  // Framed, and the frame says where it is: a site not on the list gets the photo - a
  // quiet degrade instead of the blank box a frame-ancestors refusal would draw.
  const framed = dest === "iframe" || dest === "frame" || dest === "embed" || dest === "object";
  if (framed && refererHost) {
    const ownHosts = own.map((o) => { try { return new URL(o).hostname; } catch { return ""; } });
    const ok = hostAllowed(refererHost, sites) || ownHosts.includes(String(refererHost).toLowerCase());
    if (!ok) return { mode: "photo", restrict: null };
  }

  // Everything else - allowed site, top-level link, an old browser that sends no
  // Sec-Fetch-Dest, a site that strips its Referer - gets the dish, with frame-ancestors as
  // the backstop. A top-level visit is unaffected by it; a frame on a site that is not on
  // the list is refused by the browser itself, which no header trick on their side avoids.
  return { mode: "full", restrict: sites };
}

/** The Content-Security-Policy value for a restricted dish. Each site in both schemes and
 *  with its subdomains: a 3D view works on a plain-http site even though AR will not. */
export function frameAncestors(sites, own = []) {
  const parts = ["'self'"];
  for (const s of sites) parts.push(`https://${s}`, `https://*.${s}`, `http://${s}`, `http://*.${s}`);
  for (const o of own) parts.push(o);
  return `frame-ancestors ${parts.join(" ")}`;
}

/** "h v zoom" (models.view_orbit) -> model-viewer's camera-orbit, clamped the way the
 *  menu's viewer clamps it. Empty for anything that is not three numbers. */
export function cameraOrbit(raw) {
  const p = String(raw || "").trim().split(/\s+/).map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return "";
  const h = Math.max(-360, Math.min(360, p[0]));
  const v = Math.max(0, Math.min(85, p[1]));
  const zoom = Math.max(30, Math.min(300, p[2]));
  return `${h}deg ${v}deg ${zoom}%`;
}

/** public_dish()'s document -> the shape the page renders. Pure, so it is testable. */
export function shapeDish(doc, lang, assetBase = "/a") {
  if (!doc || !doc.item || !doc.tenant) return null;
  const { item, tenant } = doc;
  const model = doc.model || null;
  const t = (item.i18n || {})[lang] || {};
  const glb = model ? assetUrl(model.draco_key || model.external_glb, assetBase) : null;
  const usdz = model ? assetUrl(model.usdz_key || model.external_usdz, assetBase) : null;
  const sites = (doc.embed?.allowed_sites || []).map(normalizeSite).filter(Boolean);
  return {
    id: String(item.id),
    name: t.name || item.name || "",
    description: t.description || item.description || "",
    price: priceOf(item),
    photo: assetUrl(item.photo_key, assetBase),
    poster: model ? assetUrl(model.poster_key, assetBase) : null,
    glb, usdz,
    arScale: Number(model?.ar_scale ?? 1) || 1,
    orbit: cameraOrbit(model?.view_orbit),
    // The same rule as the menu (menu.js): the dish's own 3D switch, not a text-only dish,
    // and a model the owner approved - public_dish already left an unapproved one out.
    has3d: !!item.is_3d && !item.text_only && !!glb,
    tenant: { id: String(tenant.id), slug: tenant.slug, name: tenant.name,
              languages: tenant.languages || ["en"] },
    embed: { active: doc.embed?.active !== false, sites },
  };
}

/** One round trip, with the weakest key that works - exactly how the menu loads. */
export async function loadDish(id, { locals, lang = "", assetBase = "/a" } = {}) {
  if (!DISH_ID.test(String(id || ""))) return null;
  const env = envFrom(locals);
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_ANON_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are not set");

  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/public_dish`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_item: id }),
  });
  if (!res.ok) throw new Error(`dish ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const doc = await res.json();
  if (!doc || !doc.tenant) return null;
  const langs = doc.tenant.languages || ["en"];
  const pick = langs.includes(lang) ? lang : langs[0] || "en";
  const dish = shapeDish(doc, pick, assetBase);
  if (dish) dish.lang = pick;
  return dish;
}
