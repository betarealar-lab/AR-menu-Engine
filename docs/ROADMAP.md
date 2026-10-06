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

Design: **https://claude.ai/artifact/JrJxckaLd2GJfj8UcKDpgZ**, two rows: what a restaurant
sees, and what the BetaReal team sees (2026-10-06). Built from production's admin
elements; product calls (comparisons, plans, reports) stay with the team.

**Rule (Temo, 2026-10-06): never worse than production's admin.** An owner gets every
function production gives a brand owner; only what production gates to super admins
(`canUploadModels` / `isThemeTemplateActionAllowed`) is team-only. Inventory, read from
production's `admin-app` at `b43b1f7`:

- **Menu Editor**: Menu Items / Categories; + Add; twin phone view; 360° spin; active 3D
  count; search; filters Category, Top-level tab, Visibility, Content, Data quality; columns
  Name, Category, Tab, Price, Model, Visible, Edit, Delete. Item: names and descriptions EN/KA,
  price, category, top-level tab, text-only, thumbnail upload/clear, sort order, signature
  dish, visible (+ the rebuild's old price and sizes & extras). Categories: names EN/KA, tab,
  menu order, item count, edit, delete.
- **Theme Editor**: Night and Day (13 colours each, low-contrast warning), Background (colour
  + image per theme), Fonts (heading/body, any Google Font), Branding (names EN/KA, logo, hero
  gallery, page content + visit photo on templates that have it), Announcement; Reset Theme,
  Save Changes, unsaved-changes guard, live preview desktop/phone.
- **Analytics** (production's restaurant set, counted per person): people, 3D, AR, basket,
  basket after AR / after 3D, time in 3D, AR-capable phones, most viewed / ordered / placed,
  per day, by hour, by weekday, top dishes, categories, language.
  **Gap:** the rebuild does not record AR capability yet (production's `ar_cap`).
- **Change History**: tick changes, revert selected, refresh.
- **Branches**: brand owners with more than one branch (depends on MIGRATION Q2).

**Team-only, as in production:** Templates tab, hero video, model upload / picture-only mode,
3D thumbnail, AR size, view angle, creating restaurants, accounts (production's Tenants +
Account Log; here invite and reset links, no stored passwords).

**Team (super admin), the same restaurant plus what only we touch.** Blue, with a TEAM tag:
- **All restaurants**: runs on (production / moving / rebuild), 3D dishes, visitors, last
  edit, *needs us* (reason in words); engine status on top.
- **Menu + 3D panel**: model, show in 3D/AR, live 3D thumbnail, real size (one
  dimension), camera angle, dish page & QR; *Re-import from production* while moving.
- **Look**: template, colours, background, fonts, layout (single/twin, spin, default
  theme + lock, 3D block), hero video (6 MB cap).
- **Analytics, Diagnostics tab**: sources (table QR, dish QR/flyer, Instagram, embed),
  AR tapped vs placed per platform, phone language vs menu languages, hero pass, time on
  menu / in 3D, delivery taps, desktop visits excluded, last event received.
- **See as the owner** on every team screen.

- **Gap: the rebuild cannot count unique visitors yet.** Its events carry only a per-tab
  `session` (0009); production carries a persistent `visitor_id` (localStorage UUID).
  Add `visitor_id` to the menu's events and the analytics functions, and carry
  production's across in the import, before any restaurant moves.

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
