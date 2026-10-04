# EMBED.md — a dish on somebody else's website

> **Built 2026-09-21 on branch `feat/embed`.** Migration `0028_embed` is written and was
> tested against the real database inside a rolled-back transaction; **it has not been
> applied.** Read with MENU-PLATFORM.md (the architecture this plugs into) and
> DECISIONS.md §9 (self-serve vs Premium).

## What it is

A restaurant that already has a website — its own, an agency's WordPress, a delivery site —
pastes one block next to a dish. That dish shows up there in 3D, with **View on your
table**. The model still comes from us: their page holds only the dish's id, never a file.
Re-scan the dish and every site showing it updates. Switch the restaurant off and every
embed drops to the photo.

The same page is also the **link** — `/d/<item id>` opened on its own, for an Instagram
bio, a WhatsApp message, a QR on a delivery bag.

It is tier-agnostic by construction: a Premium (manual scan) model and a Self-Serve
(engine) model are both rows in `models`, attached to an item the same way, so the embed
serves both without knowing which is which. Premium restaurants still on the old platform
get embeds once their menu is in this system (Corner already is).

## Where it plugs in — nothing new where something existed

| Needed | Already here | Added |
|---|---|---|
| Safe public dish id | `items.id` is a random uuid (0001) | — |
| Model separate from dish | `models` + `items.model_id` (0001, 0024 shared) | — |
| Serve files cross-site | `/a/<key>`: private bucket, `Access-Control-Allow-Origin: *`, immutable cache | — |
| One-dish AR page | `/ar` (keyed by storage key, for the studio QR) | `/d/<item id>` (keyed by dish, public) |
| Data with the weakest key | `public_menu(slug)` (0015/0026) | `public_dish(uuid)` — same rules, one dish (0028) |
| Analytics | `/e` → `record_events` whitelist | three names: `embed_view`, `embed_3d`, `embed_ar` (0028) |
| Who may embed | — | `tenant_embed`: active switch + allowed sites, super-admin write only (0028) |

## Files

```
menu/migrations/0028_embed.sql     tenant_embed, public_dish(), record_events + 3 names
app/src/lib/embed.js               the decision: photo or 3D, frame-ancestors, shaping
app/src/pages/d/[id].astro         the page - link and embed in one
app/public/embed.js                the optional loader on THEIR page (~3 KB gzipped)
app/src/pages/help/embed.astro     "where to paste it", per website builder, EN + KA
app/scripts/check-embed.mjs        14 tests of the decision (node --test)
admin/lib/embed.ts                 generates the block; cleans the site list
admin/components/EmbedSection.tsx  QR & share → "On your website": Copy code / link /
                                   preview per 3D dish; settings card for super admins
```

## The decisions, and why

**1. One body-level block, generated, never hand-written.** A `<head>`/custom-code field
is the most plan-gated feature on every website builder (Squarespace: Core+; Wix:
Premium); an HTML/embed block is on nearly all of them. So the block needs no head step:

```html
<div data-betareal-dish="<id>" style="position:relative;max-width:560px">
  <iframe src="https://<menu>/d/<id>" title="… in 3D" loading="lazy"
          allow="xr-spatial-tracking; fullscreen" allowfullscreen
          style="display:block;width:100%;aspect-ratio:4/3;border:0;border-radius:12px"></iframe>
</div>
<script async src="https://<menu>/embed.js"></script>
```

It degrades on its own. Script stripped by the builder → the frame still shows 3D and
still does Android AR, because `allow="xr-spatial-tracking"` is in the block we
generated. Generated is the point: a person writing an iframe forgets that attribute, and
AR silently becomes a 3D preview.

**2. AR runs where it is allowed to.**
- *Android* — WebXR inside the frame, legal because of the `allow` above. Same model-viewer
  as `/ar`, `ar-scale="fixed"`: true size, not pinchable — the portion is the point.
- *iPhone* — Quick Look is a click on `<a rel="ar">`, and from a cross-origin frame Apple
  documents nothing. So the frame says hello; the loader draws the button **on their
  page** (shadow DOM — their CSS cannot touch it) and the tap is a top-level click.
  Without the loader, the frame's own button opens `/d/<id>` on its own, where it works.
  Late loader is handled: it pings frames that said hello before it arrived.

**3. No API keys, no docs platform (the Vimeo model).** Embeds are keyless industry-wide
(YouTube, Vimeo, Sketchfab); keys appear when strangers self-integrate or servers call
servers. We install for our clients. Control is `tenant_embed`:
- **active** off → every embed and the link show the photo only. The non-payment lever.
- **allowed_sites** → a framed request from another site gets the photo, quietly (no blank
  box). Enforced by the browser through `frame-ancestors`, which a page cannot opt out of,
  so stripping the Referer does not get around it. The **link** is never restricted — it is
  our page.
- No row = active, allowed anywhere. A uuid nobody can guess, handed out by us.
- Its own table because `tenants` is owner-writable (`tenants_write`) and an owner must
  not be able to switch themselves back on. anon has **no grant at all** on it; the page
  reads it only through `public_dish`.

It is abuse control, not DRM. There is no DRM for a GLB: anything the browser renders, it
has downloaded. What we promise is that a dish cannot be *used* elsewhere.

**4. Analytics: separate names, no visitor id.** `embed_*` rather than `item_open` /
`ar_open`, because a stranger's page is a different audience from a diner at the table
and mixing them would quietly move every menu number. No cookie, no stored id: a frame's
storage is partitioned per top-level site in every current browser, so a "visitor" there
would count wrong. `meta` carries `host` (which site), `framed`, `mode`, and for AR `via`
(webxr / quicklook / parent / newtab) and `stage` (tap / placed).

**5. Speed on their page.** Loader: ~8 KB raw, no dependencies, async, no cookies. The frame
is `loading="lazy"`; inside it the poster paints first and model-viewer (~250 KB, shared
CDN cache) loads only when the dish scrolls into view — `?load=tap` defers it to a tap.

## Verified

- Migration run for real inside a transaction, then rolled back: `public_dish` as anon
  returns the dish; unknown id → null; anon cannot read or write `tenant_embed`; a settings
  row takes effect; `record_events` stores `embed_view`/`embed_ar` and drops junk.
- Page, locally, against a stand-in database answering with `public_dish`'s real output and
  the real R2 files: no list → 3D anywhere; allowed site → 3D + `frame-ancestors`;
  copycat site → photo, **model URL absent from the page**; link from Instagram → 3D;
  bad/unknown id → 404.
- Real Chrome driven as a touch iPhone and a touch Android, on a fake restaurant page on
  another origin with hostile CSS (`button{background:red!important}`, pink iframe borders):
  3D renders centred in both themes; iPhone → button drawn on the parent (2 of 2), themed;
  Android → in-frame button, no stray model-viewer icon; hostile CSS reached nothing.
- `check_features.py` 193/193 (it cross-checks event names against the newest whitelist —
  0028's). `check-embed.mjs` 14/14. Admin `tsc` + `eslint` clean. `astro build` clean.

Bugs found by looking rather than by the tests, and fixed: Astro scoped the page's styles
away from the script-created viewer (it drew at 300×150 in a corner); model-viewer's own AR
icon competed with ours; the parent's iPhone button was dark-on-dark in the dark theme; a
loader arriving after the frame's hello never answered.

## Not verified — needs a real phone

Emulation proves the wiring, not the AR session itself:
1. **Android WebXR inside the frame** actually starting the camera.
2. **iPhone Quick Look from the parent-drawn button.**
3. **Instagram / Facebook in-app browsers** — where restaurant traffic comes from.
4. **Wix**: its HTML widget nests our frame inside its own, and permissions policy does not
   pass through a nested frame, so AR there probably falls back to the link. Help page
   already says so; confirm.

## To ship

1. `python menu/migrate.py` — applies 0028 (additive; nothing existing changes meaning).
2. Merge `feat/embed`; deploy the menu Worker and the admin as usual.
3. `PREVIEW_ORIGINS` on the Worker must include the admin's origin, or the admin's Preview
   frame is refused once a restaurant has a site list.
4. Phone checks above, on the deployed URL.

## Later, only on a trigger

| Trigger | Then |
|---|---|
| An agency integrates without us | a docs site; npm/React wrapper for `<betareal-dish>` |
| A delivery/ordering platform wants dishes automatically | secret keys, a JSON API, webhooks on re-scan |
| Usage-based pricing | per-embed metering from `embed_*` + `meta.host` |
| Marketplaces (Wolt, Glovo, Bolt Food) | nothing can be embedded there, ever — sell renders and turntable video from the same model instead |
| Edge caching of menu pages lands (MENU-PLATFORM §2.1) | cache `/d/` the same way, keyed on the dish and publish version |
