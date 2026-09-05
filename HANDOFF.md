# Handoff — read this first

Written 2026-08-29, last revised 2026-09-05 (the job queue went in). Everything a fresh session needs that is
**not** already in the other docs. The other docs carry the reasoning; this one carries the
state, the environment, and the mistakes already made so they are not made again.

**Read in this order:** this file → `DECISIONS.md` §9 (what the product is, settled by
Temo) → `MENU-PLATFORM.md` (the self-serve half - read before building any of it) →
`ROADMAP.md` (older, AI-written, partly wrong - see §9.8) → `COMPETITORS.md` (only when
positioning or pricing comes up).

---

## 1. What this is

BetaReal turns real restaurant dishes into 3D models a diner sees in AR on their own table,
from a QR code, with no app. Tbilisi, five founders, **two paying clients** — Monday Greens, and Corner at Tabidze (scanned 2026-09-05). Food and Market is scheduled for 2026-09-07.

**This repo is the engine and the scanning tool.**

**BetaReal splits into two products** (settled 2026-09-05, DECISIONS §9):

- **Premium** — we scan. Pro camera, many photos, hand-graded, judged by a founder. This
  is Monday Greens, Corner at Tabidze, Food and Market. It is the path that exists today.
- **Self-serve** — the restaurant does it. Their photos, their menu, their template,
  their approval. **This is what is being built**, and it is the global-launch product.

The self-serve menu — the Astro half, where the models live — does **NOT** go next to
Niko's repo. He created `github.com/Nikoloz-Chachua/Restaurant-AR` as a temporary home on
a personal account, with the live Supabase project on a personal account too; the BetaReal
GitHub and Cloudflare accounts exist to end that dependence. New self-serve tenants only,
in parallel; replacing the existing renderer happens later, after testing. **Read
DECISIONS §9 before touching any of it, and §9.7 before touching anything of Niko's:
nothing in his repos or their production is to be modified, ever, without being asked.**

Niko's working copy at `C:\Users\temot\BetaReal scaleable` may be **read** to understand
the data model and the templates. That is all it is for.

---

## 2. Live state

| | |
|---|---|
| **Repo** | `github.com/betarealar-lab/AR-menu-Engine`, branch `main`, auto-deploys on push |
| **Scan Studio** | **https://ar-menu-engine.onrender.com** — Render free, 512 MB. Not Cloud Run: it was prepared (`deploy/cloudrun.sh`) and never deployed, because `worker.py` removed the reason to |
| **Optimiser** | **`worker.py` on Temo's PC**, installed via `deploy/install-worker.ps1`. The 512 MB host cannot open a raw master; a desktop can |
| **Storage** | Cloudflare R2, `betareal-photos` and `betareal-models`. **Meshy deletes its copy after 3 days — R2 is the only copy** |
| **Engine** | Meshy API, Pro plan. **10 concurrent tasks. 30 credits a generation** (measured, not published) |
| **Default preset** | `meshy-7` — raw master, 4k textures. `meshy-7-lean` was removed: judged in Blender and lost |
| **Users** | temo, niko, gio, davit, ilia — HTTP basic auth via `STUDIO_USERS` |

**Free tier sleeps after ~15 min idle**; first hit then takes ~50s. Normal, not broken.

```bash
curl https://ar-menu-engine.onrender.com/healthz
# ok storage=r2 optimizer=gltf-transform memory=512MB max_triangles~509,230
```

`storage=local` means the R2 vars did not load and **anything uploaded dies on the next
deploy**. `optimizer=none` means the Dockerfile was not used.

### How a dish gets finished, which is not obvious

**Everything goes through the job queue now** (`jobs.py`, wired in 2026-09-05). Pressing
Generate or Optimise writes a job to R2 and returns; it does not do the work. Both hosts
watch the same queue and each claims only what it can finish:

```
Render (512 MB)   claims  generate     -> submits to Meshy, webhook collects
Temo's PC         claims  optimise     -> a raw master needs ~830 MB
```

A claim is an atomic conditional write, so two people pressing Generate at the same
instant cannot both take the same dish, and work no longer dies with a closed tab or a
deploy. `worker.py` also **reconciles** every five minutes: work that ought to have a job
and has none gets one, which covers everything finished before the queue existed.

`worker.py` still has to be running for anything to ship — that has not changed.

```powershell
powershell -ExecutionPolicy Bypass -File deploy\install-worker.ps1 -Status
```

**If that says `running: no`, dishes will pile up un-optimised and look broken.** That
has already happened twice. While the machine is off, generating and judging still work
and masters are still archived; only the shipping files wait.

## 3. Environment

Windows. These have each cost time already:

| | |
|---|---|
| Python | **3.14** — only version installed. `pip` is not on PATH; use `python -m pip` |
| Node | **24.15.0**, npm 11.12.1 |
| Docker | **Not installed locally.** The Dockerfile is unverified locally; it builds on Render |
| `gltf-transform` | Installed globally. `shutil.which` finds it as a **`.CMD` shim**, and `subprocess` cannot exec it by bare name — always pass the resolved path (`optimize.py::_exe`) |
| Console encoding | cp1252. Non-ASCII in `print()` raises `UnicodeEncodeError`. Use `PYTHONIOENCODING=utf-8`, and keep `—`, `·`, `₾` out of anything printed |
| Subprocess output | Read as UTF-8 with `errors="replace"`, or Node's coloured output crashes the reader |
| Bash heredocs | Large ones silently truncate through the tool. For big files use Write; for patches, Python with exact-match replacement, then **verify the replacement landed** — several silently did not |
| Paths | Bash sees `/c/Users/...`; Python needs `C:\Users\...`. Passing a `/c/` path to Python fails with FileNotFoundError |
| Supabase DB | **The direct connection is IPv6-ONLY on the free plan** and this machine is IPv4, so `db.<ref>.supabase.co` does not resolve at all - which reads as a bad credential rather than an unreachable host. Use the **Session pooler** string (`postgres.<ref>@aws-N-eu-central-1.pooler.supabase.com:5432`). Affects only raw SQL tooling: both apps reach Supabase over HTTPS at `https://<ref>.supabase.co`, which is IPv4 and fine. `python preflight.py --supabase` diagnoses it in one line |

---

## 4. Credentials

**Never in chat. Never in the repo.** All in `C:\Users\temot\BetaReal-Engine\.env`, which is
gitignored — verified against the actual remote tree, not just the ignore rule.

```
MESHY_API_KEY  MESHY_WEBHOOK_SECRET  R2_ENDPOINT  R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_PHOTOS  R2_BUCKET_MODELS  STUDIO_USERS

`MESHY_WEBHOOK_SECRET` is new and is the one that changes behaviour: set it and
generation submits and returns, with Meshy calling `/hook/<secret>` when the model
is ready. Unset - a laptop, which the internet cannot reach - it falls back to
waiting through the ~175s. Register the URL at Meshy -> Settings -> API -> Webhooks
(dashboard only; there is no API for it, and five webhooks maximum per account).
```

Same seven are set in Render's dashboard. To copy them:
`Get-Content .env | Set-Clipboard` → Render → **Add from .env**.

If you need to verify a key, read the file and report it **masked**. Temo pasted a Meshy key
into chat once and had to rotate it; do not create that situation again.

---

## 5. Measurements — do not re-derive these

All measured, not estimated.

**The optimiser, on the real burrata salad master:**

```
master           99.34 MB    1,971,848 triangles    ~512 MB VRAM
opt (fallback)    5.05 MB
draco (web)       2.04 MB    48.8x smaller          4.9 seconds
textures         3 resized to 2048px, 43.37 MB -> 1.63 MB
```

**Triangle count barely matters; textures are the payload:**

```
target 40,000 -> 39,964 tris, 1.85 MB draco
target 15,000 -> 19,660 tris, 1.76 MB draco     2.6x fewer triangles = 5% smaller
```

After decimation the salad was still 47 MB, of which **45 MB was three JPEGs**. An 8192²
base colour map is ~256 MB of VRAM before anything is drawn.

**Meshy API vs Meshy web app — the earlier note here was wrong:**

```
web app        1,988,152 faces   (confirmed in Temo's UI)
API, measured  1,902,278 faces   (chicken master, 2026-08-29)
```

This file previously said the API caps output at 300,000 and that the true master was
"only reachable outside the API". It does not, and it is not. **`target_polycount` has no
effect unless `should_remesh` is true**, and the client never sent `should_remesh` — so
the 300,000 in every request was transmitted and ignored, and the API returned the raw
master all along.

That mattered: it made a dead parameter look like a working control, and nobody asked
where 1.9M triangles were coming from until a 512 MB container was killed decimating
them. `target_polycount` is no longer sent unless a caller also asks for a remesh
(`meshy-7-web` does; nothing else should without a reason).

**Us against a competitor:** Menu AR ships ~8.2 MB models (measured live: 6.12 / 8.22 / 8.23
/ 8.77 / 9.56 MB). Monday Greens ships ~1.6 MB. **We are 4–8x smaller than a competitor
serving unlimited dishes** — a demonstrable advantage nobody else in the category can claim.

**Meshy credits:** published table is Meshy 6 at 20/30 credits, "other models" at 5/15. Meshy
7 is not named. Assumed 15 textured. **Settle it by running one generation and reading
Settings → API → Daily Usage** — it was 0 as of the last check, so any number there is
attributable.

---

## 6. Bugs already found and fixed — do not reintroduce

| Bug | Fix |
|---|---|
| **Binding a control that lives inside `<template id="tpl-bench">` at parse time kills the whole page.** It sets a property on `null`, throws, and takes every line after it - `boot()` included - down with it. This has happened twice: `#export-model`, then `#multiview` | Everything inside that template goes through the delegated `click` listener. `check.py` now enforces it generally rather than by name |
| **The 3D viewer never displayed anything on the hosted Studio.** `/model` redirected to a signed R2 URL; R2 answers with the bytes and **no `Access-Control-Allow-Origin` header**, so the browser fetched the model, applied the same-origin rule and discarded it. It looked like a broken viewer. Invisible in every local test, because local disk has no signed URL to redirect to — it always streamed same-origin | `/model` streams the bytes from our own origin in 8 MB chunks. The bandwidth argument for redirecting was about diners, and diners never touch this app |
| **iOS shipped the master.** The catalogue's `model.usdz` was Meshy's own file, carried over unconverted — 74.50 MB, 1.9M triangles, 190 cm — while Android got 3.00 MB at 22 cm. Every optimisation applied to everything except the platform most diners use | Built from `model_opt.glb` with `usd-core` (`usdz.py`): 4.06 MB, 39,968 triangles, same size as the GLB. **Never convert the master** |
| **The optimiser was OOM-killed and the job vanished.** 648 MB peak against a 512 MB container. Generation had succeeded; the optimiser died, and a killed process writes no error — so the record kept `optimising` with nothing running, the in-memory `RUNNING` set had emptied on restart, and every guard then refused to start a new run *forever* | Three things, none of them "a bigger box": `limits.py` reads the cgroup ceiling and refuses an impossible job in under a second; jobs run inside their request so nothing depends on a thread outliving one; a run with no thread behind it is a ghost and is restartable. See DECISIONS.md §5 |
| **The whole page was dead on load.** `$('#export-model').onclick = ...` ran at parse time, but that button lives inside `<template id="tpl-bench">`, so it set `.onclick` on `null`, threw, and took every line after it — `boot()` included — down with it. The Studio rendered its shell and did nothing. Live in production from `eb29357` (2026-08-27) until 2026-08-29 — two days in which the Studio could not be used at all | Bound through the delegated `click` listener instead. **Anything inside that template must be delegated, never bound directly** |
| **glTF-Transform's texture stage dies on Meshy JPEGs** — `colourspace: parameter space not set` from sharp/libvips, and it takes the whole `optimize` command down | Textures resized in Pillow (`glb.py`). The JPEGs are ordinary baseline files Pillow opens fine — the bug is in the resizer. **This also means no libvips in the container** |
| `/healthz` sat behind basic auth, so the platform probe got a 401 and the deploy read unhealthy | Answers before the auth check |
| Clicking a dish always opened variant `default`, so a dish stored as `ring-25` opened an empty plate and finished work looked lost | Opens the first variant that exists |
| `triangles` parameter was accepted, written to stats, and never applied | Converted to `--simplify-ratio` against a real triangle count |
| A 24 MB camera JPEG base64s to ~32 MB; four of those is a ~130 MB request body | Browser downscales before upload; engine skips re-encode when already sized |
| Background server started with `&` inside a Bash call dies when the call returns | Use `run_in_background` |
| **`studio.py --engine` defaulted to `meshy-7-lean`, which is not in the registry.** Lean was removed on 2026-08-31 and the default that named it was not; `python studio.py` with no flag built a Studio whose fallback engine could not be constructed. It never bit because the page always sends an engine explicitly — a dead default that looked alive, exactly like `target_polycount` | Default is `meshy-7`. Found 2026-09-05 |
| **Meshy's own USDZ was archived as a master: 73 MB a dish that no code path ever read.** `master_keys` is read in exactly two places and both want `png`. It was never shippable either - built from the undecimated master, it is the file that once sent iPhones 74 MB at 190 cm. 37% of the models bucket | The master is the GLB, full stop. `engines/meshy.py` does not download it and `pipeline.store_result` refuses to archive one from ANY engine, so the next engine inherits the rule. Asserted in `check_webhook.py` |
| **model-viewer 3.4.0 does not reliably fire `load`, and a thumbnail that waits for it stays invisible forever.** Measured in Chrome on 2026-09-05 against real models: with `camera-controls` alone, `progress` reaches 1, `load` never fires and `.loaded` stays false; add `loading="eager"` and `.loaded` becomes true while `progress` stops at **0.9875** and `load` still never fires. Whichever single signal you pick, there is a configuration where it never arrives — and the poster underneath makes the result look almost right, so it would not be noticed quickly | Reveal on whichever of the three arrives first, with a bounded poll of `.loaded` as the backstop. Verified in a browser: the poll is what fires. `menu/render/viewer.mjs::reveal`. **⚠ Worth checking whether the live platform has the same latent bug** — its `_upgradeThumb` adds `thumb-model-ready` on `load` alone. Read-only observation, not ours to fix |
| **A backtick inside a `String.raw` template literal silently ends it**, and the file then fails to parse pointing at a line dozens away from the cause. Cost time three times in one session — twice in `render.mjs` prose, once in a `viewer.mjs` doc comment. An inlined script that does not parse takes the WHOLE page down, not just the 3D | `check_render.py` extracts the inlined script, runs `node --check` on it, and asserts no stray backtick survives |
| **`jobs.claim` re-listed the leases once per candidate job.** On a queue of twenty that was twenty-one R2 listings to take one job, on a loop running every few seconds on two machines. Listing is a Class A operation with 1,000,000 free a month | One listing per claim, and `stats()` down from four to three. Measured and asserted in `check_jobs.py` — the count is now a test, not a hope |

---

## 7. Corrections Temo made — do not repeat these

These are places where confident advice was wrong. They are the most useful thing in this file.

- **Monday Greens was never the ICP.** A coffee-led café with regulars who know the menu is
  close to the worst case for AR. The ~13% open-3D / ~5% AR funnel is a **floor measured in
  the weakest segment**, not a ceiling.
- **The 5-item cap is a loading constraint plus deliberate scarcity**, not a production one.
  Live 3D thumbnails spawn one WebGL context per card. `BETAREAL.md` §15 calling it
  "deliberate strategy" is a rationalisation of a technical limit.
- **The Studio does not produce sideways dishes.** That model was sideways because the photo
  input was sideways. No auto-rotation needed.
- **Scale must accept height OR width OR length** — any one. Someone may only know the height
  of a burger or the diameter of a bowl.
- **Rejection messages must be actionable and not wrong.** "Move closer to the window" is bad
  advice; "light the dish more" is the instruction.
- **Do not pre-decimate at generation.** Ask for maximum detail, decimate in our own pipeline.
- **Photo rejection and colour grading matter, but are near-future, not now.**
- **AR-orbit live capture is a separate project** with low ROI right now. Photo *rejection*
  yes; live capture guidance no.
- **Manual scanning uses many more than four photos**, on a pro camera, graded by hand. The
  automatic path is a different workflow — do not collapse them. `DECISIONS.md` §4 is now
  split into 4a (manual/pro, today) and 4b (automatic/self-serve, the product). **The angle
  spec was derived for the manual workflow** and is only a hypothesis for the automatic one —
  it has never been tested with phone photos by an untrained person.

---

## 8. How Temo works

- **Blunt, technical, and usually right about his own domain.** He has caught several real
  errors. If he pushes back, check before defending.
- **Wants the reasoning, not just the answer** — and wants uncertainty labelled as
  uncertainty. Guesses presented as findings get called out.
- **Hates re-deriving settled things.** His words: *"every time i tell u something u radically
  change... then this progress is lost."* Judgments go into files, not chat.
- **Ballpark beats perfect.** Do not re-tune something already decided.
- **Wants it free** while validating. Do not propose paid infrastructure without saying what
  it buys.
- **Working at night** on this; days are sales calls. Do not treat build work as competing
  with outreach — he is doing both.

---

## 9. Open questions

**Answered, so nobody re-derives them:**

- ~~Does `should_remesh: false` return the true ~2M master?~~ The default already does —
  no `should_remesh` at all returns 1,902,278 triangles. `target_polycount` is inert
  without it, and was being sent and ignored on every request.
- ~~What does a meshy-7 generation cost?~~ **30 credits**, measured against the live
  balance. ~33 dishes a month on the 1,000-credit Pro plan.
- ~~Is Meshy's remesh better on food than our decimation?~~ No. Judged in Blender:
  *"raw always looks better and lean is subpar."*
- ~~Does multi-view beat one photo?~~ Not on sushi, and not with other image models
  either. It adds consistency, not information. Kept as a tool, not a default.

**Still open:**

- **Which angle wins?** ⚠ The shape/angle table in `ROADMAP.md` is entirely a guess.
  The fault tags exist to replace it and nothing has been tagged yet.
- **What is the first-try approval rate, and what predicts failure?** No dish has been
  judged yet, so the whole verdict log is empty.
- **Does multi-view help on a round, symmetric dish** — a soup, a bowl? The sushi result
  is specific to arrangement, not necessarily to the technique.
- **What does the multi-view call cost?** Meshy publishes 3–12 credits for that endpoint.
  Measure it against the balance the way the 30 was measured.
- **Why did QReal leave food after ~15 restaurants** with Denny's as a client? Either the
  production economics (our thesis) or demand (fatal). Worth an hour.
- **Does the USDZ actually render on an iPhone?** Built, structurally verified, size
  matched to the GLB — never opened on the device. Nobody owns one yet.

---

## 10. Start here

**Working end to end today:** upload, generate (queued, webhook-driven), optimise
(queued, claimed by whichever host can finish it), USDZ built from the optimised GLB,
real-world scale, judge with fault tags, rename, archive, the photo shelf, downloads,
per-dish optimiser settings, queue depth and dead letters in the header, and a phone
layout.

**Run all six before pushing.** `check.py` 122, `check_webhook.py` 26,
`check_jobs.py` 46, `check_schema.py` 52, `check_publish.py` 25, `check_render.py` 75 —
346 in total, all passing as of 2026-09-05. `check_webhook.py` and
`check_jobs.py` use stubs and cost nothing; `check.py` needs a real master GLB, and there
is one at `C:\Users\temot\Desktop\BetaReal-inspect\chicken-balls-in-shqmeruli-sauce--raw-full\model.glb`.

**Next, in order:**

**1 · Photo quality checks.** Blur, exposure, glare, colour cast, and consistency across
frames. Free, algorithmic, ~50 ms an image.
*Why first: a generation costs **30 credits** and the Pro plan gives ~33 a month.
Rejecting one bad photo before it is spent is worth more than anything else on this
list, and it is the foundation of the photo system in ROADMAP Phase 2.*

**~~2 · Job queue~~ (ROADMAP 1.1) — DONE 2026-09-05.** Both hosts claim from one queue on
R2, leases replace the in-memory `RUNNING` set, Meshy's concurrent ceiling is actually
held, failures dead-letter and are visible in the header. The three non-obvious parts —
why a submitted generation keeps its lease, why a failed generation is never retried, and
why the reconciler counts dead jobs — are in DECISIONS §5.1.

**3 · Postgres** — only when the verdict log has enough in it to be worth querying.
Deliberately deferred; the queue uses R2 conditional writes and that is enough.

**4 · The self-serve menu (the Astro half) — STARTED 2026-09-05.** It lives in **this
repo**. **Read [MENU-PLATFORM.md](MENU-PLATFORM.md) and DECISIONS §9 before writing a line
of it.** The one decision everything else hangs off: a diner request never touches the
database. Publishing compiles the menu to an immutable snapshot on R2, and the Worker
renders complete HTML from that at the edge — never a shell that re-skins itself.

Done so far — skeleton step 1 of MENU-PLATFORM §6:

- **Supabase project on the BetaReal account** (`fxtsluuoddsmcugizere`, Frankfurt).
  Automatic RLS on, "expose new tables" off, Data API on.
- **`0001_skeleton`** — tenants, tenant_members, super_admins, templates, models,
  categories, items, publications, live_publication. RLS enabled *and forced* on all of
  them. No billing column anywhere, per DECISIONS §9.3.
- **`0002_grants`** — `anon` is granted nothing, anywhere. Written because
  `check_schema.py` failed on first run with every policy correct and every query denied:
  a GRANT says whether a role may touch a table at all, a POLICY says which rows, and
  they are not the same mechanism.
- **`check_schema.py`** proves it rather than asserting it: two throwaway users, two
  restaurants, then read and write across the boundary. The cross-tenant write is
  verified to fail with *"new row violates row-level security policy"* specifically —
  Postgres raises the same SQLSTATE for a missing grant, so catching the exception alone
  would pass on a schema where tenancy did nothing.

- **Step 3 is done and the architecture is proven.** `menu/publish.py` compiles a
  tenant's draft into an immutable JSON object on R2 (`t/<tenant>/<version>.json`, never
  overwritten); `menu/render/render.mjs` turns that into a complete HTML page with the
  theme inlined in `<head>`; `menu/preview.py` is the Worker standing in on a laptop.
  Verified end to end against the real buckets: **7 items, 4 with real 3D, 3.2 KB of
  snapshot, 6.7 KB of HTML, and a genuine 5.9 MB Draco model served over the asset
  route** with the right content type and CORS.

**Try it:**

```bash
python menu/seed.py --demo
python menu/publish.py --tenant demo-kitchen
python menu/preview.py            # http://127.0.0.1:8790/demo-kitchen
```

**Two things found by looking at real output, not by testing:**

- `data-cm` was emitted without its axis. The live records use `height` as often as
  `width`, so a bare "4" is a 4 cm plate or a 4 cm tall stack depending on which — and
  guessing wrong puts a dish on a table at the wrong size in a way that reads as a bad
  model. Fixed, and `check_render.py` now asserts the axis travels with the number.
- **A dish is mislabelled in the live Studio data, and it is Temo's to fix, not ours.**
  `chicken-balls-in-shqmeruli-sauce / lean` carries `title = "SUSHI WITH STONE PLATE"`.
  Since `title_of` is dish-level, the chicken dish displays under the sushi name. Almost
  certainly a rename applied while the wrong dish was selected.

- **3D and AR are the PLATFORM'S OWN CODE, ported verbatim.** An earlier attempt
  reimplemented the viewer from reading their source. It did not work, and Temo's
  correction was right: *"why not just copy the existing systems."* A rewrite of something
  that already works on real phones in real restaurants is a downgrade however clean it
  looks.

  `menu/render/ported/` now holds `xr.js` (the Three.js WebXR carousel, ~870 lines),
  `viewer.js` (the 3D modal, the poster→live-thumbnail upgrade, AR routing, iOS Quick
  Look), and their CSS and markup — **byte for byte, unedited.** `check_render.py` asserts
  the files appear in the page verbatim, because a drifted port looks exactly like an
  intact one until an upstream fix silently fails to arrive.

  **`ported/shim.js` is the only adapter**, and the only file to edit. It supplies the
  fourteen symbols that code expects from the app it was lifted out of: `menuItems` (built
  from the page's own cards), `_themeConfig`, `t()`, `_setPriceWithOld`, `track`, `idle`,
  and stubs for the basket and the photo lightbox, which the self-serve menu does not have
  yet.

  **The trap that cost the most, and will again.** `viewer.js` binds its listeners at top
  level. A missing element is `null.addEventListener`, which aborts the REST of the block
  and leaves every `let` after it in the temporal dead zone. The symptom points nowhere
  useful: `openModal` exists (function declarations hoist) but throws *"Cannot access
  '_mvPromise' before initialization"*. Three separate crashes hid behind that one
  message. If the port ever half-works, **read the console for the FIRST error, not the
  one your call produced.**

  **One production workaround deliberately not carried over.** Their AR launcher bakes an
  `ar_scale` in and swaps a y-offset-corrected blob so Quick Look seats the dish on the
  table rather than through it. That exists because their files are not sized. Ours are —
  `optimize.py` bakes real-world scale into the GLB and `usdz.py` builds the USDZ from the
  *optimised* one — so `shim.js` reports `ar_scale: 1` and the file handed to Quick Look
  is already correct.

**A hard caveat on testing this.** `IntersectionObserver` does not report intersections
in a **hidden** browser tab, and **model-viewer does not decode a model in one either** —
both measured. So neither the poster→3D upgrade nor the modal actually rendering can be
validated from an automated browser that is not in the foreground. That is correct
behaviour, not a bug: nobody should download models for a tab nobody is looking at. But it
means **a person has to open the preview and look.**

What automation DID verify, in a real Chrome against the real page: no JavaScript errors,
`menuItems` built (7 items, 4 with 3D), `window.XR` present, `openModal` runs clean and
sets the modal title, the formatted price and the model `src`, model-viewer 3.4.0 loaded
with a canvas in its shadow root, and the AR button labelled. Everything up to the point
where a hidden tab stops painting.

Next: **step 4** — photo upload in the admin app enqueueing a `generate` job into the same
queue the Scan Studio uses, and the owner's approve/reject landing in `models.tenant_state`.
That closes the loop from a phone photo to a diner's table.

**Not a phase:** hosting. It is a slider — 512 MB refuses raw masters, 2 GiB accepts
them. Choose it, do not build it.

**About "thirty dishes shot four ways":** ROADMAP Part 5 calls this the highest-value
action. Temo has corrected that (2026-09-05) — real dishes come from real venues on real
scanning days, he shoots and judges them, and he will say when he wants help. It is not
this codebase's call and not a reason to stall. **The system gets built first.**

## 11. Repo map

```
studio.py          the web app: upload, judge, library, photos. It ENQUEUES work
                   and claims back whatever this host can finish
web/studio.html    its UI. One file. Desktop shell + phone layout below 760px
jobs.py            the queue. One object per job on R2; a conditional write IS the
                   lock. Leases, retries, dead letters, Meshy's ceiling
pipeline.py        what a job DOES - generate, collect, optimise. No web server and
                   no worker loop around it, so both hosts run the same code
worker.py          claims what a 512 MB host cannot, and reconciles work that has
                   no job. The thing that has to be running for anything to ship
engines/base.py    Engine interface. start/collect is the async pair; generate waits
engines/meshy.py   generation. 30 credits, 10 concurrent, output expires in 3 days
engines/images.py  multi-view: three predicted angles from one photo
optimize.py        master -> opt + draco + usdz. Shells to glTF-Transform (Node)
glb.py             GLB surgery in pure Python: textures, triangles, bounds, placement
usdz.py            optimised GLB -> USDZ with usd-core. NEVER converts the master
limits.py          what this container may use, and refusing jobs that will not fit
dataset.py         dishes, variants, frames, verdicts, tickets. Keys and records
storage.py         R2 or local disk behind one interface
config.py          .env loading
check.py           122 checks over a real server on a temp store. Never touches R2
check_webhook.py   26 checks of the submit/callback path with a stub engine, no credits
check_jobs.py      46 checks of the queue, including eight threads racing one claim
                   and what an idle poll costs in R2 listings. Free, no server
check_schema.py    52 checks of the menu platform's tenancy against the REAL
                   Supabase project. Makes two restaurants and tries to read one
                   as the other. Free; cleans up after itself
check_publish.py   25 checks of the publish path on a throwaway tenant: hidden
                   items absent, unapproved models unattached, snapshots immutable
check_render.py    64 checks of the rendered HTML: XSS and CSS injection from a
                   restaurant's own typing, the no-flash properties, `node --check`
                   on every inlined script, and that the ported viewer is present
                   BYTE FOR BYTE. Needs node
menu/render/ported/     the platform's 3D + AR code, VERBATIM. Do not edit
                   xr.js / viewer.js   theirs, unmodified
                   viewer.css / .html  theirs, unmodified
                   shim.js             the ONLY adapter - ours
menu/render/build_ported.py  turns those into ported.mjs. Re-run after any change
menu/render/extract_css.py      re-pulls their CSS as whole rules: viewer, menu,
                   and one file per template. Never line ranges - see MENU-PLATFORM 8.3
menu/render/extract_presets.py  re-pulls the 22 theme presets into presets.json
menu/render/theme.mjs           preset + tenant overrides -> CSS custom properties,
                   using the platform's own varMap. A template is a PALETTE
menu/              the self-serve half. See MENU-PLATFORM.md before touching it
menu/migrations/   numbered SQL, applied once each, checksummed
menu/migrate.py    applies them. --status, --dry-run
menu/publish.py    draft in Postgres -> immutable snapshot on R2. --list, --dry-run
menu/seed.py       a demo tenant built from the REAL dishes in R2
menu/render/       render.mjs: snapshot -> a complete page. Pure, no imports. The
                   admin preview and the live page both call THIS, never a copy
menu/preview.py    the Worker, on a laptop. Serves /<slug> and /a/<key> from R2
pull.py            pull a dish's files to a folder and compare them, for Blender
preflight.py       verify key + R2 round-trip before spending anything
runner.py          batch re-run the dataset against another engine
deploy/            install-worker.ps1 (the one that matters), cloudrun.sh, env yaml
Dockerfile         Python + Node, for the optimise stage
```

Elsewhere on the machine:

```
C:\Users\temot\BetaReal scaleable\           the menu platform (Niko's repo)
C:\Users\temot\Desktop\BetaReal-inspect\    models pulled for Blender
C:\Users\temot\MondayGreens\models\         5 finished client dishes, the quality bar
C:\Users\temot\BetaReal-Prospecting\         sales pipeline, registry DB, docs
```
