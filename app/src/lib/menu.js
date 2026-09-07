// menu.js — read one restaurant out of Postgres, in the shape a page needs.
//
// The JavaScript twin of `menu/app/bootstrap.py`. Same queries, same field names, same
// rules - so the Astro route and the Python fallback cannot drift into rendering
// different menus from the same database.
//
// **Why the shape is the platform's** (`name_en`, `price` as text, `thumb_3d`, `is_3d`):
// their viewer JS is ported verbatim and reads exactly those fields. Translating here, at
// the boundary, is what lets that code stay unedited - and unedited is the whole reason it
// works on real phones.
//
// This runs on the SERVER, once per publish. A diner never executes any of it.
//
// ── it asks the database for one thing, with the weakest key that works ───────────────
//
// This used to hold `SUPABASE_DB_URL` - a direct Postgres connection that bypasses
// row-level security entirely - on the app that serves PUBLIC pages. It worked, and it was
// the strongest credential in the building sitting in the most exposed place.
//
// Now it calls `public_menu(slug)` (0015) with the anon key. That function returns exactly
// what a diner's page renders and nothing else: no hidden dish, no unapproved model, no
// other restaurant, nothing about who owns or edits it. There is no table this key can
// read and nothing to enumerate - it takes a slug, which is already in the URL.
//
// It is also one round trip instead of three, and it is plain `fetch`, so this file runs
// unchanged on Node and on Cloudflare Workers. Raw TCP to Postgres runs on neither without
// help.

import { envFrom } from "./env.js";

const SYMBOL = { GEL: "₾", USD: "$", EUR: "€", GBP: "£" };

/** Integer minor units back to the free text a menu shows.
 *
 *  Integers are the truth in our schema because 12.30 as a float is 12.299999999999999,
 *  and a menu that disagrees with the till by a tetri is a menu nobody trusts.
 *  `price_text` wins when a price is something no single number can say - "16 / 70" for a
 *  drink priced by the glass and the bottle. */
export function priceOf(item) {
  if (item.price_text) return item.price_text;
  if (!item.price_minor) return "";
  const n = (item.price_minor / 100).toFixed(2).replace(/\.00$/, "");
  const sym = SYMBOL[item.currency || "GEL"] || "";
  return sym ? `${n} ${sym}` : n;
}

/** Our R2 keys become URLs; an imported absolute URL passes through untouched. One field
 *  carrying both is deliberate - a template must never need to know where a dish's files
 *  came from. */
export function assetUrl(v, base = "/a") {
  if (!v) return null;
  return /^(https?:)?\/\/|^data:|^\//.test(v) ? v : `${base}/${v}`;
}

export async function loadMenu(slug, { assetBase = "/a", locals } = {}) {
  // Handed the request's configuration rather than reaching for a global: on Cloudflare
  // there is no global to reach for - secrets arrive with the request (see env.js).
  const env = envFrom(locals);
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_ANON_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are not set");

  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/public_menu`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`,
               "Content-Type": "application/json" },
    body: JSON.stringify({ p_slug: slug }),
  });
  if (!res.ok) throw new Error(`menu ${res.status}: ${(await res.text()).slice(0, 120)}`);

  const doc = await res.json();
  if (!doc || !doc.tenant) return null;         // no such restaurant

  const tenant = doc.tenant;
  const cats = doc.categories || [];
  const rows = doc.items || [];
  const catById = new Map(cats.map((c) => [String(c.id), c]));

  // theme_config is one flat bag to the viewer. We keep palette and site settings in
  // separate columns - a theme editor should be a theme editor, not a settings page with
  // colours in it - so they are recombined here, at the boundary.
  const cfg = { ...(tenant.settings || {}), ...(tenant.theme || {}) };
  if (tenant.template_id) cfg.template_key = tenant.template_id;

  const items = rows.map((r) => {
    const ka = (r.i18n || {}).ka || {};
    const ru = (r.i18n || {}).ru || {};
    const cat = r.category_id ? catById.get(String(r.category_id)) : null;
    const catKa = ((cat && cat.i18n) || {}).ka || {};
    // A model reaches a diner only if the owner approved it. `is_3d` off keeps the model
    // attached while the dish behaves like a photo dish - a real case one flag could not
    // express.
    const ok = r.tenant_state === "approved";
    const glb = ok ? assetUrl(r.draco_key || r.external_glb, assetBase) : null;
    const usdz = ok ? assetUrl(r.usdz_key || r.external_usdz, assetBase) : null;
    return {
      id: String(r.id),
      name_en: r.name, name_ka: ka.name || "", name_ru: ru.name || "",
      description_en: r.description || "",
      description_ka: ka.description || "", description_ru: ru.description || "",
      price: priceOf(r),
      price_old: r.price_old_minor
        ? priceOf({ price_minor: r.price_old_minor, currency: r.currency }) : null,
      category_id: r.category_id ? String(r.category_id) : null,
      category_name: cat ? cat.name : "",
      category_name_ka: catKa.name || "",
      model: glb, model_usdz: usdz,
      // How to frame this dish in the 3D viewer: "h v zoom". It rides on the ITEM, not in
      // theme_config: the config that reaches a diner is a whitelist of settings, so a
      // per-dish key put in there is silently dropped and every model opens at the default
      // angle - which is what was happening.
      view_orbit: r.view_orbit || "",
      thumbnail_url: assetUrl(r.photo_key, assetBase),
      thumb_3d: !!r.thumb_3d,
      is_3d: !!r.is_3d && !!(glb || usdz),
      text_only: !!r.text_only,
      featured: !!r.featured,
      ar_scale: Number(r.ar_scale ?? 1),
      variants: r.variants || [], addons: r.addons || [],
      sort_order: r.position,
    };
  });

  const categories = cats.map((c) => ({
    id: String(c.id), name: c.name,
    name_ka: ((c.i18n || {}).ka || {}).name || "",
    name_ru: ((c.i18n || {}).ru || {}).name || "",
    position: c.position,
  })).sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9)
    || a.name.localeCompare(b.name));

  // ── the order a diner reads them in ───────────────────────────────────────────────
  //
  // **This was wrong on the live menu and it was wrong in a way that looked like a
  // different bug.** Temo, on the deployed page:
  //
  //   > "categories don't work ... every item is sorted alphabetically"
  //
  // The query said `order by i.position, i.name`, which sounds right and is not, because
  // `position` is the dish's rank WITHIN ITS CATEGORY - imported straight from the
  // platform's `sort_order`. Monday Greens has 170 dishes across 26 categories and only 26
  // distinct positions: 1..10 in Breakfast, 1..10 in Salads, 1..20 in Coffee. Sorting the
  // whole menu by that number interleaves all 26 categories - every "position 1" dish
  // first, and ties broken by name. Which is to say: alphabetical, exactly as reported.
  //
  // The platform orders by `category_id, sort_order` and then draws a section per
  // category. So does this. `name` remains the last tiebreak so that two dishes a
  // restaurant never explicitly ordered still come out the same way on every publish -
  // a menu whose order changes between two loads looks broken even when nothing is wrong.
  const catRank = new Map(categories.map((c, i) => [c.id, i]));
  items.sort((a, b) =>
    (catRank.has(a.category_id) ? catRank.get(a.category_id) : 1e9) -
    (catRank.has(b.category_id) ? catRank.get(b.category_id) : 1e9) ||
    (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) ||
    a.name_en.localeCompare(b.name_en));

  return {
    tenant: {
      id: String(tenant.id), slug: tenant.slug, name: tenant.name,
      languages: tenant.languages || ["en"],
      template: tenant.template_id || "",
    },
    config: cfg,
    categories,
    items,
  };
}

/** day or night. The tenant's own `default_theme` decides; a restaurant that has not
 *  chosen opens dark, which is what the stylesheet is written around. */
export function themeMode(cfg = {}) {
  const named = String(cfg.default_theme || "").toLowerCase();
  return named === "day" || named === "night" ? named : "night";
}
