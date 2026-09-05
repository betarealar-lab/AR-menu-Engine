// Save a restaurant: its name, its look, its details. One endpoint for three screens,
// because all three write the same row and splitting them would only mean three copies of
// the same whitelist.
//
// As with every write here, through the SIGNED-IN USER's client. RLS decides whether this
// person may touch this restaurant; the handler never asks.
import { requireApiUser, jsonError } from "../../lib/api.js";
import { republish } from "../../lib/publish.js";
import { PALETTE_KEYS, SETTINGS_KEYS } from "../../lib/fields.js";

// A palette key may be bare or day_/night_ prefixed - the live restaurants carry 34 of
// each. Anything that is not a known key after stripping the prefix is dropped.
function paletteKey(k) {
  const bare = k.replace(/^(day|night)_/, "");
  return PALETTE_KEYS.has(bare) ? k : null;
}

export async function POST({ request, cookies }) {
  const gate = await requireApiUser(cookies);
  if (gate.error) return gate.error;
  const supa = gate.supa;

  let body;
  try { body = await request.json(); } catch { return jsonError("Bad JSON", 400); }
  const { slug } = body;
  if (!slug) return jsonError("Missing restaurant", 400);

  const { data: tenant } = await supa
    .from("tenants").select("id, theme, settings").eq("slug", slug).single();
  if (!tenant) return jsonError("No such restaurant", 404);

  const patch = {};

  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.template_id === "string" && body.template_id) {
    patch.template_id = body.template_id;
  }

  if (Array.isArray(body.languages)) {
    // English is not special to us, but the renderer falls back to the base columns, and
    // a restaurant with no languages at all renders nothing at all.
    const langs = body.languages.filter((l) => /^[a-z]{2}$/.test(l));
    if (langs.length) patch.languages = [...new Set(["en", ...langs])];
  }

  // Merged, never replaced. Each screen sends only the fields it draws, and a settings
  // page that clobbered the palette would be a theme editor with extra steps.
  if (body.theme && typeof body.theme === "object") {
    const next = { ...(tenant.theme || {}) };
    for (const [k, v] of Object.entries(body.theme)) {
      const key = paletteKey(k);
      if (!key) continue;
      if (v === null || v === "") delete next[key];       // back to the template's own
      else if (typeof v === "string") next[key] = v.slice(0, 400);
    }
    patch.theme = next;
  }

  if (body.settings && typeof body.settings === "object") {
    const next = { ...(tenant.settings || {}) };
    for (const [k, v] of Object.entries(body.settings)) {
      if (!SETTINGS_KEYS.has(k)) continue;
      if (v === null || v === "") delete next[k];
      else if (typeof v === "string") next[k] = v.slice(0, 2000);
      else if (typeof v === "boolean") next[k] = String(v);
      else if (Array.isArray(v)) next[k] = v.slice(0, 40);
    }
    patch.settings = next;
  }

  if (!Object.keys(patch).length) return jsonError("Nothing to save", 400);

  const { error } = await supa.from("tenants").update(patch).eq("id", tenant.id);
  if (error) return jsonError(error.message, 400);

  republish(slug);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" } });
}
