// Ask for a 3D model. The only place the menu platform speaks to the engine, and it does
// it by writing a row - not by calling anything.
//
// The platform records what a restaurant asked for. The engine decides how it gets made,
// reads the row with the service key, and writes back what happened. Neither imports the
// other, so replacing the engine (a second one, a self-hosted one, a re-run of every dish
// through something better) never touches this file.
//
// Nothing here decides whether the request may run. That is `model_request_gate()` in
// 0007, a trigger, because 30 credits is real money and a client that could choose its own
// starting state could choose `approved`. This endpoint cannot approve anything, and the
// column grants mean it could not even if it tried.
import { requireApiUser, jsonError } from "../../lib/api.js";

export async function POST({ request, cookies }) {
  const gate = await requireApiUser(cookies);
  if (gate.error) return gate.error;
  const supa = gate.supa;

  let body;
  try { body = await request.json(); } catch { return jsonError("Bad JSON", 400); }
  const { slug } = body;
  if (!slug) return jsonError("Missing restaurant", 400);

  const { data: tenant } = await supa
    .from("tenants").select("id, model_quota").eq("slug", slug).single();
  if (!tenant) return jsonError("No such restaurant", 404);

  // Withdrawing. An owner may cancel their own request and may do nothing else to it -
  // the update policy in 0007 is what enforces that, not this branch.
  if (body._cancel) {
    if (!body.id) return jsonError("Nothing to cancel", 400);
    const { error } = await supa.from("model_requests")
      .update({ state: "cancelled" }).eq("id", body.id);
    if (error) return jsonError(error.message, 400);
    return json({ cancelled: true });
  }

  const photos = Array.isArray(body.photo_keys)
    ? body.photo_keys.filter((k) => typeof k === "string" && k)
    : [];
  if (!photos.length) return jsonError("Add at least one photo of the dish", 400);

  // The engine identifier. The ITEM's uuid, never its name: the engine keys its storage on
  // a slug of this, and every restaurant in Georgia has a dish called Khachapuri. Two
  // tenants would share one prefix and overwrite each other's model, silently, and the
  // first symptom would be a diner seeing another restaurant's food.
  const itemId = body.item_id || null;
  const dish = itemId || crypto.randomUUID();

  let title = String(body.title || "").trim();
  if (itemId && !title) {
    const { data: item } = await supa.from("items").select("name").eq("id", itemId).single();
    title = item?.name || "";
  }

  const { data, error } = await supa.from("model_requests")
    .insert({
      tenant_id: tenant.id, item_id: itemId, dish, variant: "default",
      title, photo_keys: photos,
    })
    .select("id, state, note")
    .single();

  if (error) {
    // The partial unique index in 0007. A double-tap on a slow connection is the normal
    // way to hit this, and telling somebody "duplicate key value violates unique
    // constraint" for tapping twice is not an error message, it is a shrug.
    if (error.code === "23505") {
      return jsonError("This dish already has a model on the way.", 409);
    }
    return jsonError(error.message, 400);
  }

  return json(data);
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status, headers: { "Content-Type": "application/json" },
  });
}
