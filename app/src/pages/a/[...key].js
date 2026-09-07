// Serve one object from a private R2 bucket.
//
// The buckets stay private and the app serves their bytes (MENU-PLATFORM §2.6): it
// sidesteps the DNS problem, lets us set our own cache and CORS headers - a signed R2 URL
// sends no Access-Control-Allow-Origin, which silently breaks every 3D viewer and cost
// two days once - and means a bucket's contents cannot be enumerated.
//
// Two ways to reach the bucket, and which one is used depends on where this is running:
//
//   Cloudflare   a BINDING. No credentials at all - the Worker is granted the bucket at
//                deploy time - and no HTTP hop, because R2 is on the same network.
//   Node / dev   the S3 API, with the keys from .env. The binding does not exist here.
//
// The binding is the reason the deployed app carries no R2 credentials to leak.
import { envFrom, bindingFrom } from "../../lib/env.js";

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

// Engine OUTPUT lives in the models bucket; everything a restaurant uploaded lives in the
// photos one. The upload route writes `t/<tenant>/…` and must agree with this - it did
// not, once, and every hero video uploaded fine and then 404'd.
const isModelKey = (key) => key.startsWith("catalog/") || key.startsWith("models/");

let s3Client;
async function s3(env) {
  if (s3Client) return s3Client;
  // Imported only on the path that needs it, so the Worker bundle never carries the SDK.
  const { S3Client } = await import("@aws-sdk/client-s3");
  s3Client = new S3Client({
    region: "auto",
    endpoint: env("R2_ENDPOINT"),
    credentials: {
      accessKeyId: env("R2_ACCESS_KEY_ID"),
      secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    },
  });
  return s3Client;
}

export async function GET({ params, request, locals }) {
  const key = params.key;
  if (!key) return new Response("not found", { status: 404 });

  const env = envFrom(locals);
  const ext = key.split(".").pop().toLowerCase();
  const type = TYPES[ext] || "application/octet-stream";
  const rangeable = RANGEABLE.has(ext);
  const range = rangeable ? request.headers.get("range") : null;

  // Keys are immutable - a re-optimised model gets a new key - so this can be cached hard
  // and never revalidated.
  const headers = {
    "Content-Type": type,
    "Cache-Control": "public, max-age=31536000, immutable",
    "Access-Control-Allow-Origin": "*",
    ...(rangeable ? { "Accept-Ranges": "bytes" } : {}),
  };

  const bucket = bindingFrom(locals, isModelKey(key) ? "MODELS" : "PHOTOS");

  try {
    if (bucket) {
      // ── Cloudflare ──────────────────────────────────────────────────────────
      // R2 parses the Range header itself, so the object is never pulled in whole to
      // return a slice of it.
      const obj = await bucket.get(key, range ? { range: request.headers } : undefined);
      if (!obj) return new Response("not found", { status: 404 });

      const status = range && obj.range ? 206 : 200;
      const extra = {};
      if (status === 206) {
        const start = obj.range.offset ?? 0;
        const length = obj.range.length ?? (obj.size - start);
        extra["Content-Range"] = `bytes ${start}-${start + length - 1}/${obj.size}`;
      }
      extra["Content-Length"] = String(
        status === 206 ? (obj.range.length ?? obj.size) : obj.size);
      // Streamed, not buffered: a 60 MB hero video must not sit in a Worker's memory.
      return new Response(obj.body, { status, headers: { ...headers, ...extra } });
    }

    // ── Node / dev ────────────────────────────────────────────────────────────
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const bucketName = isModelKey(key)
      ? env("R2_BUCKET_MODELS", "betareal-models")
      : env("R2_BUCKET_PHOTOS", "betareal-photos");
    const client = await s3(env);
    const out = await client.send(new GetObjectCommand({
      Bucket: bucketName, Key: key, ...(range ? { Range: range } : {}),
    }));
    const body = await out.Body.transformToByteArray();
    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        ...headers,
        ...(range ? { "Content-Range": out.ContentRange } : {}),
        "Content-Length": String(out.ContentLength ?? body.length),
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
