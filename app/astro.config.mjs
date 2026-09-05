// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// Server-rendered, not static. A menu is one page per restaurant per publish, and the
// point of rendering it on the server is that the dishes arrive IN the HTML - the browser
// paints a finished menu instead of running 290 KB of JavaScript to build one.
//
// Node adapter for local work; the Cloudflare adapter swaps in when this deploys. The
// route code does not change - it reads a payload and returns HTML.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  build: { inlineStylesheets: "auto" },
  vite: {
    build: {
      // One CSS file per template, hashed and immutable, instead of 356 KB inlined into
      // every page. See MENU-PLATFORM 10.
      cssCodeSplit: true,
    },
  },
});
