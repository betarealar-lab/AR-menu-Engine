// A capture frame: one of the four photos an engine turns into a 3D model.
//
// Deliberately a different endpoint from `upload.js`, because almost nothing about it is
// the same. A menu photo is 860px WebP, because a card draws it at 430 and every byte is
// paid for by a diner on a phone. **A capture frame is engine input, and the detail this
// keeps is the ceiling on every model we will ever build from it.** Sending menu-sized
// photos to a generator would cap the whole product at 860px of evidence, permanently and
// invisibly - the models would just be slightly worse than they should be, forever.
//
// So: 2048px, JPEG, quality high. And the frames are kept after the model is built. The
// photos outlive the model (0007_model_requests) - a better engine next year is worth
// nothing without the inputs, because the model is derived and the photos are the asset.
import { requireApiUser, jsonError } from "../../lib/api.js";
import { put, digest, tenantPrefix } from "../../lib/r2.js";
import { envVar } from "../../lib/env.js";

// Higher than a menu photo, for the reason above, and still bounded - a phone will
// happily hand over a 12 MB HEIC and an unbounded upload endpoint is an unbounded bill.
const MAX = 12 * 1024 * 1024;

// dataset.SLOTS, in the engine's order. Named here because the request stores them in
// capture order and the engine reads them back positionally - front is the primary view
// meshy-7 reconstructs from first, and shuffling the array silently changes the model.
const SLOTS = ["front", "right", "back", "left"];

export async function POST({ request, cookies }) {
  const gate = await requireApiUser(cookies);
  if (gate.error) return gate.error;
  const supa = gate.supa;

  const form = await request.formData();
  const file = form.get("file");
  const slug = String(form.get("slug") || "");
  const slot = Number(form.get("slot"));
  if (!file || typeof file === "string") return jsonError("No file", 400);
  if (!slug) return jsonError("Missing restaurant", 400);
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS.length) {
    return jsonError("Which angle is this?", 400);
  }
  if (file.size > MAX) return jsonError("That photo is too large", 413);
  if (!String(file.type).startsWith("image/")) return jsonError("Images only", 415);

  const { data: tenant } = await supa
    .from("tenants").select("id").eq("slug", slug).single();
  if (!tenant) return jsonError("No such restaurant", 404);

  const bytes = new Uint8Array(await file.arrayBuffer());
  // The slot is in the key as well as the position, so a frame is identifiable on its own
  // in a bucket listing - which is what you want at 3am when a model came out wrong and
  // the question is which photo it was built from.
  const key = `${tenantPrefix(tenant.id)}/capture/${await digest(bytes)}-${SLOTS[slot]}.jpg`;
  await put(envVar("R2_BUCKET_PHOTOS", "betareal-photos"), key, bytes, "image/jpeg");

  return new Response(JSON.stringify({ key, slot, url: `/a/${key}` }), {
    headers: { "Content-Type": "application/json" },
  });
}
