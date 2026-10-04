# Working in this repo

Rules for anyone working here, whether a person or an AI agent. Claude Code reads it through `CLAUDE.md`;
Codex, Cursor and most other agents read `AGENTS.md` directly. Keep it short: reasoning
belongs in `docs/`, and this file only links to it.

## What this is

BetaReal turns real restaurant dishes into 3D models that a diner opens from a QR code and
places on the table in AR, without installing an app. This repo is the **self-serve rebuild**:
the engine that makes the models, plus the menu and admin a restaurant runs itself. It lives
on BetaReal's own GitHub and Cloudflare accounts.

| Path | What | Stack |
|---|---|---|
| `app/` | diner menu, dish pages `/d/<id>`, embeds, `/a/<key>` asset serving | Astro on a Cloudflare Worker |
| `admin/` | the owner + super-admin panel | Next 16 via OpenNext on a Cloudflare Worker. Read `admin/AGENTS.md` first: this Next has breaking changes |
| `menu/` | migrations, the engine bridge (`model_requests.py`), importers, render ports | Python + SQL (Supabase) |
| root `*.py`, `engines/`, `web/` | the engine: queue, generation, optimiser, USDZ, Scan Studio | Python + Node |
| `deploy/` | engine supervisor and installer (it runs on Temo's PC today) | PowerShell + Python |
| `tools/model/` | hand pipeline for fixing a dish model (Blender + glTF-Transform) | read its `README.md` |
| `docs/` | state, decisions, architecture. `docs/archive/` holds superseded docs | |

## Read before changing anything

1. `docs/ROADMAP.md`: what to work on now. Since 2026-10-04 that means migrating the manual-scan clients
   from production, not new self-serve features.
2. `docs/HANDOFF.md`: read the newest **STATE** block first. It covers live URLs, environment traps,
   and mistakes already made.
3. `docs/DECISIONS.md` §9 and §13: what the product is. These are Temo's calls, so don't re-open them.
4. The doc for the area you're touching: `MENU-PLATFORM.md` (menu), `EMBED.md` (embeds),
   `MIGRATION.md` (moving production restaurants here), `CUSTOMER.md` / `AUDIT.md`
   (owner experience and known defect classes), `RISKS.md`.

Section numbers in code comments (`MENU-PLATFORM §2.6`, `AUDIT.md 15`) refer to files in `docs/`.

## Hard rules

- **Never modify Niko's production repo** (`github.com/Nikoloz-Chachua/Restaurant-AR`,
  local `C:\Users\temot\BetaReal scaleable`) or its Supabase/Cloudflare. Reading it is fine. Don't
  commit, branch, push or run migrations there. Paying restaurants run on it.
- **Secrets stay in `.env`** (see `.env.example`). Never commit them, never paste them in chat,
  never print them. Report keys masked. A leaked Meshy key has already had to be rotated once.
- **Never spend money without asking Temo.** A generation costs 30 Meshy credits and the
  monthly allowance is about 33 dishes. This covers `runner.py --go`, `preflight.py --spend`,
  approving a pending model request, and turning on paid services such as fal.ai.
- **Nothing in R2 is ever deleted.** Orphaned photos and failed generations are kept on
  purpose as training data, and `copy_tenant` shares keys between restaurants.
- **Speed and model quality come first.** Refuse heavy media shown to diners; don't add a
  path that lets it through. Hero video is capped at 6 MB.
- **Zero configuration for owners.** If a feature needs settings or column mapping, use a
  model instead.
- **Port, don't stub.** The 3D/AR code in `menu/render/ported/` is copied verbatim from
  production. Stubbing a feature so something boots once silently removed half the product
  (`docs/archive/FEEDBACK.md`).
- **Check the effect, never the input.** A test that reads back what your own code just
  wrote proves nothing. For anything visual, take a screenshot and look at it: an element
  existing in the DOM doesn't mean a person can see it.

## Running it

Windows. Python 3.14 (`python -m pip install -r requirements.txt`), Node 24. More traps are in
HANDOFF §3: cp1252 console, IPv6-only Supabase direct connection, and `gltf-transform` `.CMD` shims.

```bash
cp .env.example .env                    # fill in from a teammate, never from chat
cd app   && npm ci && npm run dev       # menu   http://127.0.0.1:4321
cd admin && npm ci && npm run dev       # admin  http://localhost:3001
python menu/migrate.py --status         # migrations: --dry-run first, then apply
```

## Checks: run the ones your change touches, and all of them before merging

| Suite | Needs |
|---|---|
| `python check_features.py` | nothing: the features a diner uses |
| `python check_render.py` | node |
| `python check_jobs.py` | nothing (stubs) |
| `python check_schema.py` | `.env` (real Supabase, cleans up after itself) |
| `python check_publish.py` | `.env` |
| `python check_admin.py` | `.env` + both dev servers running |
| `cd admin && npm test` | nothing |
| `node --test app/scripts/check-embed.mjs app/scripts/check-inapp.mjs` | nothing |
| `python check.py`, `python check_webhook.py` | a real master GLB (see HANDOFF §10) |

Counts are recorded in the newest HANDOFF STATE block and should never go down. Read the
last line a suite prints rather than trusting a number written in a doc. When you add a
feature, add a check that goes red if the feature is removed.

## Git and deploys

- `main` is the trunk. Temo, and the sessions he runs, commit and push finished work to `main`
  directly. **Everyone else works on a branch** (`<name>/<topic>`) and opens a pull request.
- Pushing to `main` redeploys the Scan Studio on Render. The menu and admin deploy by hand:
  - menu: `cd app && npm run build && npx wrangler deploy`
  - admin: `cd admin && npm run deploy`

  Confirm `Current Version ID` in the output, and never pipe a deploy through `head`.
- Commit messages say what changed for a person, then why. Keep them plain.

## Keeping the docs true

- Write state to a new **STATE** block at the top of `docs/HANDOFF.md`, and settled decisions to
  `docs/DECISIONS.md` with the date and whose call it was. A judgment left in chat is lost.
- When a doc is superseded, move it to `docs/archive/` and say what replaced it.
- Label guesses as guesses. Measured numbers say they were measured.
