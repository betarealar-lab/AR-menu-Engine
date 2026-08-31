# BetaReal — architecture, costs and roadmap

Written 2026-08-29. The path from what exists today to the product described in
`DECISIONS.md`. Companion to [DECISIONS.md](DECISIONS.md) and [COMPETITORS.md](COMPETITORS.md).

Everything here is a proposal to be corrected, not a settled plan. Items marked
**⚠ placeholder** are guesses that need verifying against real dishes before anyone
builds on them.

---

## Part 1 — Architecture

### The three surfaces, and why they are one product

You named the parts: **admin panel**, **3D model library**, **scanner**. They are not three
apps. They are three views of one object graph:

```
        TENANT (a restaurant)
          |
          +-- MENU ITEM  "Chicken Shqmeruli"  price, description, category, visible
          |        |
          |        '-- attached MODEL  (0 or 1)
          |
          '-- MODEL LIBRARY
                   |
                   +-- MODEL  active   <- attached to an item, live on the menu
                   +-- MODEL  inactive <- made, approved, not attached to anything
                   '-- MODEL  draft    <- generated, not judged yet
```

A model's *state* is just whether an item points at it. "Add 3D model" on an item opens the
library and sets that pointer. Nothing is copied, nothing is duplicated — which is what
makes one model reusable across a chain's branches later.

### Where each piece should live

The honest call: **the existing Next.js admin app is the right host, not the Python Studio.**

It already has Supabase auth, real multi-tenancy with RLS, menu item CRUD, categories, and
the theme editor. The Studio has none of that — it has basic auth and one flat namespace.
Rebuilding tenancy in Python would be rebuilding something that already works.

So the Studio's *UI* becomes pages in the admin app, and the Studio's *engine* becomes a
worker service the admin app talks to.

```
┌─────────────────────────────────────────────────────────────────┐
│  ADMIN APP  (Next.js, Vercel)                                   │
│  auth · tenancy · items · library · scanner UI · menu builder   │
└───────────┬──────────────────────────────┬──────────────────────┘
            │ writes job                    │ reads/writes
            ▼                               ▼
┌───────────────────────┐        ┌──────────────────────────────┐
│  JOB QUEUE            │        │  SUPABASE (Postgres)         │
│  Postgres table       │        │  tenants · items · models    │
│  (or CF Queues)       │        │  jobs · verdicts · events    │
└───────────┬───────────┘        └──────────────────────────────┘
            │ polls
            ▼
┌───────────────────────────────────────────┐      ┌──────────────┐
│  ENGINE WORKER  (Python + Node)           │─────▶│  R2          │
│  engine registry · optimiser · photo QC   │      │  photos      │
│  Meshy today · Hunyuan later              │      │  masters     │
└───────────────────────────────────────────┘      │  catalog     │
                                                   └──────┬───────┘
                                                          │ public, CDN
                          ┌───────────────────────────────▼───────┐
                          │  TENANT SITES  (Astro, CF Pages)      │
                          │  one static build per restaurant      │
                          └───────────────────────────────────────┘
```

### The five decisions that are expensive to reverse

Carry these through everything below.

**1. A job queue, not a thread.** Generation takes 2–3 minutes. Today it runs on a Python
thread inside the web process, with in-memory state. That breaks the moment there are two
containers, and it loses jobs on every deploy. A `jobs` table in Postgres plus a worker
polling it is enough, free, and survives restarts. This is the single most important
structural change.

**2. Records in Postgres, not JSON in R2.** ⚠ **This is a limitation I introduced.** Today
each dish+variant is a `record.json` object. It works, it is race-free, and it cannot answer
a single interesting question: *which dishes failed on glare? which angle strategy wins for
bowls? what is our first-try approval rate this month?* The verdict log is the research
asset — it has to be queryable. Objects stay in R2; **the metadata moves to Postgres.**

**3. Content-addressed asset keys.** Key by hash, not `slug/timestamp_name.glb`. Current
keys embed the tenant slug, so renaming a tenant rots every URL.

**4. Three buckets, three lifecycles.**

| Bucket | Access | Contents | Why separate |
|---|---|---|---|
| `photos` | private, cold | source frames | **Irreplaceable.** The training corpus. ~100 MB/dish |
| `masters` | private, cold | untouched engine output | **Reproducible** — regenerate for ~$0.01. Delete freely |
| `catalog` | **public, CDN** | Draco GLB + USDZ | What diners load. ~2 MB/dish, zero egress |

**5. No vendor names in the schema.** `engine: "meshy-7"` as data, never a `meshy_task_id`
column. Already true in the engine registry; keep it true in the database.

### What I sacrificed for "free and fast", and what to repay now

You asked directly. Four things, in order of how much they will hurt:

| Sacrifice | Consequence | Repay |
|---|---|---|
| **Records as JSON in R2** | Cannot query the research data at all | **Phase 1** — before there is much data to migrate |
| **Threads, not a queue** | Jobs die on deploy; cannot run two containers | **Phase 1** |
| **Basic auth, one namespace** | No tenants, no per-restaurant isolation | Phase 3, when the admin app absorbs it |
| **Free tier spin-down** | 50s cold start | Whenever it annoys the team — $7 |

The first two are cheap now and expensive later. Everything else can wait.

---

## Part 2 — Tools

| Layer | Choice | Why this one |
|---|---|---|
| Admin + scanner UI | **Next.js 16** (existing) | Auth, tenancy and menu CRUD already work |
| Tenant sites | **Astro** on Cloudflare Pages | Static per tenant. Kills the 619 KB shared `index.html` and its per-tenant branches |
| Database | **Supabase Postgres** (existing) | RLS multi-tenancy is already correct |
| Queue | **Postgres table + worker** | Free, no new service, survives restarts. Cloudflare Queues if the whole stack moves to CF |
| Object storage | **Cloudflare R2** | Zero egress. Already chosen, already right |
| Engine worker | **Python + Node** | The pipeline is Pillow (textures) + glTF-Transform (geometry) |
| Generation | **Meshy API** → self-hosted **Hunyuan3D-2.1** | 25–40× cheaper self-hosted; the registry makes it a one-line swap |
| Photo QC | **Pillow/numpy**, then **Claude Haiku** | Free algorithms first, ~$0.007/dish for the semantic pass |
| Hosting (worker) | Render → Fly/Cloud Run | Render for now; move when cold starts or GPU needs force it |
| GPU (later) | Rented 4090 (SaladCloud or similar) | ~$0.01/model against Meshy's $0.25 |

---

## Part 3 — Costs

### Today

| | |
|---|---|
| Render (free) | **$0** |
| R2 (under 10 GB) | **$0** |
| Supabase (free) | **$0** |
| Cloudflare Pages | **$0** |
| Vercel (hobby) | **$0** |
| Meshy Pro | **$20/mo** |
| **Total** | **$20/mo** |

### At ~100 tenants, ~3,000 dishes

| | | Note |
|---|---|---|
| Worker hosting | $7–25 | Render Starter or Fly |
| R2 storage | ~$10 | ~500 GB photos + ~10 GB catalog. Egress free |
| Supabase Pro | $25 | Past the free row/storage limits |
| Vercel Pro | $20 | Past hobby |
| **Generation — Meshy** | **~$750** | 3,000 × $0.25. **Not viable** |
| **Generation — self-hosted** | **~$30** | 3,000 × $0.01 |
| Photo QC (Haiku) | ~$20 | 3,000 × $0.007 |
| **Total (self-hosted)** | **~$110–130/mo** | |

Revenue at 100 tenants × €49 ≈ **€4,900/mo**. Infrastructure is ~2–3% of revenue.

**The number that decides this: generation cost.** Staying on Meshy at 100 tenants costs
more than everything else combined, six times over. Self-hosting is not an optimisation —
it is what makes the unit economics work at all, and it is why the engine registry exists.

### At ~1,000 tenants

Roughly $500–1,500/mo depending on GPU utilisation and whether generation is batched.
Revenue ~€49,000/mo. Not the binding constraint — support and production capacity are.

---

## Part 4 — Roadmap

Rewritten 2026-08-31 around the product Temo actually wants, rather than the order the
code happened to grow in. Phases are dependency-ordered, not calendar-ordered.

### The product, in his words

> Completely self-serve, automated website creation with item management, 3D model
> creation and addition, a photo enhancer that makes normal photos look professional —
> upscaling, colour grading, maybe background change — and an internal statistics
> dashboard with AI recommendations for next actions.

Four products, and they are not equal. **The 3D pipeline is the only one nobody else has
solved for restaurant food.** Website building is a solved commodity; photo enhancement is
a feature of every phone; dashboards are table stakes. What no competitor can do is take
photographs from a phone in a Tbilisi kitchen and return a model a diner will put on their
table. Everything else is what makes that sellable — not what makes it defensible.

So the order below is: finish the moat, then wrap it in the product.

**Current priority, stated:** 3D generation from user photos. Within that, first *reliable
generation and correct model handling, made fast*; second *multi-view generation*.

---

### Phase 0 — Correct what is already wrong

*Done, except where marked.*

**0.1 · Judge the optimised model, not the master** ✅
Review loads what ships. A `Shipping` / `Master` toggle separates "the engine got it
wrong" from "the optimiser did".

**0.2 · Real-world scale** ✅
One dimension — height, width or length — baked into the shipped file, GLB and USDZ alike.

**0.3 · Live resize in AR**
Pinch-to-scale in the AR view, saved back. Partly rescues 0.2 — a typed dimension becomes
a starting point rather than a single point of failure.

**0.4 · Shape and angle picker** ⚠ **placeholder, unchanged**
Every number in that table is still a guess, and will be until ~30 dishes have been shot
and tagged. See below: this is blocked on capture, not on code.

---

### Phase 1 — The 3D pipeline, finished

*The stated first priority. Everything here is about generating reliably, storing
correctly, and being fast.*

**1.1 · Job queue** 🔴 **the blocker**
A `jobs` table, a worker loop, retries, dead-lettering, and a cap that respects Meshy's
concurrent-task limit.
*Why first: at two people pressing Generate simultaneously somebody's work is already at
risk, and the eleventh dish account-wide is refused outright. Work also dies with a closed
tab. And every dish that fails silently is 30 credits burned, not a delay — Meshy deletes
its copy after 3 days.*
*Cost: $0.*

**1.2 · Metadata in Postgres**
`models`, `verdicts`, `faults`, `frames`, `jobs` as real tables. Objects stay in R2.
*Why here: the verdict log is the research asset and today it cannot answer one question —
which dishes fail, which angle wins, what the approval rate is. It is also what the
statistics dashboard is eventually built on. Migrating is cheapest now.*
*Cost: $0.*

**1.3 · Generation history**
Key masters by run, not by engine. Today a re-run overwrites the previous master: judge
one "acceptable", re-run hoping for better, get worse, and the good one is gone — along
with the 30 credits that made it.

**1.4 · Multi-view generation** 🔴 **the stated second priority**
Meshy's `image-to-image` endpoint takes `generate_multi_view: true` and returns three
additional angles — sides, back, three-quarter — from a single photo. The same endpoint
offers `remove_background`.
*Why it belongs here and not in the photo phase: it is not photo editing, it is input
preparation for the 3D engine, and it directly attacks the weakest input we have. Every
dish so far has been generated from ONE photo. Meshy accepts four.*
*The assumption to test, not assume: that generated views beat a single real one. Run the
same dish three ways — one real photo, one photo plus three generated views, four real
photos — and compare. That experiment is what variants exist for.*
*Cost: 3–12 credits per call, unmeasured. Measure it the way the 30 was measured.*

**1.5 · Speed**
Generation is 165 s of Meshy's GPU and cannot be shortened by us. What can: the optimise
(43 s on the free box, 4 s on a laptop — it is CPU-bound and the free tier is 0.1 CPU),
and the cold start (~50 s, gone on any paid tier). **Both are hosting, not code.**

**1.6 · Master handling**
Raw masters archived in R2, optimised files shipped, nothing raw shown to a diner. Already
true — the open question is only whether we ask Meshy for a raw or a lean master, which is
a hosting decision. See DECISIONS.md.

---

### Phase 2 — The photo system

*Temo's design, kept as he described it. Built after the 3D pipeline is reliable, because
every one of these steps exists to protect a 30-credit generation.*

The flow on upload, four outcomes:

| The photos are | What happens |
|---|---|
| **one, and good** | offer to generate three more views; user reviews them; generate |
| **four, and good** | generate straight away |
| **usable but weak** | offer to enhance; enhanced set can then be multi-viewed |
| **unusable** | say so, say what to reshoot, spend nothing |

**2.1 · Quality checks, free and algorithmic**
Blur, exposure, glare, colour cast, and consistency across the four frames.
*Why it pays for itself: rejecting one bad photo saves 30 credits, and on a 33-dish month
that is 3% of the month's capacity per rejected dish.*
*Cost: $0, ~50 ms/image.*

**2.2 · Semantic checks**
*Is this a dish? Is it fully in frame? Are these four the same dish?* Only these need a
vision model, and only after the free checks have thrown out the obvious failures.
*Cost: ~$0.007/dish.*

**2.3 · Enhancement** — upscale, colour grade, background removal.
Grade for **accuracy, not appetite**: a warm Instagram grade bakes a yellow cast into the
model permanently, and baked shadows fight the renderer's own lighting. Background removal
is already available on Meshy's image endpoint.

**2.4 · Capture guidance** — blocked on the fault data, not on code.

---

### Phase 3 — Library, admin, and the menu

**3.1 · Model library** — active / inactive / draft, filter, search, preview.
**3.2 · Item ↔ model attachment** — *Add 3D model* on a menu item opens the library.
**3.3 · Studio inside the admin app** — tenant-scoped, real accounts, not shared basic auth.
**3.4 · Astro per-tenant builds** 🔴 — one 619 KB `index.html` with hardcoded tenant
branches cannot survive signup #400. Blocks everything self-serve.
**3.5 · Menu builder, website editing, publish.**

---

### Phase 4 — Self-serve

Signup and provisioning · billing · onboarding to first live dish in under 30 minutes.

---

### Phase 5 — The statistics dashboard

*Deliberately last, and dependent on 1.2.*

Views, AR opens, per-dish engagement, and "what to do next" recommendations. **This is
worth nothing until there is data to read**, and the data comes from the verdict log and
the tenant sites. Built earlier it would be a page of zeroes with opinions attached.

---

### What is NOT on this list, and why

**Nothing about hosting.** It is not a phase, it is a slider: 512 MB refuses raw masters
and takes 43 s per optimise; 2 GB accepts them and takes seconds. Choose it, do not
build it.

**Nothing about our own generation engine.** Self-hosted Hunyuan is 25–40× cheaper per
model and remains the right end state, but at 33 dishes a month the credit ALLOWANCE binds
long before the per-dish price does. Revisit when volume, not cost, demands it.

**Thirty dishes shot four ways.** No code produces this and everything downstream needs
it: the angle table, capture guidance, the multi-view experiment, and the only research
result in this category nobody else has published.

---

## Part 5 — What I would do first, and why

```
1.1  job queue            two people at once already risks losing work;
                          the 11th dish account-wide is refused outright
1.2  postgres             the verdict log answers no questions at all today,
                          and it is what Phase 5 is eventually built from
2.1  photo checks         one rejected photo saves 30 credits - 3% of a month
1.4  multi-view           the stated second priority, and the first real
                          attack on our weakest input: one photo per dish
```

Everything else is either hosting (a slider, not a project) or downstream of these.

**The unglamorous one that beats all four:** thirty dishes, shot four ways, judged. It
needs no code. It settles the angle table, the capture guide, whether generated views beat
real ones, and it is the only result in this category nobody has published. Every week it
does not happen, the fault tags collect nothing and Phase 2.4 stays blocked.
