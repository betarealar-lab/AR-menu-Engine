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
- **On meshy-7, image 1 is the primary front view.** Image order is semantic; the capture
  guide must preserve it end to end.
- Published cost table names only "Meshy 6" (20/30) and "other models" (5/15). It does not
  name Meshy 7. Newer being cheaper is normal — Meshy 6 is the priced-high legacy outlier in
  every row — but confirm by reading Settings → API → Daily Usage after one real call.

### After the engine: the optimiser, and real-world scale

Generation runs the optimiser automatically, and the review screen loads its **output**,
not the master. The earlier call was the reverse — optimise only what gets approved, so a
rejected dish costs nothing but the look. That was wrong on both halves: the work is five
seconds of CPU and zero credits, and the master is the wrong thing to judge. It is ~216 MB
of VRAM against ~52 MB, which is the difference between a page a mid-range Android survives
and one it drops, and a master can look perfect while the optimiser has quietly eaten the
garnish. The master stays one click away for when a verdict is contested — the only honest
way to separate "the engine got it wrong" from "the optimiser did".

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
