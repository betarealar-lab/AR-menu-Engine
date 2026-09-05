// Categories: add, rename, hide, reorder, delete.
//
// Deleting one deliberately does NOT delete its dishes - the foreign key is
// `on delete set null` (0001_skeleton), so they fall into "No category" on the menu
// screen and can be re-filed. An owner tidying their categories should not be able to
// destroy a morning's typing with one tap.
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

  // Reorder arrives as the whole list, because dragging one row changes several
  // positions and sending them one at a time would leave gaps if a request failed.
  if (Array.isArray(body.order)) {
    const ids = body.order.filter((id) => typeof id === "string");
    for (let i = 0; i < ids.length; i++) {
      const { error } = await supa.from("categories")
        .update({ position: i }).eq("id", ids[i]).eq("tenant_id", tenant.id);
      if (error) return jsonError(error.message, 400);
    }
    republish(slug);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" } });
  }

  if (body._delete) {
    if (!body.id) return jsonError("Nothing to delete", 400);
    const { error } = await supa.from("categories").delete().eq("id", body.id);
    if (error) return jsonError(error.message, 400);
    republish(slug);
    return new Response(JSON.stringify({ deleted: true }), {
      headers: { "Content-Type": "application/json" } });
  }

  const row = { tenant_id: tenant.id };
  if (typeof body.name === "string") row.name = body.name.trim();
  if (typeof body.visible === "boolean") row.visible = body.visible;

  let id = body.id;
  if (id) {
    const { error } = await supa.from("categories").update(row).eq("id", id);
    if (error) return jsonError(error.message, 400);
  } else {
    if (!row.name) return jsonError("A category needs a name", 400);
    const { count } = await supa.from("categories")
      .select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id);
    row.position = count ?? 0;
    const { data, error } = await supa.from("categories")
      .insert(row).select("id").single();
    if (error) return jsonError(error.message, 400);
    id = data.id;
  }

  republish(slug);
  return new Response(JSON.stringify({ id }), {
    headers: { "Content-Type": "application/json" } });
}
