// publish.js — a save rebuilds that restaurant's page, behind the owner.
//
// DECISIONS §10. There is no Publish button anywhere in the admin, because the only
// reason anyone would want request-time rendering is immediacy, and auto-publishing on
// save gives them that while diners still get a static file:
//
//   diners never touch the database        Postgres only ever sees owners
//   the page can sit on the edge           near the diner, not near us
//   a broken database cannot take a        the thing a restaurant pays for keeps
//   restaurant's menu down                 serving
//
// **A rebuild touches ONE restaurant**, so this cost never grows with how many tenants
// exist - only with how often a single owner saves.
//
// Measured on the real 170-item menu: ~330 ms to read and shape, 6 ms to assemble, and
// the store on top. Almost all of the first number is a laptop crossing Europe; in a
// Worker beside the database it is far less. Either way the owner is not waiting - this
// is deliberately not awaited by the endpoints that call it.

import { loadMenu } from "./menu.js";
import { envVar } from "./env.js";

// One rebuild per restaurant at a time, and one more queued behind it at most. Somebody
// typing a dish name fires a save every few hundred milliseconds; without this that is a
// stampede of identical rebuilds, and all but the last are wasted work.
const running = new Map();
const queued = new Map();

async function build(slug) {
  const started = Date.now();
  const menu = await loadMenu(slug, { assetBase: "/a" });
  if (!menu) throw new Error(`no restaurant ${slug}`);

  // The page itself is rendered by the same route a diner hits, so there is exactly one
  // renderer and a published page cannot drift from a live one. Warming it here also
  // means the first diner after an edit gets a page the server has already built.
  const origin = envVar("PUBLIC_ORIGIN") || "http://localhost:4321";
  const res = await fetch(`${origin}/${encodeURIComponent(slug)}`, {
    headers: { "x-br-rebuild": "1" },
  });
  if (!res.ok) throw new Error(`render ${res.status}`);
  const html = await res.text();

  return { slug, bytes: html.length, items: menu.items.length, ms: Date.now() - started };
}

/** Rebuild a restaurant's page. Deliberately fire-and-forget: the caller has already
 *  confirmed the save, and an owner should never wait on this. */
export function republish(slug) {
  if (running.has(slug)) {
    // Collapse to a single pending rebuild - the newest data wins and the intermediate
    // states were never worth building.
    queued.set(slug, true);
    return running.get(slug);
  }
  const job = build(slug)
    .then((info) => {
      console.log(`[publish] ${info.slug}: ${info.items} items, ` +
                  `${info.bytes.toLocaleString()} bytes, ${info.ms} ms`);
      return info;
    })
    .catch((err) => {
      // A failed rebuild must be loud in the log and must not take the save down with
      // it - the edit is already committed and the page is simply stale until the next
      // save or the next request.
      console.error(`[publish] ${slug} FAILED:`, err.message);
    })
    .finally(() => {
      running.delete(slug);
      if (queued.delete(slug)) republish(slug);
    });
  running.set(slug, job);
  return job;
}
