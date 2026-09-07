// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

// Server-rendered, not static. A menu is one page per restaurant per publish, and the
// point of rendering it on the server is that the dishes arrive IN the HTML - the browser
// paints a finished menu instead of running 290 KB of JavaScript to build one.
//
// Cloudflare, because that is where the files already are: R2 holds every photo and model,
// so serving them through a binding is same-network and needs no credentials at all. It is
// also the network a diner in Tbilisi is closest to.
//
// `nodejs_compat` is on for one reason: the AWS S3 SDK, which is imported ONLY on the
// development path in `/a/[...key].js` and never runs on Cloudflare - the deployed Worker
// reaches R2 through its binding. Left on because the fallback has to compile either way.
export default defineConfig({
  output: "server",
  adapter: cloudflare({
    platformProxy: {
      // OFF, deliberately. With it on, `astro dev` gets Cloudflare's LOCAL R2 simulator -
      // an empty bucket on disk - while the admin uploads to the real one. The two halves
      // of the product then disagree about what exists, and every round-trip check fails
      // for a reason that has nothing to do with the code.
      //
      // Off, dev has no bindings and falls back to the S3 path in `/a/[...key].js`, which
      // reads the same real bucket the admin writes to. The Workers binding path is
      // exercised on purpose with `npx wrangler dev` instead - see wrangler.toml.
      enabled: false,
    },
  }),
  build: { inlineStylesheets: "auto" },
  vite: {
    build: {
      // One CSS file per template, hashed and immutable, instead of 356 KB inlined into
      // every page. See MENU-PLATFORM §10.
      cssCodeSplit: true,
    },
  },
});
