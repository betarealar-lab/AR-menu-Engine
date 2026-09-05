# MENU-PLATFORM.md — the self-serve half, and the decisions that are expensive to reverse

Written 2026-09-05, before any of it exists. Companion to [DECISIONS.md](DECISIONS.md) §9
(what Temo settled about the product) and [ROADMAP.md](ROADMAP.md) Part 1 (which sketched
this and got some of it wrong).

**Why this file exists.** Temo: *"0.1 degree off now means we miss the mark by a
kilometre."* He is right, and the kilometre is not where people usually expect. It is not
the framework, not the CSS, not the hosting bill. It is four or five structural choices
that are free today and cost a rewrite in a year. Those are what this file pins down.
Everything else is deliberately left open.

Nothing here has been built. Nothing here is a guess presented as a finding: numbers that
were measured say so, numbers that are projections say so.

---

## 1. What the thing is

One product, two halves, one repo.

```
   OWNER (restaurant, self-serve)                 DINER (phone, no app)
            |                                              |
            v                                              v
   ┌────────────────────────┐                  ┌───────────────────────┐
   │  ADMIN                 │                  │  MENU                 │
   │  sign in · template    │                  │  one Astro app, at    │
   │  items · photos        │                  │  the edge. Reads the  │
   │  Generate 3D · library │                  │  published SNAPSHOT.  │
   │  attach · PUBLISH      │                  │  Never the database.  │
   └───────┬────────────────┘                  └──────────┬────────────┘
           │ writes                                       │ reads
           v                                              v
   ┌────────────────────────┐   PUBLISH        ┌───────────────────────┐
   │  POSTGRES              │ ───────────────▶ │  SNAPSHOT (R2, CDN)   │
   │  tenants · items       │  compiles one    │  immutable JSON, one  │
   │  models · library      │  immutable file  │  per publish          │
   └───────┬────────────────┘                  └───────────────────────┘
           │ enqueues
           v
   ┌────────────────────────────────────────────────────────────────┐
   │  THE ENGINE - already built, in this repo                      │
   │  jobs.py (queue) · pipeline.py (work) · R2 (photos, masters,   │
   │  catalogue). Generation, optimise, USDZ, real-world scale.     │
   └────────────────────────────────────────────────────────────────┘
```

The admin app does not call the engine over HTTP. It writes a job to the same queue the
Scan Studio writes to, and the same workers pick it up. **That is the reason both halves
are one repo** and it is worth restating: an API between them would be a contract to
version, a second auth story, and a second place for a dish to be half-defined.

---

## 2. The five decisions that are the kilometre

### 2.1 · A diner request must never touch the database

This is the one. Everything else on this list is recoverable in a weekend; this one is
not, because it decides the shape of every page.

**Publishing compiles the menu into an immutable JSON snapshot on R2, behind the CDN. The
menu page reads that file and nothing else.** The owner's edits go to Postgres; Postgres
is read by owners only.

What it buys, in order of how much it matters:

- **Diner traffic stops being a scaling problem entirely.** A CDN serving a static object
  does not care whether there are 4 tenants or 40,000. There is no connection pool to
  exhaust, no query to slow down, no read replica to add.
- **A slow or down database cannot take the menus down.** The thing a restaurant is
  paying for stays up while the admin app is broken.
- **Updates stay fast anyway** — the thing Temo asked for. A publish is one object write
  plus a cache purge: seconds, not a rebuild. This is the whole reason not to build one
  static site per tenant.
- **It is free.** R2 egress is zero and the objects are tiny.

The rule to hold: **if a diner-facing page ever needs a query, the answer is to put the
data in the snapshot, not to add an index.**

### 2.1a · The menu is RENDERED with its template. It is never re-skinned in the browser

Temo, 2026-09-05, on the current platform: *"templates overlay over the og build and that
shit takes time to load, we want template and unique menu to be the og custom build for
them where users dont have to wait for a website to load and then reload."*

That is a correct diagnosis of what exists today. One generic `index.html` loads, then
JavaScript fetches the tenant's theme and re-skins the page. The diner therefore sees
three states: blank, generic, then branded. The second state is the bug, and no amount of
optimising the payload removes it, because it is architectural.

**A snapshot read client-side would reproduce exactly the same bug** — load a shell, fetch
the data, render. So it is not read client-side.

**The Worker renders the complete HTML at the edge**, with the template's critical CSS and
the tenant's theme variables inlined in `<head>` and the menu items already in the markup.
The first bytes the browser receives are already that restaurant's menu. There is no
second state to flash to. Then the rendered HTML is cached at the edge, keyed by tenant
and snapshot version, so every diner after the first is a pure CDN hit with no compute at
all — and a publish changes the key, so the next request re-renders.

**This is what "the og custom build for them" means without building 400 sites.** Each
tenant genuinely has their own fully-rendered page; it is produced on publish instead of
on `git push`, which is the only difference and it is the one that matters — a price
change is live in seconds, not a rebuild.

Three ways to lose this, all of them easy:

- **Any theme applied by JavaScript brings the flash straight back.** Theme is CSS custom
  properties in an inline `<style>` in the head. Never a class the client adds, never a
  stylesheet fetched after paint.
- **Web fonts flash on their own.** Preload, `font-display: swap` with a real fallback
  stack chosen to match metrics, or the branded page still visibly changes shape.
- **3D thumbnails are heavy and must not block first paint.** Live thumbnails spawn one
  WebGL context per card, which is the real reason for the 5-item cap (DECISIONS §7). They
  load after the menu is readable, never before it.

### 2.2 · One Astro app, admin included. Templates are a registry, not per-tenant branches

Today the customer app is a single ~619 KB `index.html` with fourteen hardcoded
`data-template="..."` branches, and adding a restaurant's look means a developer editing
that file and shipping a deploy. That does not break at signup #400. **It breaks at
template #16**, and it already means a template cannot be added without us.

So: **one app, deployed once. A template is a component plus a preset row in the
database.** Adding one touches no tenant. Choosing one is a column.

Temo asked for "easy ability to add custom templates to the catalog" — that is exactly
this, and it is only possible if templates are data.

**The admin app is the same Astro app, not a separate Next.js one.** The reason is not
taste, it is one specific failure: with two frameworks, a template exists twice — once as
the component that renders the live menu, and once as whatever the admin uses to preview
it. Those two implementations drift, and the day they do, the owner approves a preview
that is not what diners get. One codebase makes the preview *literally the same component*
as the page, so "what you see" and "what ships" cannot disagree.

Secondary, and real but smaller: one deploy, one auth session, one build. Astro islands
handle the interactive parts of an admin (forms, the library grid, drag-to-reorder) without
turning the whole thing into a single-page app.

**The honest counter-argument:** Next has the richer ecosystem if the admin ever grows into
a heavy dashboard, and Astro is the less natural fit for that. It is not a trap — Astro
hosts React islands, so a heavy page can be a React island inside it — but if the admin
ever becomes the majority of the work, revisit this. It is not the case today and is not
close.

### 2.3 · Every row carries a tenant id, and RLS is on from the first migration

Retrofitting multi-tenancy is the classic version of missing by a kilometre: it is not a
migration, it is an audit of every query in the system, forever, with a data leak between
two restaurants as the cost of missing one.

It is nearly free on day one. It is on from the first table.

**Corollary:** the super-admin path (us, seeing everything) is a separate, explicit role,
never "RLS off for convenience". And **no plaintext passwords, ever** — Niko's repo has a
table of them and `ARCHITECTURE-DEBT.md` §1 correctly calls it the worst thing in that
codebase. It does not come across.

### 2.4 · Assets are addressed by hash, not by name

`tenant-slug/2026-09-05_burger.glb` embeds two things that change: the tenant's name and
the file's name. Rename a restaurant and every URL in every published snapshot rots.

Key by content hash. A rename becomes a database update and nothing else moves. This is
ROADMAP Part 1 decision 3, and it is cheap now and a migration of every object later.

### 2.5 · Analytics events are not menu data

This is the only part of the system where "HUGE amount of data" is literally true, and it
is worth being precise rather than nervous.

At 400 tenants with 200 diner sessions a day each and ~8 events a session, that is
**~19 million events a month** — against roughly **40,000 rows of actual menu data**. They
are different problems by three orders of magnitude and they do not go in the same place.

Events go to an append-only sink, are rolled up on a schedule, and the dashboard reads the
rollup. Never the raw table. Cloudflare's Analytics Engine is built for exactly this shape
and is nearly free at that volume; a rollup table in Postgres also works. **That choice can
be made later** — what cannot be made later is having written raw events into the same
tables the product queries.

### 2.6 · Four buckets, no public ones, and no custom domains on any of them

R2 is the right store for all four, but for four different reasons, and it is worth being
precise because "R2 for everything" is otherwise just a habit.

| Bucket | Why R2 specifically |
|---|---|
| `betareal-catalog` | **This is the whole argument.** ~500 GB a month of models to diners at 400 tenants. R2 egress is $0; on S3 the same traffic is ~$45 a month and grows linearly with success. Nothing else in the decision is close to this in value |
| `betareal-models` | Masters, ~96% of stored bytes, written once and read almost never. This wants the cheapest durable byte available and nothing else. Candidate for the Infrequent Access storage class later — verify the current retrieval price before switching, do not assume it |
| `betareal-photos` | Small, irreplaceable, cold. Any object store would do; R2 wins on **already having the credentials, the code and the mental model**. A second storage vendor for 7 GB would be a whole new failure mode bought for nothing |
| `betareal-menus` | Published snapshots. Cloudflare KV is arguably the better technical fit — globally replicated, built for small read-heavy values — where R2 has one primary region. But the Worker caches the *rendered HTML* at the edge, so a snapshot is read roughly once per tenant per publish per edge location, which is nothing. **R2 now; revisit KV only if a measurement ever shows the cache miss mattering** |

**All four stay private, and none of them gets a custom domain.** The Worker binds them
directly (`env.CATALOG.get(key)`), which is better than a public bucket in three separate
ways:

- **It sidesteps the DNS problem entirely** — see §7. An R2 custom domain requires the
  zone to live in the same Cloudflare account as the bucket, and `betareal.ge` does not.
- **We control the response headers.** A signed R2 URL answers with the bytes and **no
  `Access-Control-Allow-Origin`**, so the browser fetches the model, applies the same-origin
  rule and silently discards it. That exact bug made the Studio's 3D viewer show an empty
  panel for days (HANDOFF §6). Serving through the Worker cannot fail that way.
- **A private bucket cannot be enumerated.** A public bucket's contents are a URL away.

The cost is Worker invocations, and it is not a real cost: cached responses never reach the
Worker at all, and the misses are ~600,000 a month at 400 tenants against the 10,000,000
included in the $5 Workers plan.

---

## 3. The data model, in one page

```
TENANT ────┬── MENU ITEM        name, price, category, description, visible
           │        └── model_id  (0 or 1 pointer into the library)
           │
           ├── LIBRARY ITEM     a model this tenant owns
           │        state: draft (generated, unjudged)
           │               inactive (approved, attached to nothing)
           │               active (some item points at it)
           │
           ├── TEMPLATE choice + THEME overrides
           │
           └── PUBLICATION      pointer to the current snapshot
```

**A model's state is not a column, it is a consequence.** "Active" means an item points at
it. Attaching sets a pointer; nothing is copied. That is what makes one model reusable
across every branch of a chain later, and it is why the library and the menu are two views
of one graph rather than two tables that must be kept in step.

**Draft and published are separate.** The owner edits a draft continuously; publishing
compiles it. Without this split you cannot have both "updates are fast and dynamic" and "a
diner never waits" — every keystroke would either be live or require a build.

---

## 4. What the numbers actually are

**Measured on the real buckets, 2026-09-05**, not projected. An earlier draft of this file
put photos at ~100 MB a dish and made them the largest line item. That was ROADMAP Part 1's
figure for raw pro-camera files, and it is wrong for anything actually in the system: the
browser downscales every upload before it is sent (HANDOFF §6), so nothing raw ever arrives.
Temo caught it. The real shape is almost the inverse.

Per object, from the live buckets:

```
photos      145 kB average per frame          (6 real frames, 0.87 MB total)
master glb   68-99 MB                          (raw meshy-7)
master usdz  73 MB                             Meshy's own - SEE BELOW
master png  ~100 kB                            thumbnail
catalog     draco 2.4-5.7 MB + usdz 3.1-8.5 MB + opt 3.2-8.9 MB
```

At **400 tenants x 30 dishes = 12,000 dishes** (the tenant count is a projection and is
the only projection here). R2 storage is $0.015/GB-month, egress zero:

| | per dish | at 12,000 dishes | $/month |
|---|---|---|---|
| Photos, 4 frames | ~0.6 MB | 7 GB | **0.10** |
| Masters, as archived today | ~160 MB | 1.9 TB | **29** |
| Masters, without the dead USDZ | ~85 MB | 1.0 TB | **15** |
| Catalogue (what diners load) | ~11 MB | 129 GB | **2** |
| Menu data in Postgres | — | ~40,000 rows | **0** |
| Diner egress | — | ~500 GB/month | **0** — R2 |

**~$31 a month at 400 tenants, or ~$17 with the finding below applied.** Against ₾300 a
month per tenant, infrastructure is not the constraint and never becomes one. The scaling
problem here is sales; the engineering job is only to not build something that falls over.

**Masters are ~96% of storage and photos are ~0.4%.** Any argument about storage is an
argument about masters, and nothing else is worth the breath.

### 4.1 · A 73 MB file per dish that nothing has ever read

Generation archives everything Meshy returns, including **Meshy's own USDZ built from the
raw master** — 72.8 MB and 72.3 MB for the two dishes that have one. `master_keys` is read
in exactly two places in the codebase, and both want `png`, the thumbnail. Nothing reads
that USDZ. Not the viewer (`_model_key` returns the GLB for the master stage), not the
download bundle, not the optimiser, which correctly builds its own USDZ from the
*optimised* GLB — carrying Meshy's over is the iOS bug in HANDOFF §6 and must never happen.

Right now it is **37% of everything in `betareal-models`** (145 MB of 388 MB). At 12,000
dishes it is 0.9 TB and $14 a month to keep a file with no reader.

**Fixed 2026-09-05.** Temo: *"meshy should not build its own usdz, that is dumb, meshy
should have its own glb and then glb is optimized and converted to usdz... master is same
be it glb or usdz whatever u wanna call it."* Exactly right — it was never extra
information, only the same mesh in another container, produced before any of our
decimation, textures or real-world scale had touched it.

Two places, deliberately:

- `engines/meshy.py` no longer downloads it. Saves the 73 MB transfer as well as the
  storage.
- `pipeline.store_result` refuses to archive a `usdz` **whatever engine hands one over**,
  so the next engine — Hunyuan, or anything else — inherits the rule rather than
  rediscovering it.

**The rule, stated once:** the master is the GLB. Every format a diner loads is derived
from that GLB by our own pipeline, because that is the only path along which the
decimation, the texture resize and the real-world scale actually reach the file.

`check_webhook.py` now hands back a USDZ from the stub engine, the way Meshy does, and
asserts it never reaches storage while the shipped USDZ is still built from the optimised
GLB. The two existing files (145 MB) are still in the bucket pending Temo's word.

### 4.2 · The pro-camera originals are not this system's problem — corrected

An earlier version of this section worried that the 145 kB stored frames are downscaled
JPEGs rather than pro-camera originals, and that this loses "the training corpus" for a
future self-hosted engine. Temo corrected it, 2026-09-05:

> *"there is no pro camera original and stuff, pro camera is used by us for manual
> scanning then we take it to kiri and so on and on, it is our own manual pipeline, if
> user uses pro camera or smth is not relevant to us, if we use pro camera photos in this
> then that means pro camera photos of ours is already stored so worry not."*

He is right, and it follows from DECISIONS §9's split. **The pro camera belongs to the
Premium pipeline**, which is ours and lives outside this system — shoot, colour grade,
export JPG, and from there either into KIRI for photogrammetry or straight into Meshy
(the AI path is the shorter one; KIRI is bypassed). The originals are already kept there,
by us, as part of that workflow.

What reaches these buckets is the graded JPG that was going to be sent to the engine
anyway. For **self-serve**, the input is a phone photo and there is no higher-fidelity
original to lose. Either way, nothing is being thrown away here that anyone has.

**So there is no action.** ROADMAP's "irreplaceable — the training corpus" framing is a
Premium-pipeline concern that it filed under the wrong system.

---

## 5. What this deliberately does NOT decide

Kept open on purpose, because deciding early buys nothing:

- **Billing and plan gating.** DECISIONS §9.3: no paywall now, authorised accounts only
  while testing. The schema should not pretend to know what the tiers are.
- **Which analytics sink.** §2.5 — the shape is decided, the vendor is not.
- **Menu import from a photo or PDF.** DECISIONS §9.2: typed first. The item model must be
  clean enough that an importer can write into it later, and that is the only obligation.
- **Custom domains per tenant.** Subdomains work today (see the domain memo). Custom
  domains are a Cloudflare-for-SaaS feature and a later decision that this design does not
  foreclose, because the snapshot is addressed by tenant id, not by hostname.
- **Whether the Scan Studio survives.** It is an internal tool with basic auth. Eventually
  the admin app absorbs it; there is no reason to force that early, and the queue means
  both can drive the same engine in the meantime.

---

## 6. Build order

Skeleton, then muscles, then organs, then hair, then lipstick — DECISIONS §9.5.

**Skeleton** — nothing looks good yet, everything connects.
1. Schema + RLS: tenants, items, library, templates, publications. One migration.
2. Auth: sign in, one tenant, authorised accounts only.
3. The publish path end to end: edit an item → publish → a snapshot on R2 → a menu page
   at a URL that reads it. **Even with one ugly template, this is the whole architecture
   proven.**

**Muscles** — the loop the product is actually for.
4. Photo upload → `jobs.enqueue("generate", ...)` → the existing engine → library.
5. Owner approves or rejects. Attach a model to an item. Publish. It is on a diner's table.

**Organs**
6. Template registry and the theme editor. Several templates, addable without a deploy.
7. The 3D and AR viewer on the menu page, at real-world scale.

**Hair and lipstick**
8. Onboarding, menu import, the statistics dashboard, billing.

**Step 3 is the one that proves the architecture.** If a snapshot can be published and
rendered without a database in the path, everything after it is filling in. If it cannot,
we find out in week one rather than at tenant #200.

**None of steps 1-7 needs DNS.** A Worker gets a free `*.workers.dev` hostname, so the
whole system can be built and tested on real infrastructure before the blocker below is
touched. DNS is the last step before real tenants, not the first.

---

## 7. The one real blocker, and it is not technical

**`betareal.ge` is a zone on Niko's personal Cloudflare account, not BetaReal's.**

That is the same fact behind the Error 1014 that broke per-tenant subdomains in July: a
CNAME pointing at a Pages project in a *different* Cloudflare account is refused, and only
the two subdomains added by hand as Custom Domains ever worked.

It applies here unchanged. An R2 custom domain — and a Worker route on `*.betareal.ge` —
both require the zone to be on the same account as the resource. Buckets created in the
BetaReal account cannot be given a `betareal.ge` hostname while the zone lives elsewhere.
**§2.6 routes around it for storage** by keeping every bucket private behind a Worker, so
this blocks nothing until real tenants need branded URLs.

But it does have to be fixed, and it is on the decentralisation critical path rather than
the engineering one. The route recommended in July still stands: recover the **.ge
registrar** account (registrar.ge / Proservice / Grena — company-owned and independent of
anyone's Cloudflare), repoint the nameservers at BetaReal's Cloudflare account, and then a
single Worker route `*.betareal.ge/*` gives every tenant slug a working branded hostname
with SSL and no per-tenant setup at all. Cloudflare Pages cannot do wildcard custom domains
and caps at ~100 per project; Workers has no such limit, which is another reason the menu
is a Worker and not a Pages site.

Until then, `*.workers.dev` is a real, working, SSL-terminated hostname and is enough for
everything up to the first paying self-serve tenant.
