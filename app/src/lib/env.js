// env.js — where server-side secrets come from.
//
// Astro exposes non-`PUBLIC_` variables on `import.meta.env` for server code, and Node
// puts real environment variables on `process.env`. A deploy sets the second; local `.env`
// feeds the first. Checking both means the same code runs in dev and on Workers without a
// branch, and nothing here is ever bundled into a page a diner receives.
export function envVar(name, fallback = "") {
  const fromVite = typeof import.meta !== "undefined" && import.meta.env
    ? import.meta.env[name] : undefined;
  const fromNode = typeof process !== "undefined" && process.env
    ? process.env[name] : undefined;
  return fromVite || fromNode || fallback;
}
