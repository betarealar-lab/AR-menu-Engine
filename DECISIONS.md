# BetaReal Engine — decisions and findings

Founding record for the scanning platform. Written 2026-08-26.
Decisions, not conversation. If a decision changes, edit the entry and note why.

---

## 1. Strategy

**BetaReal is not in the model business. It is in the workflow business.**

Tencent, Microsoft, Meshy and Tripo are commoditising image-to-3D in public. What is not
being commoditised: the capture protocol, a food-specific eval set, the
(photos → approved model) pair library, and distribution into restaurants.

**Therefore the AI is an upgrade path, not a gate.** Do not make the global launch or the
fundraise conditional on solving image-to-3D. Ship on a rented engine, own the data, swap
the engine when ours wins. Everything goes through an engine registry so that swap is one
string, not a rewrite.

**Two businesses, one codebase.** Human-serve in Georgia at ₾300/mo funds and feeds
self-serve globally at a much lower price point. They are not the same business — different
CAC, churn, support load and product. Keep the P&Ls separate so the ₾300 anchor never leaks
into global pricing.

---

## 2. Engine

**Two model families, not interchangeable:**

| | Input | Geometry from |
|---|---|---|
| **Generative** — Meshy, Tripo, Hunyuan3D, TRELLIS | 1–4 views | Invented from learned priors |
| **Reconstructive feed-forward** — VGGT, MASt3R, Fast3R | 1 → hundreds of unposed views | Measured. Beats COLMAP on completeness in 87% of cases |

Both are neural networks. Reconstructive is *not* classical photogrammetry.

For a menu the difference is a product argument, not a quality one: **a 4-view generative
model shows the diner *a* burger when the whole promise is that it is *their* burger.**

**The 4-image cap is architectural.** Hunyuan3D-2mv is trained on canonical
front/back/left/right slots with view-specific conditioning; Meshy is the same. You cannot
feed it 10. The way around is the hybrid:

```
10–30 photos → VGGT → mesh + cleanup → Hunyuan3D-2.1 paint → GLB + USDZ
                                        ↑ the fine-tune goes here
```

Food is hard on the *surface* — specular sauce, translucency, crumb — not the silhouette,
so the texture stage is where food-specific data pays.

**Meshing and cleanup is automated** (TSDF → marching cubes → decimate → UV unwrap → bake),
not manual. Expect a human review gate for the first ~50 dishes to learn the failure modes.
If it is still manual at dish 200, the pipeline has failed.

### Cost — the number that decides gross margin

| Engine | Per model |
|---|---|
| Meshy | $0.25–0.40 |
| WaveSpeed (Hunyuan 2.1) | $0.40 |
| fal.ai (Hunyuan 2.1) | $0.05 |
| **Self-hosted Hunyuan 2.1** | **$0.009–0.015** (RTX 4090, ~139s median) |

**Decision: Meshy to learn on, self-hosted Hunyuan to scale on.** Crossover ~50–80
models/month ≈ 4–5 clients. At €29/mo with unlimited scanning, Meshy's price makes the tier
unviable and self-hosting makes it rounding error.

### Meshy specifics (verified on Pro, 2026-08-26)

- API credits come from the **same pool** as the web app. 1,000 monthly + 200 permanent;
  monthly resets on the billing date.
- `POST https://api.meshy.ai/openapi/v1/multi-image-to-3d`, models `meshy-5/6/7/latest`.
- **Returns USDZ as well as GLB** — the separate USDZ conversion step disappears.
- **`target_polycount` is inert without `should_remesh: true`.** Measured: a request for
  300,000 returned 1,902,278 triangles. The raw master *is* what the API gives by default,
  so "ask for maximum detail and decimate ourselves" is already what happens — but it was
  happening by accident, while the request body claimed otherwise.
- **On meshy-7, image 1 is the primary front view.** Image order is semantic; the capture
  guide must preserve it end to end.
- Published cost table names only "Meshy 6" (20/30) and "other models" (5/15). It does not
  name Meshy 7. Newer being cheaper is normal — Meshy 6 is the priced-high legacy outlier in
  every row — but confirm by reading Settings → API → Daily Usage after one real call.

### What the first real lean generation actually cost, and showed

Run on the live server, 2026-08-30, `meshy-7-lean`, one photo:

| | |
|---|---|
| submit returned in | **2.15 s** (was 175 s) |
| finished in | 165 s, progress reported 45% -> 99% |
| **credits** | **30** — settles a question open since day one |
| master | 20.8 MB · 156,397 triangles · 3 x 2048px |
| ships as | 5.67 MB draco · 61,391 tris · 8.46 MB usdz |

**30 credits, not 15.** meshy-7 multi-image with texture bills at the "30 with texture"
rate. That is ~33 dishes a month on the 1,000-credit Pro plan, which is a much harder
ceiling than the money: at 30 restaurants x 7 dishes = 210 dishes/month, the plan needs
to be six times bigger. The cost per dish is trivial (~$0.60); the **monthly credit
allowance** is the real constraint on how fast onboarding can go.

**Lean is not free.** Honest comparison of the same dish:

| | raw master | lean master |
|---|---|---|
| optimiser peak | 648 MB — needs a paid host | **236 MB — fits the free one** |
| ships as | **3.00 MB · 39,968 tris** | 5.67 MB · 61,391 tris |

Two reasons lean ships heavier. meshopt cannot simplify a 156k mesh as far as a 1.9M one
inside the same error budget - it stops at 61k, not 40k - because an already-decimated
mesh has no redundancy left to spend. And downsampling 4096px to 2048px smooths detail,
so it compresses better than re-encoding a 2048px map that was never resampled.

So the choice is explicit: **free hosting and a 5.67 MB model, or a paid host and a
3.00 MB one.** For reference, a competitor ships 8.2 MB and the hand-built MondayGreens
models ship 1.1-2.2 MB. Lean is worse than our best and better than the field.

**And one bug this exposed.** The texture pass only ever checked resolution. Meshy
returned a 2048px normal map as a **7.85 MB lossless PNG**, which passed the "already
2048" test untouched and shipped a 14 MB model. Textures now have a byte budget as well
as a pixel one, and are re-encoded to JPEG when they exceed it and carry no alpha:
14.08 MB -> 5.67 MB. Pixels decide GPU memory; bytes decide download size; they are not
the same problem and one check cannot cover both.

---

### Meshy keeps nothing: 3 days, then it is gone

**API output is retained for 3 days on Pro and Studio plans.** After that the task and
every download URL are deleted; only Enterprise gets permanent links. Every task response
carries an `expires_at` timestamp saying exactly when.

Three consequences, all load-bearing:

**R2 is not a convenience, it is the only copy.** Seventy-two hours after a generation,
our stored master is the sole surviving artefact. That is why the pipeline downloads and
stores immediately rather than keeping a reference.

**An uncollected generation is money burned.** If a webhook is never delivered and nobody
notices for three days, the credits are spent and the model is unrecoverable - the photos
survive, but it has to be generated again and paid for again. This is the strongest
argument for the safety net that re-checks a quiet task, and later for a real job queue
with dead-lettering: the cost of a silently dropped job is not a delay, it is cash.

**A 404 from the task endpoint means expired, not broken.** It is reported as such,
because "generate it again" and "retry the download" are different instructions and only
one of them works.

---

### Multi-view generates plausible photographs, not useful ones

Tested on sushi, 2026-09-02: the predicted angles were poor, and the model built from
them came out practically the same as the model from one photograph. Temo ran the same
experiment through other image models and got the same answer. His verdict: *"1 image
looks better"*.

That matches the mechanism rather than contradicting it. Generated views add
**consistency, not information** - with one photo the 3D engine already invents the back
of the dish, and multi-view only invents it earlier, as pictures. Nothing new about the
real dish enters the system either way. Sushi is close to the worst case: asymmetric,
per-piece detail, and a back that is genuinely unknowable from the front.

**Kept as a tool, not a default.** It costs credits, it is offered only when a dish has
exactly one photo, and the button says what it is. Worth retrying on a round symmetric
dish - a soup, a bowl - before ruling it out entirely, because the failure mode above is
specific to arrangement, not to the technique.

The real answer remains four photographs. They carry information; predictions carry
plausibility, and the pipeline cannot tell the difference.

---

### Reversed: lean lost, and raw is the default again

Temo compared the two in Blender on 2026-09-02 and the verdict was short - *"raw always
looks better and lean is subpar"*. The remesh preset is removed.

It was never a quality decision. It existed because a 512 MB host cannot open a raw
master, and `worker.py` removed that constraint by optimising on a desktop against the
same R2. A workaround that costs quality and is no longer needed is just a worse default.

What survives from the exercise: the measurements, the memory model they produced, and
the knowledge that Meshy honours a remesh request closely if it is ever needed again.

---

### Ask the engine for what we ship, not for the most it can make

Reversal of "do not pre-decimate at generation, ask for maximum detail and decimate
ourselves". That rule was right about **why** - Meshy's decimator is a black box and food
loses thin detail first - and wrong about the cost, which it assumed was zero.

Measured on the same dish, both ways:

| | master in | node peak | ships as |
|---|---|---|---|
| raw (1.9M tris, 4k textures) | 69.6 MB | **648 MB** | 3.00 MB draco · 39,968 tris |
| lean (150k tris, 2k textures) | 7.8 MB | **193 MB** | 3.00 MB draco · 39,992 tris |

**The shipped file is identical.** The difference is entirely in what it costs to produce
it - and 648 MB against 193 MB is the difference between needing a paid host and running
free. We were downloading 70 MB, spending 648 MB of memory on it, and discarding 97%.

Two things preserve the original reasoning. **150k is still 3.75x what we ship**, so our
own decimator does the final and largest reduction, which is the cut the rule was really
about. And **`meshy-7` stays in the registry as the raw-master control** - the same dish
can be run both ways and judged in the Shipping/Master toggle. If Meshy's first cut turns
out to lose garnish ours would have kept, this reverses back, with evidence.

`texture_resolution: "2k"` is not a compromise at all: the optimiser downscales to 2048px
regardless, so asking for 4k was paying transfer and memory for pixels we always deleted.

What is genuinely given up: we no longer keep a 1.9M-triangle master. Regenerating one
from the stored photos costs credits and, because the engine is generative, returns a
similar model rather than the same one. The photos remain the archive - they are what
cannot be recreated.

---

### After the engine: the optimiser, and real-world scale

Generation runs the optimiser automatically, and the review screen loads its **output**,
not the master. The earlier call was the reverse — optimise only what gets approved, so a
rejected dish costs nothing but the look. That was wrong on both halves: the work is five
seconds of CPU and zero credits, and the master is the wrong thing to judge. It is ~216 MB
of VRAM against ~52 MB, which is the difference between a page a mid-range Android survives
and one it drops, and a master can look perfect while the optimiser has quietly eaten the
garnish. The master stays one click away for when a verdict is contested — the only honest
way to separate "the engine got it wrong" from "the optimiser did".

**The USDZ is built, not borrowed.** Quick Look is the only AR path on iPhone and reads
nothing but USDZ. The pipeline used to carry Meshy's own USDZ into the catalogue, on the
grounds that Linux has no reliable converter — so every gain from decimation, texture
resizing and real-world scale applied to Android and web and to nothing on iOS. Measured
on the first real dish: 3.00 MB / 39,968 triangles / 22 cm on Android against **74.50 MB
/ 1,902,278 triangles / 190 cm on iPhone**, the master byte for byte. It is now built
from `model_opt.glb` with `usd-core`, a pip wheel that needs no system tooling:
**4.06 MB, 39,968 triangles, identical size to the GLB.** The hand-built MondayGreens
models ship 4.9–7.9 MB, so this is finally the same standard.

**One dimension in centimetres is enough.** The model supplies the aspect ratio for the
other two, so asking for all three is asking for two numbers nobody has. Which one a person
knows varies — the height of a burger, the diameter of a bowl — so height, width and length
are all offered and any one is accepted. `width` means the **widest horizontal span**,
which is what a person means by the width of a plate, what `optimize-model.mjs --size`
already means in `BetaReal scaleable`, and what the `-30cm` folder names encode. The Studio
and the hand-run script agree by construction.

Placement happens **before Draco, by wrapping the scene in one node**, never by rewriting
vertices. Draco quantises positions in local space, so baking a 0.15x scale into the
vertices first throws away precision it needs. Measured on the burrata salad: 104 MB master
→ 1.85 MB Draco at exactly 28.0 cm across, seated on y=0, 6 seconds.

What is deliberately **not** done: auto-rotation. The .mjs script guesses upright from the
thinnest axis because its inputs arrived sideways. A sideways model here came from a
sideways photo, and guessing would break the models that are already correct.

---

## 3. Dataset licensing ⚠️

**MetaFood3D is CC BY-NC 4.0.** Non-commercial, *and derivative works are non-commercial
too* — a model fine-tuned on it is poisoned for a company that intends to sell and raise.
**Never let it touch the training pipeline, not even for pretraining.**

**Objaverse-XL is ODC-By** (commercial use permitted as a whole) but per-object licenses
vary. Filter to CC0/CC-BY and keep the provenance manifest — that manifest is also the
diligence answer later.

**The upside:** no commercially usable, photorealistic, plated-restaurant-food 3D dataset
exists anywhere. That is the moat. It cannot be bought, only built one restaurant at a time
by someone with distribution into restaurants.

---

## 4. Capture

**Two different workflows. Do not collapse them.** They share a target — usable frames of a
dish — and share almost nothing else.

### 4a. Manual / pro (internal, today)

Professional camera → colour grade by hand → export JPG → **then** KIRI photogrammetry.
Many more than four photos. This is how Monday Greens' five dishes were made and it is the
quality bar.

KIRI is not the capture device, and **Meshy bypasses KIRI entirely** — it takes the graded
JPGs directly, which makes the AI path strictly shorter than the photogrammetry one.

Because it is a manual shoot, **file order carries no geometric meaning** and no heuristic
can pick the canonical four. Frame selection is manual in the Studio, by design.

### 4b. Automatic / self-serve (the product)

A phone, a handful of photos, **no human grading and no KIRI**. Everything the pro workflow
does by skill, the tool has to do by software:

| Pro does by hand | Automatic must do in code |
|---|---|
| Grades each frame, consistently | Neutralise illuminant + match exposure across the set |
| Knows which angles work | Shape picker → suggested angle |
| Discards bad frames by eye | Algorithmic reject: blur, exposure, glare, inconsistency |
| Shoots 20+ and picks | Works from 1–4, so each frame matters more |

**The angle spec below was derived for 4a and is being carried into 4b as a hypothesis.**
It has never been tested with phone photos by an untrained person. That test is the point of
the fault tags.

### The angle spec

These models are trained on renders of 3D assets — fixed radius, fixed elevation, evenly
spaced azimuths, plain background, even lighting. Every departure costs quality.

| | |
|---|---|
| Azimuth | 0° / 90° / 180° / 270°, evenly spaced |
| Elevation | ~25°, **identical in all four**. Consistency beats the exact value |
| Distance | Same framing, dish filling 70–80%, centred |
| Grade | **One grade, copied to all four** |
| Background | Plain, identical across frames |
| Front | Most identifiable silhouette + most visible content |

⚠️ **Per-image grading is a trap.** Individually graded frames feed inconsistent colour to
the texture stage and bake patchiness into the material. Grade one, copy to the other three.

**Elevation is unresolved.** The model wants low; food wants high. Below ~10° loses the
plate contents; above ~45° the silhouette collapses and dishes come out flat. 25° is a
starting bet, not a finding — settle it with the variant test below.

### The experiment (zero reshoot, ~450 credits)

Three variants per dish, built from angles we already own:

- `ring-25` — 4 frames at ~25°, 90° apart
- `ring-45` — 4 frames at ~45°, the existing hero angles — the control
- `three-plus-top` — 3 side frames at ~25° + 1 top-down

Then `bg-removed` once a ring wins.

**The metric is not mesh error. It is: would the owner approve this on the first try?**
That rate sets cost per dish → price → whether self-serve works at all.

Glare, honestly: generative models are glare-immune because they don't look; reconstruction
is glare-sensitive because it does. The hybrid inherits that in the geometry stage.
Mitigations are capture-time (diffuse light, no flash, away from windows), VGGT being more
robust than COLMAP, and the texture stage repainting over specular artefacts.

---

## 5. Architecture

**Scale-for-millions is not a phase.** It is a handful of decisions that must not be
foreclosed, plus a large number of things not to build until traffic exists.

Where the product actually sits:

| Layer | Status |
|---|---|
| Menu delivery to diners | ✅ Solved — static HTML on Cloudflare CDN |
| 3D model delivery | ✅ Solved — R2, zero egress |
| Postgres (tenants, menus) | ✅ Fine at this scale |
| `events` table | ⚠️ Unbounded growth — needs retention/rollup |
| **Generation pipeline** | 🔴 The real hard problem — minute-long GPU jobs, bursty |
| **Raw photo retention** | 🔴 The real cost problem |

> **The data we must keep for the AI moat is ~100× the data the product needs to serve.**
> Serving a dish needs a 2 MB GLB. Training on it later needs 20–30 source photos ≈ 100 MB.
> At 15,000 dishes that is ~1.5 TB of photos against ~30 GB of models.

### Where the worker runs, and why 512 MB was never going to work

**Sized by memory, not by CPU.** The Scan Studio ran on Render's free tier until
2026-08-29, when the first real dish killed it. Generation succeeded; the optimiser then
asked for more memory than the container had, the instance was OOM-killed, and because a
killed process cannot write anything the job left no error and no log — just a spinner
that ran for twenty minutes. Measured peak RSS of the geometry pass:

| Input | glTF-Transform | gltfpack |
|---|---|---|
| 1,902,278 triangles (69.6 MB master) | **648.5 MB** | **521.6 MB** |
| 300,538 triangles (26.0 MB) | 357.3 MB | — |

Against a 512 MB container. **No toolchain choice fixes that** — both hold the mesh in
Node Buffers and meshoptimizer's WASM heap, which a `--max-old-space-size` cap does not
touch. CPU was never the constraint: the whole pipeline is ~2.5s of real work.

**So: Cloud Run, 2 GiB, scale to zero.** The container already existed, it costs nothing
idle, and 2 GiB fits masters up to ~8.7M triangles. Render stays only as the thing that
proved the rule.

**Three rules carried out of it, which matter more than the host:**

1. **A process must know its own limits.** `limits.py` reads the container's memory
   ceiling from cgroups — not from what a dashboard said at signup — and refuses a job
   it cannot finish, in under a second, in a sentence naming the numbers. Being killed
   is not an acceptable failure mode, because it is a *silent* one.
2. **Work runs inside the request that asked for it.** A thread that outlives its
   request is only safe where the process is guaranteed to stay alive and scheduled.
   Render did not guarantee that; Cloud Run explicitly does not either — CPU is
   allocated per request and an idle instance is throttled or shut down. Both hosts
   break the same assumption, so the assumption goes. Generation (~175s) and
   optimisation (~10s) both fit inside a request.
3. **One instance until there is a queue.** In-flight state lives in this process's
   memory, so `--max-instances 1` is load-bearing, not conservatism. Raising it before
   ROADMAP 1.2 means two instances running the same dish and overwriting each other.

Every measurement above is recorded per run in `export_stats` — `estimated_mb`,
`memory_budget_mb`, `peak_child_mb` — so the two-point estimate becomes real data.

---

### The five expensive-to-reverse decisions

1. **Content-addressed asset paths.** Key by hash, not `slug/timestamp_filename.glb`.
   Current keys embed the tenant slug — rename a tenant and URLs rot.
2. **Generation is a queued job, never inside a request.** Meshy has webhooks; use them.
3. **Photos and models in separate buckets with separate lifecycle rules.** Serving assets
   are hot forever; training photos are write-once, read-almost-never.
4. **The template system fully data-driven.** Today `index.html` is 619 KB with
   `_isMugsyTenant()` branches — that cannot survive self-serve signups nobody touches.
   This is the Astro pivot, and it is already blocking.
5. **No vendor names in the schema.** Store `engine: "meshy-7"` as data, never a
   `meshy_task_id` column.

Everything else — sharding, multi-region, read replicas — **do not build until traffic
exists.**

### 5.1 · The job queue, and the three parts of it that are not obvious

Wired in 2026-09-05. The design argument is in `jobs.py`'s docstring — R2 does atomic
conditional writes, so a create that fails when the key exists *is* a lock, and no
database had to be bought for it. What follows is only the parts that are easy to get
wrong on a second reading.

**1 · A submitted generation keeps its lease.** Generation submits to Meshy and returns
in about a second; the model arrives ~175 s later by webhook. If the job completed at
submit-time, the lease would vanish with it — and the lease is the only thing counting
against Meshy's 10-concurrent-per-account ceiling. Nine machines could then submit ninety
tasks while the eleventh was still refused, which is the exact bug the queue was built to
stop. So the job stays claimed on a short clock (`PENDING_SECONDS`, 240 s), and the
webhook closes it.

That short clock is also the recovery. **`_nudge` is gone.** A webhook that never arrived
used to be caught by the page's own polling, which meant recovery needed somebody to have
a tab open. Now the lease simply expires, the job is claimed again, and a claimer that
finds a task id already on the record **collects instead of resubmitting** — so recovery
costs nothing and a webhook failure can never be billed twice.

**2 · A failed generation is not retried. A failed optimise is.** Optimising is pure CPU
on a master already paid for, and most failures there are transient. A generation is 30
credits, and three automatic attempts at a dish whose photograph is simply bad is 90
credits — most of three days of a month's allowance — spent proving the same thing three
times. It dead-letters on the first failure and a human presses Regenerate.

**3 · The reconciler counts dead jobs as existing.** `worker.py` still scans the
catalogue, but only to *queue* work that ought to have a job and has none — dishes
finished before the queue existed, or anything an outage dropped. If dead-lettered work
did not count as existing, a permanently failing dish would be re-queued every five
minutes forever: free for an optimise, 30 credits a lap for a generation, with nobody
watching. Reviving a dead job is a human decision.

**What this replaced.** `RUNNING`, an in-memory set of what was being worked on, plus a
rule for spotting records that claimed to be running with no thread behind them. It could
not work: the set lived in one process and emptied on every restart while the record in
R2 did not, so the guards refused to start a new run *forever*. A lease is the same idea
done properly — visible to every process, expiring on its own when its holder dies.

**Listing is metered.** R2 `ListObjects` is a Class A operation, 1,000,000 free a month,
and two hosts poll this queue all day. A claim is **2 listings** and `stats()` is **3**,
measured and asserted in `check_jobs.py` — `claim` originally re-listed the leases once
per candidate job. The Studio's loop is woken on enqueue so it can idle at 30 s; the
worker backs off from 10 s to 60 s when nothing is arriving. Together with the UI's
60-second poll that is roughly 400,000 a month, against the million that is free.

---

## 6. Priorities

```
1. AI engine quality        ← produces the spec for everything below
2. Hybrid                   ← reuses the same harness; answers "how good can this get"
3. Scanning visual guide    ← blocked until 1 and 2 fix the angle + photo-count spec
4. Architecture + Astro     ← one decision, done once
5. Admin panel integration  ← the seam that makes it one product, not two projects
```

The five architecture decisions are constraints carried through all of these, not a sixth
item.

---

## 7. Open questions

- What does meshy-7 multi-image actually cost? → one `preflight.py --spend`, then read
  Daily Usage.
- Which elevation wins — 25 or 45? → the variant test.
- Does `three-plus-top` beat a clean ring? → nobody has published this for food.
- What is the first-try approval rate, and what predicts failure? → the Studio's verdict log.
- **Why did QReal leave the food vertical after ~15 restaurants?** Either restaurants don't
  pay enough to cover manual 3D production (our thesis confirmed) or they don't care at any
  price (automation doesn't save us). Worth an hour on founder post-mortems and Glimpse
  investor calls.

---

## 8. Competitive notes

- **QReal (ex-KabaQ)** — the pioneer. Denny's, Bareburger, Magnolia Bakery. Reached ~15
  restaurants, then **exited food** for fashion/luxury/automotive.
- **Reliefs** — closest analogue. €29/€49/€89 for 15/50/100 active dishes, and critically
  **meters 3D VIEWS, not dishes** (1,500/5,000/15,000 included, then €5/€3/€1.50 per 1,000).
  Scanning unlimited and free. Turnkey on-site scanning is a separate custom quote — the
  same self-serve + human-serve split we arrived at independently. **Steal the metered-views
  model.** Their own site says "unlimited mobile scanning" on one page and "2–3 days per
  dish" on another — they hit the fast-vs-faithful fork and papered over it. Site has
  returned 403 to everything since ~March 2026; reads as dormant.
- **Nobody in this category publishes a customer count or a logo wall.** Reliefs runs
  invented numbers that contradict each other on the same page (+35% and +25% average
  basket).

> **The bar is not "impressive." It is "real."** A modest, honestly-measured, named statistic
> beats every fabricated +35%, because ours survives the follow-up question.

**Getting that number without the owner disclosing revenue:** share-of-mix needs only item
counts. *"The five dishes we modelled went from 11% to 19% of orders in their categories;
comparable dishes we didn't model stayed flat."* At onboarding, choose dishes that each have
a natural twin — same category, similar price, similar prep — and a matched control group is
built into delivery at zero cost.

**Monday Greens was never the ICP.** A coffee-led café with regulars who already know the
menu is close to the worst case for AR. The ~13% open-3D / ~5% AR funnel is a floor measured
in the weakest segment, not a ceiling — but that is a hypothesis, and testing it needs 3–5
clients spread across segments rather than 10 in one.

---

## 9. The self-serve product, and where it lives

Settled by Temo on 2026-09-05, in answer to a direct set of questions. These are his calls,
not proposals. Do not re-open them.

### 9.1 · What we are building

**BetaReal splits into two products.** Not two companies and not two codebases yet, but two
offers with different delivery:

| | Who does the work | Where it is built |
|---|---|---|
| **BetaReal Premium** | We do. Manual scanning, pro camera, many photos, hand-graded, judged by a founder | The path that exists today. Corner at Tabidze and Food and Market are this |
| **BetaReal Self-Serve** | The restaurant does. Their photos, their menu, their template, their approval | **The thing being built now** |

Self-serve is the global-launch product. Premium is what pays for it and what proves the
quality bar.

**What self-serve has to be, in Temo's words:** a menu for restaurants that is *easy* and
*very fast*, where they choose a template and customise it, where a new template can be added
to the catalogue without a developer, and where updates are fast and dynamic.

**Speed and lightness are the priority, explicitly.** 3D models are heavy, so everything
around them must not be. Some compromise is acceptable; the models are the payload that has
earned the right to be heavy. Astro was chosen for exactly this reason — static output where
static is right, dynamic where it must be.

### 9.2 · Menu creation: typed first, imported later

**Start with (a): the owner types their items in**, and the template makes it look right.

**Menu import — photograph or upload the existing menu, extract items and prices with a
vision model — is a later addition, and only if it turns out to be easy.** Temo's reason,
and it is the right one: *real menus have a lot of nuance*. Sections that are not categories,
prices that are ranges, sizes, modifiers, two languages in one column, items that are really
descriptions. An extractor that is 85% right produces a draft the owner has to audit line by
line, which is slower than typing.

So: build the typed path properly, and keep the item model clean enough that an importer can
later write into it. **Do not build the importer first, and do not design the typed path
around it.**

### 9.3 · No paywall yet

**Pricing plans do not exist.** They may end up as per-feature gates grouped into tiers;
that is undecided and payment is a question for later, before launch, not now.

**What to build instead: access is by authorised account only, during testing.** No plans,
no quotas, no billing, no per-feature gating. When the pricing structure is decided it gets
added; building a paywall against a price list nobody has written is building the wrong thing
twice.

### 9.4 · Approval is the owner's

**The restaurant owner approves or rejects a model. It is their menu and their call** whether
it goes in.

The fault tags, the verdict log and the internal judging tools are **internal**. They exist
for research — which food is scannable, which angles win — and some of them will be purged
before launch rather than shown to a customer.

### 9.5 · Build order: skeleton, muscles, organs, hair, lipstick

Temo's framing, kept verbatim because it decides a hundred small arguments:

> *skeleton first then muscles then organs and hair and lipstick last*

Build the ecosystem end to end first. Small wrong things get purged in the polish pass. **Do
not stop to perfect a part while the whole is still missing** — and equally, do not ship
polish as if it were progress.

### 9.6 · Where it lives, and the decentralisation rule

**The self-serve menu does NOT live next to Niko's repo.**

This is not a code-organisation preference, it is a structural decision about the company.
Niko's `github.com/Nikoloz-Chachua/Restaurant-AR` was **temporary**, and it sits on one
member's personal account, with the live Supabase project (`lwdpegloznhpcecivhfy`) on one
member's personal account too. Temo created the **BetaReal GitHub account** and the
**BetaReal Cloudflare account** precisely to end that: *the company must not depend on one
member.* If a new Supabase, or a new anything, is needed to keep the self-serve stack under
BetaReal's own control, create it.

So it lives in **BetaReal-owned infrastructure** — the `betarealar-lab` org, alongside the
engine, which is also where the handoff placed it: *"it is not a separate standalone repo; it
is the delivery half of this product."*

**Parallel, not a replacement — for now.** New self-serve tenants only. The existing
tenants, Monday Greens and the hand-built templates, stay on the current renderer. Replacement
happens later, after the new system has actually been tested. Temo's reason, verbatim:
*pushing to prod right now with an incomplete product would be a huge mistake.* Niko approves
the direction.

### 9.7 · Hands off production — absolute

**Nothing in Niko's repos or their production is to be modified. Ever, without being asked.**
No commits, no branches, no PRs, no edits to `C:\Users\temot\BetaReal scaleable` or
`C:\Users\temot\Restaurant-AR`. They may be **read** to understand the data model and the
templates. That is all.

Two paying clients are served by that code. An agent "helpfully" fixing something there is
the single most expensive mistake available in this project.

### 9.8 · ROADMAP.md is a proposal, and parts of it are wrong

Temo, 2026-09-05: *"roadmap was made by AI and it assumes stuff wrong and did not update
stuff."* It says so itself at the top, and it should be read that way — as an argument to be
corrected, never as an instruction.

**Specifically corrected:** ROADMAP Part 5 claims the highest-value action is thirty dishes
shot four ways with the fault tags ticked. **It is not the priority, and it is not this
codebase's call.** Real dishes come from real venues on real scanning days, Temo shoots and
judges them, and he will say when he wants help. Corner at Tabidze (2026-09-05) and Food and
Market (2026-09-07) are **manual pro-camera scans with many photos** — the Premium path — not
tests of the automatic four-photo pipeline, which is a different workflow and must not be
collapsed into them (see §4a/4b).

**The system gets built first.** Models need real dishes, and the dishes are Temo's to bring.
