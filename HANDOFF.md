# Handoff — read this first

Written 2026-08-29, at the end of a long session. Everything a fresh session needs that is
**not** already in the other docs. The other docs carry the reasoning; this one carries the
state, the environment, and the mistakes already made so they are not made again.

**Read in this order:** this file → `ROADMAP.md` (what to build, in order) → `DECISIONS.md`
(why the engine and capture work the way they do) → `COMPETITORS.md` (only when positioning
or pricing comes up).

---

## 1. What this is

BetaReal turns real restaurant dishes into 3D models a diner sees in AR on their own table,
from a QR code, with no app. Tbilisi, five founders, one paying client.

**This repo is the engine and the scanning tool.** The customer-facing menu platform is a
different repo — `github.com/Nikoloz-Chachua/Restaurant-AR`, working copy at
`C:\Users\temot\BetaReal scaleable`. The two are not yet connected; joining them is Phase 3.

---

## 2. Live state

| | |
|---|---|
| **Repo** | `github.com/betarealar-lab/AR-menu-Engine`, branch `main`, auto-deploys on push |
| **Scan Studio** | **Cloud Run**, 2 GiB, scales to zero. Deploy: `bash deploy/cloudrun.sh` |
| ~~Render~~ | `https://ar-menu-engine.onrender.com` — 512 MB, OOM-killed by the first real dish. Kept only until Cloud Run is verified |
| **Storage** | Cloudflare R2, buckets `betareal-photos` and `betareal-models` |
| **Engine** | Meshy API, Pro plan, ~1,200 credits shared across the team |
| **Users** | temo, niko, gio, davit, ilia — HTTP basic auth via `STUDIO_USERS` |

**Free tier sleeps after ~15 min idle**; first hit then takes ~50s. Normal, not broken.

Health check needs no credentials:

```bash
curl https://ar-menu-engine.onrender.com/healthz
# ok storage=r2 optimizer=gltf-transform
```

If that says `storage=local` the R2 env vars did not load and **anything uploaded dies on
the next deploy**. If it says `optimizer=none` the Dockerfile was not used.

**Real data exists:** one dish, `chicken balls in shqmeruli sauce`, one frame, uploaded by
temo. Not test data — do not delete it.

---

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

---

## 4. Credentials

**Never in chat. Never in the repo.** All in `C:\Users\temot\BetaReal-Engine\.env`, which is
gitignored — verified against the actual remote tree, not just the ignore rule.

```
MESHY_API_KEY  R2_ENDPOINT  R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY
R2_BUCKET_PHOTOS  R2_BUCKET_MODELS  STUDIO_USERS
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

- ~~Does `should_remesh: false` return the true ~2M master?~~ **Answered 2026-08-29:**
  the default already does — no `should_remesh` at all returns 1,902,278 triangles.
  The open question is now the reverse: is Meshy's remesh to 300k *better* on food
  than our decimation from 1.9M? One generation on `meshy-7-web` against the same
  dish would show it.
- What does meshy-7 multi-image actually cost? Read Daily Usage after one call.
- **Which angle wins?** ⚠ The shape/angle table in `ROADMAP.md` is entirely a guess,
  including a 40° that revises an earlier 25° guess. The fault tags exist to replace it.
- What is the first-try approval rate, and what predicts failure? Nothing has been judged yet.
- **Why did QReal leave food after ~15 restaurants** with Denny's as a client? Either the
  production economics (our thesis) or demand (fatal). Worth an hour.

---

## 10. Start here

**Phase 0.1 and 0.2 are done** (2026-08-29). Generation optimises automatically, review
loads the shipping file with a `Master` toggle beside it, and one real-world dimension is
baked into that file.

**The host moved to Cloud Run the same night**, because Render's 512 MB could not run the
optimiser on a real master and failed silently when it tried. `DECISIONS.md` §5 carries
the measurements and the three rules that came out of it. To deploy:

```bash
gcloud auth login                    # interactive, do this yourself
gcloud config set project <id>
python deploy/make_env_yaml.py       # .env -> deploy/env.yaml, gitignored
bash deploy/cloudrun.sh
```

Next, from `ROADMAP.md`:

**1.1 — Metadata to Postgres.** `models`, `verdicts`, `faults`, `frames` as real tables.
The verdict log is the research asset and today it cannot be queried at all. One dish to
migrate.

**1.2 — The job queue.** Now load-bearing rather than tidy: work runs inside its request,
which is correct but cannot survive a closed tab, and `--max-instances 1` is holding the
system together. The queue lifts both.

Both cost $0. Still open and cheap: **the Meshy API ignores `target_polycount`** — we
send 300,000 and the master came back with 1,902,278 triangles. `should_remesh: true`
probably explains it, and one generation would settle it along with what meshy-7 really
costs (Settings → API → Daily Usage).

## 11. Repo map

```
studio.py          the web app: upload, generate, judge, optimise, library
web/studio.html    its UI. Responsive; drawer under 900px
engines/           Engine interface + Meshy. Registry is the swap point
optimize.py        master -> opt + draco. Shells to glTF-Transform (Node)
glb.py             GLB surgery in pure Python: texture resize, triangle count
dataset.py         dishes, variants, frames, verdicts. Keys and records
storage.py         R2 or local disk behind one interface
config.py          .env loading
preflight.py       verify key + R2 round-trip before spending anything
runner.py          batch re-run the dataset against another engine
Dockerfile         Python + Node, for the optimise stage
category-map.html  source of the published competitive matrix artifact
```

Elsewhere on the machine:

```
C:\Users\temot\BetaReal scaleable\           the menu platform (Niko's repo)
  scripts\optimize-model.mjs                 the hand-built optimiser this one automates
C:\Users\temot\Desktop\Meshy models\         the 99.3 MB burrata salad master
C:\Users\temot\MondayGreens\models\          5 finished client dishes, Draco + USDZ
C:\Users\temot\BetaReal-Prospecting\         sales pipeline, registry DB, docs
```
