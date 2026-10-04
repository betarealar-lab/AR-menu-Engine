# BetaReal: self-serve 3D menus

A restaurant photographs a dish, gets a 3D model back, approves it, and diners see it in 3D
and in AR on their own table from a QR code, with no app. This repo holds all of it: the engine that
builds the models, the diner menu, and the admin panel the restaurant runs itself.

**Working on this repo? Read [AGENTS.md](AGENTS.md) first.** It has the rules, how to run things, the
checks, and how changes ship. Then read the newest STATE block in [docs/HANDOFF.md](docs/HANDOFF.md).

## The pieces

```
owner's phone ──> admin/ (Next) ──> Supabase ──> model_requests ──> engine (root *.py)
                                        │                               │  Meshy -> optimise
                                        v                               v  -> GLB + USDZ
diner's phone <── app/ (Astro Worker) <─┴──────────── R2 (photos, models, catalogue)
```

- **Engine.** `jobs.py` is a queue on R2, `pipeline.py` does generate → optimise, and `worker.py`
  claims the work a small host can't handle. `engines/` holds the vendor adapters (Meshy on,
  fal.ai written but off). Nothing outside `engines/` names a vendor.
- **Menu (`app/`).** Pages are rendered at the edge with the restaurant's template inlined,
  so there's no flash of a generic page. The 3D and AR code is ported verbatim from the
  production platform.
- **Admin (`admin/`).** Built phone-first: menu, theme, 3D Studio, analytics, dish QR codes,
  and change history. Super admins also get `/dev`, the Library Studio, and Upload & optimise.
- **Hand pipeline (`tools/model/`).** Fixes a model by hand when the automatic path isn't
  good enough.

## Live

| | |
|---|---|
| menu | https://betareal-menu.betareal-ar.workers.dev |
| admin | https://betareal-admin.betareal-ar.workers.dev |
| Scan Studio | https://ar-menu-engine.onrender.com (internal, basic auth) |

## Docs

| | |
|---|---|
| [docs/HANDOFF.md](docs/HANDOFF.md) | current state, environment traps, measurements, mistakes not to repeat |
| [docs/DECISIONS.md](docs/DECISIONS.md) | why things are the way they are, settled calls |
| [docs/MENU-PLATFORM.md](docs/MENU-PLATFORM.md) | architecture of the self-serve menu |
| [docs/CUSTOMER.md](docs/CUSTOMER.md), [docs/AUDIT.md](docs/AUDIT.md) | the owner's experience, and the defect classes plus the checks that catch them |
| [docs/EMBED.md](docs/EMBED.md) | dishes on other people's websites, and the dish link |
| [docs/MIGRATION.md](docs/MIGRATION.md) | moving production restaurants here, one at a time (a plan, not run) |
| [docs/RISKS.md](docs/RISKS.md), [docs/COMPETITORS.md](docs/COMPETITORS.md) | exposures on the live platform, and the market |
| [tools/model/README.md](tools/model/README.md) | the hand model pipeline |
| `docs/archive/` | superseded: the old roadmap, the Sep 7 rebuild post-mortem, the old handoff prompt |

## Scan Studio (internal engine bench)

```bash
python preflight.py        # checks the Meshy key and R2, and prints the exact request body. Spends nothing
python studio.py           # http://localhost:8765
python runner.py --list    # engines and their credit cost; --go spends credits, so ask first
```

A variant is one angle strategy for one dish (`ring-25`, `ring-45`, `three-plus-top`). Frame
order matters: slot 1 is the primary view. To add an engine, subclass `Engine` in
`engines/base.py` and register it in `engines/__init__.py`.
