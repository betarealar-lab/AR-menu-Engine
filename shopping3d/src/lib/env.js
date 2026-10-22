// env.js — where server-side secrets and bindings come from.
//
// Three runtimes have to agree here, and they keep their configuration in three places:
//
//   astro dev      a local .env, which Vite exposes on `import.meta.env`
//   node           real environment variables, on `process.env`
//   cloudflare     per-request bindings and secrets, on `locals.runtime.env`
//
// The Cloudflare one is the awkward member: its values do not exist as globals at all.
// They arrive with the request, which is deliberate on Cloudflare's part - one Worker
// isolate can serve several environments - and it means anything reading configuration has
// to be handed the request's env rather than reaching for it.
//
// So the shape is `envFrom(locals)` returning a getter. Explicit, boring, and it works the
// same in all three places without depending on an adapter internal or a global that may
// or may not be populated by the time we look.

/** A getter over this request's configuration. Pass `Astro.locals` (or a route's
 *  `context.locals`); it is fine if that is undefined - the Node and dev paths still work. */
export function envFrom(locals) {
  const rt = locals?.runtime?.env;
  return (name, fallback = "") => {
    const fromWorker = rt ? rt[name] : undefined;
    const fromNode = typeof process !== "undefined" && process.env
      ? process.env[name] : undefined;
    const fromVite = typeof import.meta !== "undefined" && import.meta.env
      ? import.meta.env[name] : undefined;
    return fromWorker || fromNode || fromVite || fallback;
  };
}

/** A binding - an R2 bucket, a queue - by name. Present only on Cloudflare; `null`
 *  elsewhere, so a caller can fall back to the S3 API in development. */
export function bindingFrom(locals, name) {
  const b = locals?.runtime?.env?.[name];
  // A secret is a string; a binding is an object with methods. Checking the shape rather
  // than the name means a secret and a binding cannot be confused for one another.
  return b && typeof b === "object" ? b : null;
}

/** The no-request form, for module scope and scripts. Never sees Cloudflare's env, so it
 *  must not be used for anything a Worker needs at runtime. */
export function envVar(name, fallback = "") {
  const fromNode = typeof process !== "undefined" && process.env
    ? process.env[name] : undefined;
  const fromVite = typeof import.meta !== "undefined" && import.meta.env
    ? import.meta.env[name] : undefined;
  return fromNode || fromVite || fallback;
}
