// Build the Worker bundle without the development secrets in it.
//
// **The problem, precisely.** `@opennextjs/cloudflare` does not read the environment. It
// reads every `.env*` FILE in the project and writes all of them, verbatim, into
// `.open-next/cloudflare/next-env.mjs`, which ships inside the Worker:
//
//     export const production  = { "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_…", … }
//     export const development = { "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_…", … }
//
// It writes THREE blocks - production, development, test - and each one resolves its own
// chain. Blanking the names in `.env.production.local` fixes the first block and leaves the
// second untouched, because `development` resolves `.env.local`, which is where the keys
// live so that `npm run dev` works. So the key still ships.
//
// The only file that is in every chain is `.env.local` itself. It cannot be blanked without
// breaking local development, so it is moved aside for the length of the build and put
// back afterwards - in a `finally`, and on SIGINT and SIGTERM, because a build interrupted
// halfway must not leave a developer's machine mysteriously unable to reach Supabase.
//
// `scripts/no-secrets.mjs` then proves it worked by searching the output for the actual
// values, and `npm run deploy` will not upload if it finds any. Two independent mechanisms,
// because this one has already shipped a service-role key once.
//
//   node scripts/build-cf.mjs

import { renameSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const LIVE = ".env.local";
// A name nothing reads: Next and OpenNext both match `.env`-prefixed files, so the marker
// goes at the FRONT.
const PARKED = "env.local.parked-during-cf-build";

let parked = false;

function restore() {
  if (parked && existsSync(PARKED)) {
    renameSync(PARKED, LIVE);
    parked = false;
    console.log(`restored ${LIVE}`);
  }
}

// Ctrl-C during a three-minute build is normal. Losing your dev config to it is not.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => { restore(); process.exit(130); });
}
process.on("uncaughtException", (e) => { restore(); throw e; });

try {
  if (existsSync(PARKED)) {
    // A previous run died somewhere a signal handler could not reach. Recover rather than
    // overwrite: the parked copy is the real one.
    if (existsSync(LIVE)) {
      console.error(`Both ${LIVE} and ${PARKED} exist. A previous build left a mess - `
        + `check which one is current, keep it as ${LIVE}, delete the other.`);
      process.exit(1);
    }
    renameSync(PARKED, LIVE);
    console.log(`recovered ${LIVE} from an interrupted build`);
  }

  if (existsSync(LIVE)) {
    renameSync(LIVE, PARKED);
    parked = true;
    console.log(`parked ${LIVE} so its secrets cannot be compiled into the Worker`);
  }

  const r = spawnSync("npx", ["opennextjs-cloudflare", "build"],
    { stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
} finally {
  restore();
}
