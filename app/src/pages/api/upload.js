// A dish photo, for the menu card. Straight to R2, never through the database.
//
// The browser has already resized to 860px and re-encoded to WebP before this is called -
// the card draws at 430px, and a 4000px camera shot is thousands of wasted kilobytes on
// every diner's page load. A photo the browser re-encodes can only get smaller, which is
// why images are allowed from an owner and models are not (TEMPLATE-GUIDELINES §2).
//
// This is NOT the path a 3D capture takes. See `capture.js`: the engine wants the detail
// this endpoint deliberately throws away, and feeding it menu-card photos would cap every
// model we ever build at 860px of input.
import { requireApiUser, jsonError } from "../../lib/api.js";
import { republish } from "../../lib/publish.js";
import { put, digest, tenantPrefix } from "../../lib/r2.js";
import { envVar } from "../../lib/env.js";

const MAX = 4 * 1024 * 1024;

export async function POST({ request, cookies }) {
  const gate = await requireApiUser(cookies);
  if (gate.error) return gate.error;
  const supa = gate.supa;

  const form = await request.formData();
  const file = form.get("file");
  const slug = String(form.get("slug") || "");
  const itemId = form.get("item_id");
  if (!file || typeof file === "string") return jsonError("No file", 400);
  if (!slug) return jsonError("Missing restaurant", 400);
  if (file.size > MAX) return jsonError("That image is too large", 413);
  if (!String(file.type).startsWith("image/")) return jsonError("Images only", 415);

  // Membership is checked by asking for the tenant AS the user: RLS answers, so a slug
  // somebody else owns simply comes back empty.
  const { data: tenant } = await supa
    .from("tenants").select("id").eq("slug", slug).single();
  if (!tenant) return jsonError("No such restaurant", 404);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = `${tenantPrefix(tenant.id)}/photos/${await digest(bytes)}.webp`;
  await put(envVar("R2_BUCKET_PHOTOS", "betareal-photos"), key, bytes, "image/webp");

  if (itemId) {
    const { error } = await supa.from("items")
      .update({ photo_key: key }).eq("id", itemId);
    if (error) return jsonError(error.message, 400);
    republish(slug);
  }

  return new Response(JSON.stringify({ key, url: `/a/${key}` }), {
    headers: { "Content-Type": "application/json" },
  });
}
