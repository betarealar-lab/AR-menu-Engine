// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

// The menu app's setup, unchanged (see app/astro.config.mjs for the reasons): server
// rendered on a Cloudflare Worker, R2 through bindings, and the platform proxy OFF so
// `astro dev` reads the real bucket through the S3 path in /a/[...key].js.
export default defineConfig({
  output: "server",
  adapter: cloudflare({ platformProxy: { enabled: false } }),
});
