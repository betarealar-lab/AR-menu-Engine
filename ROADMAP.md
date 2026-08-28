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

Phases are dependency-ordered, not calendar-ordered. Each says why it comes before the
next.

---

### Phase 0 — Correct what is already wrong

*Days. Do before anything is built on top.*

**0.1 · Judge the optimised model, not the master** ✅ **done**
Generation now runs the optimiser itself, and review loads the result. A `Shipping` /
`Master` toggle sits above the viewer, defaulting to shipping, so a contested verdict can
still be checked against the original — the only honest way to separate "the engine got it
wrong" from "the optimiser did". `catalogued` stopped being a status: a variant is
shippable when it *has* catalogue files, which is a fact about the object graph rather than
a flag someone has to remember to set.

**0.2 · Real-world scale** ✅ **done**
One dimension — height, width or length, any one — typed into the review rail, with a shape
picker that proposes a starting number. Setting it re-runs the optimiser (5 seconds, no
credits), because the size is baked into the shipped file rather than applied by the
viewer, and the model is centred and seated on y=0 whether or not anyone has given a size.
Measured: 104 MB master → 1.85 MB Draco at exactly 28.0 cm across.
See [DECISIONS.md](DECISIONS.md) §2 for why one dimension is enough, what `width` means,
and why placement happens before Draco rather than after.

**0.3 · Live resize in AR**
Pinch-to-scale in the AR view, saved back to the model. Partly rescues 0.2 — a typed
dimension becomes a starting point rather than a single point of failure.

**0.4 · Shape and angle picker** ⚠ **placeholder**
Four shapes driving suggested angle and default size:

| Shape | Angle | Default size |
|---|---|---|
| Tall / stacked | 25–30° | 12 cm |
| Flat plated | 40° | 28 cm |
| Deep bowl | 50–60° | 18 cm |
| Wide flat | 45–55° | 35 cm |

**Every number in that table is a guess.** The categories may be wrong, the angles are
untested, and 40° is a revision of an earlier 25° that was also a guess. This ships as a
*hypothesis the fault tags will settle* — after ~30 dishes the data replaces it. Do not let
it harden into doctrine.

---

### Phase 1 — Make the foundation queryable and durable

*1–3 weeks. Everything after this depends on it.*

**1.1 · Metadata to Postgres** 🔴
`models`, `verdicts`, `faults`, `frames` as real tables. Objects stay in R2.
*Why now: the research data is worthless if it cannot be queried, and migration only gets
harder. Right now there is one dish to move.*
*Cost: $0.*

**1.2 · Job queue**
A `jobs` table, a worker loop, retries, dead-lettering, per-tenant concurrency caps.
*Why now: generation on a web thread cannot survive a deploy or a second container. Every
feature after this enqueues work.*
*Cost: $0.*

**1.3 · Generation history**
Key masters by run, not by engine. Today a re-run overwrites the previous master — judge
one "acceptable", re-run hoping for better, get worse, and the good one is gone.
*Cost: $0.*

**1.4 · Photo QC, algorithmic**
Blur, exposure, glare, colour cast, and **consistency across the four frames** — the last
being the highest-value check, since inconsistent frames bake patchiness into the texture.
Rejection messages say what to do (*"light the dish more"*), never what failed.
*Cost: $0. ~50 ms/image.*

**1.5 · Automatic colour grading**
Neutralise the illuminant, then match exposure and white balance across the set. Grade for
**accuracy, not appetite** — a warm Instagram grade bakes a yellow cast into the model
permanently, and baked shadows fight the renderer's own lighting.
Manual path gets an opt-out: *"already graded, don't touch it."*
*Cost: $0, pure arithmetic.*

**1.6 · Semantic photo checks (optional, later in phase)**
*Is this a dish? Is it fully in frame? Are these four the same dish?* Only these need a
vision model. Runs **after** the free checks, so most rejects never reach it.
*Cost: ~$0.007/dish on Haiku 4.5 — under a cent against a $0.25 generation.*

---

### Phase 2 — Library and admin panel

*2–4 weeks.*

**2.1 · Model library**
Active / inactive / draft. Filter, search, preview. A model is *active* when a menu item
points at it — state derived from the graph, not stored separately.

**2.2 · Item ↔ model attachment**
On a menu item: **Add 3D model** → library → choose → attached. Detach makes it inactive
again, without deleting it.
*Why after 2.1: nothing to attach until the library exists.*

**2.3 · Scanner inside the admin app**
The Studio UI becomes admin pages. Same engine worker behind it, now tenant-scoped and
using real accounts instead of shared basic auth.
*Why here: this is where the Studio stops being a side tool and becomes the product.*

*Cost: $0 new.*

---

### Phase 3 — Menu creation and the Astro pivot

*4–8 weeks. The largest engineering block.*

**3.1 · Astro per-tenant builds** 🔴
Today one 619 KB `index.html` carries every tenant's CSS and hardcoded `_isMugsyTenant()`
branches. **Self-serve is impossible on that** — you cannot hand-write a branch for signup
#400. Astro builds a static site per tenant at publish time.
*Why before publishing: there is nothing to publish into until tenant sites are generated,
not hand-edited.*

**3.2 · Menu builder**
Categories, items, prices, languages, ordering. Extends what the admin app already does.

**3.3 · Website editing**
Theme, hero, branding, hours, contact. Mostly exists — needs to survive the Astro move.

**3.4 · Publish pipeline**
One button: catalogue → tenant site → live menu → QR unchanged.
*Why last in this phase: it is the seam that needs 3.1–3.3 to exist.*

*Cost: $0 new. Cloudflare Pages builds are free at this scale.*

---

### Phase 4 — Self-serve

*2–4 months.*

**4.1 · Signup and tenant provisioning** — account → tenant → empty menu, no human involved.
**4.2 · Capture guidance** ⚠ needs the Phase 0/1 data before it can say anything true.
**4.3 · Billing** — Stripe. Metered on 3D views, not dishes ([COMPETITORS.md](COMPETITORS.md) §5).
**4.4 · Onboarding** — first dish live in under 30 minutes.
**4.5 · Per-dish analytics** — *"142 guests viewed this. 31 placed it on their table."*
The event data already exists; it needs surfacing per dish. Nobody else in the category
offers this at any price.

*Cost: Stripe 2.9% + $0.30. Everything else already provisioned.*

---

### Phase 5 — The engine (parallel, night work)

*Runs alongside everything. Never blocks it.*

**5.1 · Self-hosted Hunyuan3D-2.1** 🔴 **the economics**
$0.25/model → ~$0.01. At 100 tenants that is $750/mo → $30/mo.
*Trigger: ~50–80 models/month, roughly 4–5 clients. Do not wait for Phase 4.*

**5.2 · The VGGT hybrid** — 10–30 photos instead of 4. The 4-image cap is architectural, not
a product decision.
**5.3 · The dataset** — every scan is a (photos → approved model) pair. No commercially
usable plated-food 3D dataset exists to buy. This is the moat and it accrues automatically.
**5.4 · Fine-tune** — only when the eval harness says a fine-tune beats the API.

---

## Part 5 — What I would do first, and why

```
0.1  judge the optimised model      every verdict until then is on the wrong artefact
0.2  real-world scale               every model until then is the wrong size in AR
1.1  metadata to Postgres           one dish to migrate now; hundreds later
1.2  job queue                      everything after this enqueues work
```

Those four are days of work and they unblock everything. **0.1 and 0.2 in particular are
work you are otherwise going to redo** — models judged on the wrong artefact and built at
the wrong scale both have to be made again.

Phase 5.1 should start in parallel the moment a fifth client signs, because generation cost
is the only line item that scales badly, and it scales by 25×.
