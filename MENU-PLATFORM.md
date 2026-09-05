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

### 2.2 · One Astro app. Templates are a registry, not per-tenant branches

Today the customer app is a single ~619 KB `index.html` with fourteen hardcoded
`data-template="..."` branches, and adding a restaurant's look means a developer editing
that file and shipping a deploy. That does not break at signup #400. **It breaks at
template #16**, and it already means a template cannot be added without us.

So: **one app, deployed once. A template is a component plus a preset row in the
database.** Adding one touches no tenant. Choosing one is a column.

Temo asked for "easy ability to add custom templates to the catalog" — that is exactly
this, and it is only possible if templates are data.

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

Storage is measured per dish (`DECISIONS.md` §5, `HANDOFF.md` §5). Tenant and traffic
counts are **projections**, marked as such. R2 storage is $0.015/GB-month with zero egress.

At **400 tenants × 30 dishes = 12,000 dishes** (projection):

| | per dish | at 12,000 dishes | cost/month |
|---|---|---|---|
| Catalogue — what diners load | ~5 MB (measured: 1.6–3.1 draco + 3.1–4.1 usdz) | 60 GB | **$0.90** |
| Masters — regenerable, cold | ~85 MB (measured: 73–99 MB) | 1.0 TB | **$15** |
| Photos — irreplaceable, cold | ~100 MB | 1.2 TB | **$18** |
| Menu data in Postgres | — | ~40,000 rows | **$0** |
| Diner egress | — | ~500 GB/month | **$0** (R2) |

**~$35–50 a month at 400 tenants.** Against ₾300/month per tenant, infrastructure is not
the constraint and never becomes one. Say this plainly whenever someone proposes buying
scale: the scaling problem here is *sales*, and the engineering job is only to not build
something that falls over.

The one number that does need watching is **R2 Class A operations** (listings, writes),
1,000,000 free a month. The job queue's share is measured and asserted in `check_jobs.py`
at ~400,000/month across both hosts. A publish is a handful of writes. Neither is close,
but neither should be allowed to grow carelessly either.

**What is NOT projected, because it would be a guess:** conversion, sessions per tenant,
and how many dishes a self-serve restaurant actually models. The only funnel we have
(74% past hero, ~13% open 3D, ~5% AR) is one coffee-led café that Temo has correctly said
was never the ICP. Do not build a capacity plan on it.

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
read without a database in the path, everything after it is filling in. If it cannot, we
find out in week one rather than at tenant #200.
