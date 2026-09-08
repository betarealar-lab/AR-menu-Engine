// Refuse to deploy a bundle with a secret baked into it.
//
// **This is not hypothetical and it is not Next's fault.** `@opennextjs/cloudflare` does
// not read the environment; it reads every `.env*` FILE in the project and writes all of
// them, verbatim, into `.open-next/cloudflare/next-env.mjs`, which ships inside the Worker:
//
//     export const production = {"SUPABASE_SERVICE_ROLE_KEY":"sb_secret_…", …}
//
// The first Cloudflare build of this app did exactly that with the real service-role key -
// the credential that bypasses row-level security entirely - because it was in `.env.local`
// for `npm run dev`. `.env.production.local` blanks those four names now, and this checks
// that it worked, on every deploy, rather than trusting that it still does.
//
// It compares against whatever `.env.local` actually holds, so it keeps working when a key
// is rotated and needs no list of secrets kept up to date by hand.
//
//   node scripts/no-secrets.mjs        (run by `npm run deploy`, before the upload)

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

const OUT = ".open-next";
const ENV = ".env.local";

// Everything that is a credential. NEXT_PUBLIC_ values are excluded by definition - they
// are compiled into the browser bundle on purpose - and so are bucket names and endpoints
// that are already in committed config.
const isSecret = (k) =>
  !k.startsWith("NEXT_PUBLIC_") &&
  /KEY|SECRET|TOKEN|PASSWORD|DSN/i.test(k);

if (!existsSync(ENV)) {
  console.log(`no ${ENV} - nothing to compare against, skipping`);
  process.exit(0);
}

const secrets = Object.fromEntries(
  readFileSync(ENV, "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
    // A short value is not a credential, it is a flag, and matching on it would find it
    // everywhere.
    .filter(([k, v]) => isSecret(k) && v.length >= 12));

const names = Object.keys(secrets);
if (!names.length) {
  console.log("no credentials found in .env.local to check for");
  process.exit(0);
}

function* files(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.isFile()) yield p;
  }
}

const found = new Map();
let scanned = 0;
for (const f of files(OUT)) {
  // Text-ish only. Fonts and images cannot contain a key that a build inlined.
  if (![".js", ".mjs", ".cjs", ".json", ".txt", ".map", ".html"].includes(extname(f))) continue;
  const body = readFileSync(f, "utf8");
  scanned += body.length;
  for (const [name, value] of Object.entries(secrets)) {
    if (body.includes(value)) {
      if (!found.has(name)) found.set(name, []);
      found.get(name).push(f);
    }
  }
}

console.log(`checked ${names.length} credentials against ${(scanned / 1e6).toFixed(1)} MB of ${OUT}/`);

if (found.size) {
  console.error("\nRefusing to deploy: the build output contains real credentials.\n");
  for (const [name, where] of found) {
    // The NAME, never the value. Printing the value to a terminal is how it ends up in a
    // log, a screenshot or a transcript - which is exactly how this one got out.
    console.error(`  ${name}  in  ${where.slice(0, 3).join(", ")}`);
  }
  console.error("\nBlank them in .env.production.local and set them with `wrangler secret put`.");
  process.exit(1);
}

console.log("clean: no credential from .env.local is in the build output");
