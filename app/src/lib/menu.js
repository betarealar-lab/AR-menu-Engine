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

import postgres from "postgres";
import { envVar } from "./env.js";

let sql;

function db() {
  if (sql) return sql;
  const url = envVar("SUPABASE_DB_URL");
  if (!url) throw new Error("SUPABASE_DB_URL is not set - see .env");
  // One connection, reused. The pooler is the only route that resolves on IPv4 (see
  // HANDOFF's environment table), and it does not want a large pool from one process.
  sql = postgres(url, { max: 4, idle_timeout: 20, prepare: false });
  return sql;
}

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

export async function loadMenu(slug, { assetBase = "/a" } = {}) {
  const s = db();

  const [tenant] = await s`
    select id, slug, name, template_id, theme, settings, languages
    from tenants where slug = ${slug}
  `;
  if (!tenant) return null;

  // Two queries, not three: categories come back joined onto the items. Every round trip
  // is on the owner's save path, and the measured cost of a trip to Frankfurt is ~100 ms.
  const [cats, rows] = await Promise.all([
    s`select id, name, i18n, position from categories
      where tenant_id = ${tenant.id} and visible order by position, name`,
    s`select i.id, i.name, i.description, i.price_minor, i.price_text,
             i.price_old_minor, i.currency, i.category_id, i.position, i.photo_key,
             i.i18n, i.text_only, i.is_3d, i.thumb_3d, i.featured,
             i.variants, i.addons,
             m.draco_key, m.usdz_key, m.external_glb, m.external_usdz,
             m.ar_scale, m.view_orbit, m.tenant_state
      from items i
      left join models m on m.id = i.model_id and m.tenant_id = i.tenant_id
      where i.tenant_id = ${tenant.id} and i.visible
      order by i.position, i.name`,
  ]);

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
    if (r.view_orbit) cfg[`item_view_${r.id}`] = r.view_orbit;
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

  return {
    tenant: {
      id: String(tenant.id), slug: tenant.slug, name: tenant.name,
      languages: tenant.languages || ["en"],
      template: tenant.template_id || "",
    },
    config: cfg,
    categories: cats.map((c) => ({
      id: String(c.id), name: c.name,
      name_ka: ((c.i18n || {}).ka || {}).name || "",
      position: c.position,
    })),
    items,
  };
}

/** day or night. The tenant's own `default_theme` decides; a restaurant that has not
 *  chosen opens dark, which is what the stylesheet is written around. */
export function themeMode(cfg = {}) {
  const named = String(cfg.default_theme || "").toLowerCase();
  return named === "day" || named === "night" ? named : "night";
}
