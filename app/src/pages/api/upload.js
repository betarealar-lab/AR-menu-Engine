// Photo upload. Straight to R2, tenant-prefixed, never through a database.
//
// The browser has already resized to 860px and re-encoded to WebP before this is called -
// the card draws at 430px, and a 4000px camera shot is thousands of wasted kilobytes on
// every diner's page load. A photo the browser re-encodes can only get smaller, which is
// why images are allowed from an owner and models are not (TEMPLATE-GUIDELINES §2).
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { requireApiUser, jsonError } from "../../lib/api.js";
import { republish } from "../../lib/publish.js";
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

  // Content-addressed, so re-uploading the same photo does not make a second copy and a
  // rename never rots a URL (MENU-PLATFORM §2.4).
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)].slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = `photos/${slug}/${hash}.webp`;

  const s3 = new S3Client({
    region: "auto",
    endpoint: envVar("R2_ENDPOINT"),
    credentials: {
      accessKeyId: envVar("R2_ACCESS_KEY_ID"),
      secretAccessKey: envVar("R2_SECRET_ACCESS_KEY"),
    },
  });
  await s3.send(new PutObjectCommand({
    Bucket: envVar("R2_BUCKET_PHOTOS", "betareal-photos"),
    Key: key, Body: bytes, ContentType: "image/webp",
  }));

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
