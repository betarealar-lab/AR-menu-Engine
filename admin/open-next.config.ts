// The admin, as a Cloudflare Worker.
//
// **Why Cloudflare and not Vercel.** The menu already runs here, the photos and models are
// in R2 in this account, and the whole point of the BetaReal Cloudflare account existing is
// that the company stops depending on a teammate's personal one. Putting the admin on a
// second provider would trade that back for a marginally easier deploy.
//
// The cost was one dependency bump: `@opennextjs/cloudflare` supports
// `next >=15.5.24 <16 || >=16.3.3`, and the admin was pinned at 16.2.6 - squarely inside
// the gap. 16.3.4 is the same major, `tsc` is clean, the build is clean and all 136 checks
// in `check_admin.py` pass on it.
//
// No `incrementalCache` override, deliberately. That exists for ISR and cached SSG, and
// this app has neither: every screen is `ƒ` (server-rendered on demand) because every
// screen is one restaurant's private data, and the four genuinely static pages (/login,
// /start, /reset-password, /set-password) are prerendered at build and served from the
// asset host. Adding the R2 cache would mean another bucket to create, pay for and reason
// about, to cache nothing.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
