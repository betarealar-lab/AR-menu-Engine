# RISKS.md — things that are live, load-bearing, and not ours

Findings about the running BetaReal platform, raised because somebody should know. **None
of these are ours to fix** — the platform repo and its infrastructure are read-only for
this codebase (DECISIONS §9.7). This file exists so a real exposure is written down once
rather than rediscovered, and so nobody "helpfully" edits Niko's code because of it.

---

## 1. 🔴 Diners load 3D models from Cloudflare's *development* URL

**What.** Every model on every live menu is served from
`https://pub-b253d60df14c4c1f94bada002fa59596.r2.dev/...`. Confirmed on 2026-09-05 in the
live Monday Greens data — `model` and `model_usdz` on all seven of its 3D dishes.

**Why it matters.** `r2.dev` is Cloudflare's public *development* endpoint for an R2
bucket. Cloudflare documents it as rate limited and explicitly not intended for production
traffic; there is no SLA and no guarantee about throughput. It exists so you can check a
bucket works before attaching a real domain.

Our models are 1.6–3 MB each and a diner downloads one per dish they open. That is exactly
the traffic profile the endpoint is not for. The failure mode is not an error page — it is
a model that loads slowly or not at all, on somebody's phone, at a table, which reads to
the diner as "this restaurant's fancy menu is broken".

**The fix, for whoever owns it.** Attach a custom domain to the bucket (R2 → the bucket →
Settings → Custom Domains) and swap the base URL. It is a DNS record and a find-replace.
The blocker is the same one in MENU-PLATFORM §7: an R2 custom domain needs the zone on the
**same Cloudflare account** as the bucket, and `betareal.ge` is on a personal account. So
this and the Error 1014 subdomain problem are one problem wearing two hats, and both are
fixed by moving the zone.

**What we do instead.** The self-serve menu never uses `r2.dev`. Buckets stay private and
a Worker serves their bytes (§2.6), which also means we control cache headers and CORS.

---

## 2. 🟠 The `load` event on model-viewer 3.4.0 may not be firing in production either

**What.** Measured in Chrome, 2026-09-05: model-viewer 3.4.0 does not reliably fire
`load`. With `camera-controls` alone, `progress` reaches 1, `load` never fires and
`.loaded` stays false. The platform's `_upgradeThumb` adds `thumb-model-ready` on `load`
**alone**.

**Why it matters, and why it is only orange.** If the event does not fire there, the
wrapper never flips and live thumbnails stay as their poster images — which looks almost
right, because the poster is the same dish. Nobody would report it. It is a plausible
silent degradation of a feature that is being paid for, not an outage.

**Not confirmed on their deployment.** Our port had the same bug and it was fixed here by
revealing on whichever of three signals arrives first. Somebody with the platform in front
of them can check in one line: open a menu with live 3D thumbnails and look for
`.thumb-model-ready` on a `.thumb-wrap`.

---

## 3. 🔴 Plaintext client passwords (already known)

`ARCHITECTURE-DEBT.md` §1 in the platform repo records it and calls it the worst thing in
that codebase. Repeated here only to say: **it does not come across.** The self-serve
platform has no password column and will not get one — accounts are invite plus a
set-password link (DECISIONS §9, and 0002_grants keeps `anon` granted nothing anywhere).
