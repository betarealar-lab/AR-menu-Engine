# BetaReal Engine

The image-to-3D layer behind one interface, plus a local bench for judging what comes out.

Nothing here names a vendor except `engines/meshy.py`. Meshy today; self-hosted Hunyuan and
the VGGT hybrid slot in as more entries in the registry. This is module #1 of the scanning
app, not a throwaway — the app will call the same `Engine.generate()`.

Why it exists and what was decided: **[DECISIONS.md](DECISIONS.md)**.

## Setup

```bash
pip install requests pillow
```

Create a key at <https://meshy.ai/settings/api> — it is shown once. Put it in `.env`:

```powershell
Set-Content -Path .env -Value 'MESHY_API_KEY=msy_...' -Encoding ascii
```

Use `-Encoding ascii`. PowerShell 5.1's `utf8` writes a BOM that attaches itself to
`MESHY_API_KEY` and the line stops matching. `.env` is gitignored — never commit it,
never put a key in client-side code.

```bash
python preflight.py        # confirms the key works, prints the exact request body
```

## Scan Studio

```bash
python studio.py           # http://localhost:8765
```

**Nothing is read from your drive and no folder is watched.** Make a dish, drop four photos
into the plate, run an engine, record a verdict. Frames land in `dataset/` on upload, so the
same dish can be re-run against another engine later on byte-identical input.

The browser downscales each photo to 2048px before upload — the same size the engine reduces
it to anyway, so a 24 MB camera JPEG becomes about 1 MB and nothing is lost.

**A variant is one angle strategy for one dish.** `ring-25`, `ring-45`, `three-plus-top`.
The same dish shot four ways is four experiments, and which angles work is the open question
the engine comparison cannot answer. See DECISIONS.md §4.

**Frame order is semantic.** Slot 1 is the primary view — meshy-7 reconstructs from it first.
Slots 2–4 are coverage. The front/right/back/left names are our discipline for even coverage;
Meshy receives a plain ordered array, but Hunyuan3D-2mv takes explicitly named views, so
keeping the convention now costs nothing and pays later.

## Batch

```bash
python runner.py --list                    # engines and credit cost
python runner.py --engines meshy-5         # DRY RUN — shows the spend, calls nothing
python runner.py --engines meshy-5 --go    # spends credits
```

Fans everything already in `dataset/` across other engines. Dry run is the default because
credits are finite and a mistyped batch is expensive.

## Output

```
dataset/<dish>/<variant>/   1-front.jpg .. 4-left.jpg + meta.json (sha256 per frame)
out/<dish>/<variant>/<engine>/  <dish>.glb  .usdz  .png
out/verdicts.csv            the judgement log
out/runs.csv                batch results
```

`verdicts.csv` is the point of the exercise. `verdict` plus `faults` is what turns "some come
back abhorrent" into a rule the scanning app can enforce **before** spending a credit — and
into the eval set for the hybrid later.

## Credits

Published table (meshy.ai → API cost details, 2026-08-26), Multi Image to 3D:

| model | no texture | with texture |
|---|---|---|
| Meshy 6 | 20 | 30 |
| other models | 5 | 15 |

Meshy 7 is not named and is assumed to be "other models". The runner shows a worst case
beside the estimate. One real call settles it — **Settings → API → Daily Usage** reports the
exact charge. API credits come from the same pool as the web app.

## Adding an engine

Subclass `Engine`, implement `generate()`, add a line to `REGISTRY` in `engines/__init__.py`.
Nothing else changes.
