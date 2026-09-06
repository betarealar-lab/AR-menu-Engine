// r2.js — one place that knows how to put an object in a bucket.
//
// Two upload paths exist and they are deliberately not one function with a flag: a menu
// photo and a capture frame differ in size, format, bucket, destination and lifetime.
// What they share is this.

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { envVar } from "./env.js";

let client = null;

export function r2() {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: envVar("R2_ENDPOINT"),
      credentials: {
        accessKeyId: envVar("R2_ACCESS_KEY_ID"),
        secretAccessKey: envVar("R2_SECRET_ACCESS_KEY"),
      },
    });
  }
  return client;
}

export async function put(bucket, key, bytes, contentType) {
  await r2().send(new PutObjectCommand({
    Bucket: bucket, Key: key, Body: bytes, ContentType: contentType,
  }));
  return key;
}

/** First 8 bytes of the SHA-256, hex. Content-addressing, so re-uploading the same file
 *  makes no second copy and nothing has to be cleaned up later. */
export async function digest(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The prefix everything a restaurant owns lives under.
 *
 *  Keyed on the tenant's UUID and NOT its slug. MENU-PLATFORM §2.4 says the slug is an
 *  address and never part of a storage key, precisely so renaming one is a row update and
 *  nothing moves - and a prefix that carries the slug quietly breaks that: rename once and
 *  a restaurant's files are spread across two prefixes, so "delete everything this
 *  restaurant owns" stops having a single answer.
 *
 *  Keys already written under the old shape keep resolving; they are stored per row, not
 *  recomputed. Nothing needs migrating, and nothing new is written that way. */
export function tenantPrefix(tenantId) {
  return `t/${tenantId}`;
}
