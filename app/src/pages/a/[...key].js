// Serve one object from a private R2 bucket.
//
// The buckets stay private and the app serves their bytes (MENU-PLATFORM 2.6): it
// sidesteps the DNS problem, lets us set our own cache and CORS headers - a signed R2 URL
// sends no Access-Control-Allow-Origin, which silently breaks every 3D viewer and cost
// two days once - and means a bucket's contents cannot be enumerated.
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { envVar } from "../../lib/env.js";

const TYPES = {
  glb: "model/gltf-binary", usdz: "model/vnd.usdz+zip", png: "image/png",
  jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", json: "application/json",
};

let client;
function s3() {
  if (client) return client;
  client = new S3Client({
    region: "auto",
    endpoint: envVar("R2_ENDPOINT"),
    credentials: {
      accessKeyId: envVar("R2_ACCESS_KEY_ID"),
      secretAccessKey: envVar("R2_SECRET_ACCESS_KEY"),
    },
  });
  return client;
}

const bucketFor = (key) =>
  key.startsWith("catalog/") || key.startsWith("models/")
    ? envVar("R2_BUCKET_MODELS") || "betareal-models"
    : envVar("R2_BUCKET_PHOTOS") || "betareal-photos";

export async function GET({ params }) {
  const key = params.key;
  if (!key) return new Response("not found", { status: 404 });
  try {
    const out = await s3().send(
      new GetObjectCommand({ Bucket: bucketFor(key), Key: key }));
    const body = await out.Body.transformToByteArray();
    return new Response(body, {
      headers: {
        "Content-Type": TYPES[key.split(".").pop().toLowerCase()]
          || "application/octet-stream",
        // Keys are immutable - a re-optimised model gets a new key - so this can be
        // cached hard and never revalidated.
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
