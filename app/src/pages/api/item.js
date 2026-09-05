// Save one dish. Every keystroke in the editor lands here, debounced.
//
// Writes go through the SIGNED-IN USER's client, never the service key: RLS is then the
// thing that decides whether this person may touch this restaurant, which is the property
// check_schema.py proves. Reaching for the service key in a request handler is how one
// tenant ends up able to edit another's menu.
import { requireApiUser, jsonError } from "../../lib/api.js";
import { republish } from "../../lib/publish.js";

export async function POST({ request, cookies }) {
  const gate = await requireApiUser(cookies);
  if (gate.error) return gate.error;
  const supa = gate.supa;

  let body;
  try { body = await request.json(); } catch { return jsonError("Bad JSON", 400); }
  const { slug } = body;
  if (!slug) return jsonError("Missing restaurant", 400);

  const { data: tenant } = await supa
    .from("tenants").select("id").eq("slug", slug).single();
  if (!tenant) return jsonError("No such restaurant", 404);

  if (body._delete) {
    if (!body.id) return jsonError("Nothing to delete", 400);
    const { error } = await supa.from("items").delete().eq("id", body.id);
    if (error) return jsonError(error.message, 400);
    await republish(slug);
    return new Response(JSON.stringify({ deleted: true }), {
      headers: { "Content-Type": "application/json" } });
  }

  const row = {
    tenant_id: tenant.id,
    name: body.name,
    description: body.description || "",
    price_minor: Number(body.price_minor) || 0,
    price_old_minor: body.price_old_minor ?? null,
    price_text: body.price_text || null,
    category_id: body.category_id || null,
    model_id: body.model_id || null,
    visible: !!body.visible,
    text_only: !!body.text_only,
    is_3d: !!body.is_3d,
    thumb_3d: !!body.thumb_3d,
    featured: !!body.featured,
    i18n: body.i18n || {},
  };

  let id = body.id;
  if (id) {
    const { error } = await supa.from("items").update(row).eq("id", id);
    if (error) return jsonError(error.message, 400);
  } else {
    const { data, error } = await supa.from("items").insert(row).select("id").single();
    if (error) return jsonError(error.message, 400);
    id = data.id;
  }

  // No Publish button anywhere in this panel: the save IS the publish (DECISIONS §10).
  // It runs after the write is confirmed, so the owner never waits for it.
  republish(slug);

  return new Response(JSON.stringify({ id }), {
    headers: { "Content-Type": "application/json" } });
}
