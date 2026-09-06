// Serve one object from a private R2 bucket.
//
// The buckets stay private and the app serves their bytes (MENU-PLATFORM §2.6): it
// sidesteps the DNS problem, lets us set our own cache and CORS headers - a signed R2 URL
// sends no Access-Control-Allow-Origin, which silently breaks every 3D viewer and cost
// two days once - and means a bucket's contents cannot be enumerated.
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { envVar } from "../../lib/env.js";

const TYPES = {
  glb: "model/gltf-binary", usdz: "model/vnd.usdz+zip", png: "image/png",
  jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", json: "application/json",
  // Video. Missing until 2026-09-07, so a hero video was served as
  // application/octet-stream and no browser would play it.
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
};

// A <video> is not a fetch. Safari in particular will not play a source that does not
// answer a byte range - it sends `Range: bytes=0-1` first and gives up if the reply is a
// plain 200. Every other browser merely benefits from seeking.
const RANGEABLE = new Set(["mp4", "webm", "mov"]);

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

// Engine OUTPUT lives in the models bucket; everything a restaurant uploaded lives in the
// photos one. The upload route writes `t/<tenant>/…` and must agree with this - it did
// not, once, and every hero video uploaded fine and then 404'd.
const bucketFor = (key) =>
  key.startsWith("catalog/") || key.startsWith("models/")
    ? envVar("R2_BUCKET_MODELS") || "betareal-models"
    : envVar("R2_BUCKET_PHOTOS") || "betareal-photos";

export async function GET({ params, request }) {
  const key = params.key;
  if (!key) return new Response("not found", { status: 404 });

  const ext = key.split(".").pop().toLowerCase();
  const type = TYPES[ext] || "application/octet-stream";
  const bucket = bucketFor(key);

  // Keys are immutable - a re-optimised model gets a new key - so this can be cached hard
  // and never revalidated.
  const headers = {
    "Content-Type": type,
    "Cache-Control": "public, max-age=31536000, immutable",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const range = RANGEABLE.has(ext) ? request.headers.get("range") : null;

    if (range) {
      // Handed straight to R2, which answers the partial itself. Doing the arithmetic here
      // would mean downloading the whole object to return a slice of it - the opposite of
      // what a range request is for.
      const out = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }));
      const body = await out.Body.transformToByteArray();
      return new Response(body, {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": out.ContentRange,
          "Content-Length": String(out.ContentLength),
          "Accept-Ranges": "bytes",
        },
      });
    }

    const out = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await out.Body.transformToByteArray();
    return new Response(body, {
      headers: RANGEABLE.has(ext) ? { ...headers, "Accept-Ranges": "bytes" } : headers,
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
