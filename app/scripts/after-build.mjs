// Runs after `astro build`. Marks the build artefacts that must never be served publicly.
//
// The Cloudflare adapter writes three things into `dist/`:
//
//   _worker.js/     the SERVER bundle - our code, and whatever it closes over
//   _routes.json    which paths the Worker handles
//   viewer.js       an actual public file, from `public/`
//
// Workers-with-assets serves that whole directory over the internet, so without this the
// first two go up as downloadable static files. Wrangler refuses to deploy when it spots
// `_worker.js` there, which is how this was caught rather than shipped - but the refusal
// is a warning about a real exposure, not a formality to silence.
//
// `.assetsignore` is the supported way to say "this is in the directory but is not an
// asset". It is written here rather than committed because `dist/` is deleted and rebuilt
// every time, so a committed copy would survive exactly one build.

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));

await mkdir(dist, { recursive: true });
await writeFile(
  new URL("./.assetsignore", `file://${dist.replace(/\\/g, "/")}`),
  "_worker.js\n_routes.json\n",
  "utf8",
);

console.log("  wrote dist/.assetsignore (keeps the server bundle off the public asset host)");
