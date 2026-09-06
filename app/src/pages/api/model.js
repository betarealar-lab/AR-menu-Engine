// The owner's verdict on a 3D model, and its title.
//
// DECISIONS §9.4: this table holds the OWNER's decision and nothing else. Our own fault
// tags - a bad bake, a hole in the mesh, a wrong scale - live in the engine's dataset and
// are never shown to a restaurant. An owner rejecting a model is saying "this does not
// look like my dish", which is a different sentence from "this model is broken", and
// mixing the two would teach us the wrong thing about the engine.
//
// A rejected model is kept, not deleted. It cost 30 credits to make and it is the
// evidence for why the next attempt at that dish is different.
import { requireApiUser, jsonError } from "../../lib/api.js";
import { republish } from "../../lib/publish.js";

export async function POST({ request, cookies }) {
  const gate = await requireApiUser(cookies);
  if (gate.error) return gate.error;
  const supa = gate.supa;

  let body;
  try { body = await request.json(); } catch { return jsonError("Bad JSON", 400); }
  const { slug, id } = body;
  if (!slug || !id) return jsonError("Missing model", 400);

  const { data: tenant } = await supa
    .from("tenants").select("id").eq("slug", slug).single();
  if (!tenant) return jsonError("No such restaurant", 404);

  const patch = {};
  if (["draft", "approved", "rejected"].includes(body.tenant_state)) {
    patch.tenant_state = body.tenant_state;
    patch.decided_utc = new Date().toISOString();
    patch.decided_by = gate.user.id;
  }
  if (typeof body.title === "string") patch.title = body.title.trim();

  // "h v zoom" - three bare numbers, the platform's own convention (0003_model_view), so
  // the value a person already learned still means the same thing. Empty clears it back
  // to model-viewer's default framing.
  if (typeof body.view_orbit === "string") {
    const v = body.view_orbit.trim();
    if (!v) {
      patch.view_orbit = null;
    } else if (/^-?\d+(\.\d+)?( -?\d+(\.\d+)?){2}$/.test(v)) {
      patch.view_orbit = v;
    } else {
      return jsonError("That is not an angle", 400);
    }
  }
  if (!Object.keys(patch).length) return jsonError("Nothing to save", 400);

  const { error } = await supa.from("models")
    .update(patch).eq("id", id).eq("tenant_id", tenant.id);
  if (error) return jsonError(error.message, 400);

  // A model going out of `approved` while a dish still points at it changes that dish's
  // page, so the rebuild is not optional here.
  republish(slug);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" } });
}
