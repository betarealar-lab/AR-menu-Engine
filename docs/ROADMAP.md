# Roadmap: current priorities

Set by Temo on **2026-10-04**. Replaces `archive/ROADMAP.md` (2026-08-31, self-serve first).

> **The priority is moving the manual-scan (Premium) business onto this rebuild, not
> self-serve.** Every paying client is a restaurant we scan for. They don't need the 3D
> Studio, capture guides, quotas or the setup wizard. They need their menu, their 3D dishes
> looked after by us, and proof that it works.

Self-serve stays in the codebase and stays working, but gets no new features until the
migration is done. The terms for migration are in `MIGRATION.md` (2026-09-28): one
restaurant at a time, measured parity, no 3D Studio for migrated restaurants
(`tenants.studio = false`).

---

## 0 · Unblock (not code, needs people)

| | Who | Why it blocks |
|---|---|---|
| Move the `betareal.ge` zone to the BetaReal Cloudflare account, or get Niko to add per-host records | Temo + Niko | A restaurant's printed QR address can't point here until then. It also fixes models being served from `r2.dev` and the Error 1014 |
| Engine on an always-on host (Render Standard, ~$25/mo) | Temo's OK | Optimise and Upload & optimise run only while Temo's PC is on. It was down 41 h on Sep 26–28 |
| Niko agrees to a freeze week per restaurant | Temo + Niko | The team ships to production daily |
| Answer `MIGRATION.md` §9 (paying list, branches, history, analytics, F&M test copy, DNS) | Temo | Each answer changes the importer or the order |
| Read-only export of production `events` / `change_history` / users | Niko | Not readable through the public API |

## 1 · An admin made for restaurants we scan for

Design: **https://claude.ai/artifact/JrJxckaLd2GJfj8UcKDpgZ** (4 phone screens).
The shell already hides the 3D Studio when `studio = false`. What's still wrong: Home
pushes "Make a 3D model", a "Building" card and "Build these next" links into the locked
Studio.

- **Home** for `studio = false`: menu live + link + QR, the one-tap **sold-out** list,
  "Your 3D dishes" strip, last 30 days in three numbers, and **Ask for a new dish**.
- **3D dishes** replaces 3D Studio: plan usage (n of 5 live), dishes **being made** with
  a status (Scanned → Building → Checking → Live), each live dish with views / AR
  placements, its dish link & QR, and "Something looks off?" (reports to us).
  Needs a production-status field on our side, set from the Library Studio / Upload.
- **Ask for a new dish**: pick from their menu (sorted by diner interest), a visit
  window, a note → a request row we see in `/dev` and act on. **Nothing is charged
  from the screen**; extras are agreed on the call (Sales Kit v4).
- **Results**: 3D dish vs its **twin** (same category, similar price, no 3D); the
  funnel; the owner enters **monthly order counts** (counts only, no money), which is the
  share-of-mix proof we have missed at MG and Ikigai; **Share with partners**, a read-only
  link that answers "I'm just a manager, I'll ask the partners".
- Our side: put a model straight onto a restaurant's dish from Upload (as-is or optimise)
  and the Library Studio, and set its production status there.

## 2 · Parity gaps the rebuild must close first (`MIGRATION.md` §3)

- Importer at full fidelity: every column and `theme_config` key, **legacy id → uuid**
  (`items.source_ref`), members, every asset **copied** into our R2.
- Old addresses keep working: host → restaurant rules, `?item=<legacy id>`, old
  `waiter.html#…` payloads, `?menu=` groups.
- Diner features still missing here: announcement banner, hero gallery + video sequence,
  info section (map, hours, socials, delivery links, reviews), menu groups / kitchens,
  service fee + order type (Ikigai), Food & Market's extra info text.
- Per-restaurant looks as template settings first, a skin file only when really one brand's.
- Kill-switch `sw.js` on every migrated host (production's service worker would
  otherwise keep serving the old cached menu).
- Change history with revert: built (0036).

## 3 · Parity harness

`parity.py <prod-slug> --rebuild <slug>`: data diff, screenshots, a behaviour script (3D,
basket + waiter QR, language, theme, `?item=`) and an event diff, across phone/desktop ×
day/night × languages. A restaurant moves only when it is clean or every difference is
signed off. See `MIGRATION.md` §5.

## 4 · Migrate, in this order

1. A demo with a custom domain (`cafe` or `luxury`): proves the harness, kill switch, DNS.
2. **Corner at Tabidze**: re-import (prod now has 109 dishes / 5 in 3D).
3. **Monday Greens**, after Corner has run clean for 2 weeks.
4. Ikigai, KADO, Mamma Italia.
5. Food & Market last (most per-restaurant code).

Each: freeze → import → look → preview → harness → real phones → owner sign-off →
switch DNS → watch 48 h (roll back on a >30% drop) → production keeps it 30 days.

---

## Parked until migration is done

Menu import (parser never written; `CUSTOMER.md` §1) · photo quality checks · 3D Studio
polish · fal.ai (written, off) · the 183 dead i18n keys · self-serve signup.

## Small, whenever

- Real-phone test of the Instagram escape on `/d/<id>` (`cbe350c`).
- Analytics for BetaReal-owned model pages (events need a tenant today).
- Link to the dish page from each dish's editor.
