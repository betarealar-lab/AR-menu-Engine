# MIGRATION.md: moving production restaurants onto the rebuild, one at a time

Written 2026-09-28. **A plan, not a run.** Nothing here has been executed, and nothing
in Niko's repo, database or Cloudflare account has been touched (DECISIONS §9.7). Every
fact about production below was read from `origin/cloudflare` @ `b43b1f7` (2026-09-25,
`sw.js` `bl-v237`) and from production's public read API. Re-verify before acting:
production gets ~290 commits a month.

**Temo's terms, 2026-09-28:**

- One restaurant at a time. Current clients stay on production until their turn; new
  clients start on the rebuild.
- "Perfect: every function, every little detail, the same or improved."
- A migrated restaurant does **not** get the 3D Studio. We manage their 3D.
  That is `tenants.studio = false` (0029) and is already enforced in the database.
- Don't migrate yet.

---

## 1. The rule that makes "perfect" checkable

"Perfect" can't be judged by eye across 27 restaurants, 1,565 dishes, two themes,
three languages and two phone layouts. So **parity is measured, not claimed**:

> A restaurant moves only when the **parity harness** (§5) finds no difference between its
> production page and its rebuild page that is not on that restaurant's signed-off
> **known-differences list**. A difference is fixed in the rebuild, or accepted on the
> list as an improvement. There is no third option.

Everything in §3 is what the harness checks, or a manual item where a check can't reach.

---

## 2. What production is, in numbers (2026-09-25)

| | |
|---|---|
| Restaurants | 27 rows under 27 brands (one branch each). All brands are on `plan = premium` |
| Dishes | 1,565, of which about 60 are live in 3D |
| 3D files | 63 GLB/USDZ pairs on **two** `pub-*.r2.dev` buckets, Cloudflare's rate-limited test address (RISKS §1) |
| Diner page | One `index.html`: 777 KB, 15.7k lines, 233 functions |
| Theme settings | `theme_config` key/value rows: about 150 distinct keys (day_*, night_*, hero_*, info_*, site_*, announcement_*, per-dish `item_view_<id>`, …) |
| Per-restaurant CSS | Style rules scoped to one restaurant: mugsy-main 116, food-market-main 96, pipes-burger-main 58, burger-planet-main 42, kado-main 24, ikigai 17, mamma-italia 6, MG 5+5 |
| Per-template CSS | 20+ `data-template` skins: baoma 139, premium_fast_casual 116, burger_bar 64, gochit_monster 58, modern_cafe 57, monday_greens 50, social_dining 40, … |
| Per-restaurant JS | Mugsy, Pipes, BAOMA, Mingleyard, Food & Market (kitchens, landing, diet badges, doodles, AR steam list), Ikigai (order type, 12% service fee) |
| Onboarding | A hand-written SQL file per client (`2026-07-28_mugsy_menu_import.sql`, `2026-09-25_kado_digital_menu.sql`, …) plus assets committed into the repo (`assets/kado` 136 files, `assets/food-market` 57, …) |

**Paying or near-paying clients** (confirm §9 Q1): Monday Greens (rid 39), Corner at
Tabidze (76), Food & Market (73), Ikigai Sushiroom (78), and probably KADO (81) and
Mamma Italia (80). The rest are demos and pitches.

---

## 3. The parity inventory: everything that has to come across

Each line is one thing a person could notice. **H** = the harness checks it
automatically; **M** = a person checks it on a real phone; **R** = the rebuild
already has it (verify, don't rebuild).

### 3.1 Addresses: the things printed on tables

Printed QR stands and NFC tags **cannot be reprinted cheaply**. Every URL that exists
today must keep working, for the same restaurant, forever.

- **H** Host → restaurant, production's exact rule chain (`_tenantSlugFromHost`, `_resolveTenant`):
  1. `?tenant=` / `?restaurant=` / `?slug=` in the URL wins
  2. hard-coded hosts: `foodandmarket.betareal.ge` → food-market-main, `corner-at-tabidze.betareal.ge` → corner-by-eleven-main
  3. `restaurants.custom_domain`: monday-greens, luxury, cafe, **casual** (→ fast-casual), **social** (→ social-dining), foodandmarket, corner-at-tabidze `.betareal.ge`
  4. `<sub>.betareal.ge` / `<sub>.betareal.app` → slug `<sub>`, with production's slug/brand fallbacks
  5. `restaurant-ar.pages.dev` / localhost → a default
- **H** `?item=<integer id>` opens one dish straight into 3D/AR (NFC/QR tags on single dishes, PR #80). The rebuild's ids are UUIDs, so the importer must keep **legacy id → uuid** (`items.source_ref` already exists for exactly this), and `?item=` must resolve through it.
- **H** Other params: `?menu=` (group), `?theme=` (day/night override), `?fm_catalogue`, `?fixture=` (dev only, must not work in production).
- **H** `waiter.html#<payload>`: QRs **already on customers' phones** decode `{v, r: slug, ts, it: [[legacyId, qty]]}`. The rebuild's `/w/[slug]` must accept the old payload with legacy ids.
- **M** Every live hostname from the **Cloudflare DNS/Pages custom-domain list** (needs Niko's account). The database lists only 7, and restaurants like Ikigai are reached through rule 4.

### 3.2 Data: every column, and where it lands

| Production | Rebuild | Note |
|---|---|---|
| `restaurants` (slug, custom_domain, status, brand_id) | `tenants` (+ domain) | `status` → hidden/active |
| `brands` (plan, logo_url, primary/secondary_color, can_create_branches) | no brands table (DECISIONS §9.3) | **Q2**: a branch becomes its own tenant; decide whether we need a "group" |
| `menu_items` name/description **en/ka/ru** | items `name`/`i18n` | Russian is a column, not a language (MENU-PLATFORM §9.1) |
| `price` (text, e.g. "28 ₾") | integer tetri (§9.4) | `Mgaloblishvili (Glass)` disagrees with itself. Ask the owner, don't guess |
| `price_old`, `featured`, `text_only`, `visible`, `sort_order` | R | |
| `variants`, `addons` (JSON) | R | pricing (`_addonSum`, `_variantIndex`) must match to the tetri, **H** |
| `additional_info_en/ka` (Food & Market) | **missing** | add to items i18n |
| `is_3d`, `thumb_3d`, `ar_scale`, `model`, `model_usdz` | models row + item flags | files **copied** into our R2, never hot-linked from r2.dev |
| `thumbnail_url` | photo key | copy into our R2 |
| `categories` name en/ka/ru, sort, top-level/menu group | R + groups | |
| `theme_config` about 150 keys | `tenants.theme` + template | `item_view_<id>` → `models.view_orbit` |
| `events` history | `events` | **Q5**: carry history so dashboards don't restart at zero |
| `change_history` | change log | the revert feature (§3.6) depends on it |
| auth users + `restaurant_users` / `brand_users` | `tenant_members` | **no password crosses** (§4.4) |

### 3.3 The diner's page

- **H** Menu content: every category and dish, in order, in each allowed language (`_allowedLanguagesForTenant`: Mamma Italia is en/ka only), with prices, old prices, variants, add-ons, featured, text-only rows, hidden dishes absent.
- **H** Menu groups / top-level tabs (food/drinks, Food & Market's separate kitchens + landing tiles), `?menu=` deep link, the virtual **3D** pill and 3D block (listed once when every dish is 3D, 5f16e4f).
- **H** "Most ordered" block, AR featured banner/block, category headers, empty states, not-found page.
- **M** Hero: image gallery (order, timing), video + mobile video + poster, gallery→video sequence, KADO's smooth sub-pixel zoom, `hero_min_h`.
- **H** Announcement banner (Corner): enabled, text, date, time, photo.
- **H** Info section: title/kicker/text, map embed/link/query, directions, Instagram/Facebook, phone/hours/address, venue links, delivery links (Mugsy's Wolt/Glovo order links + locations JSON), reviews (`reviews_json`, Google review link).
- **H** Day/night: default theme, **theme lock**, the visitor's saved choice, every `day_*`/`night_*` token (colours, card radius/blur, shadows, glows, background image/size/repeat, modal backgrounds, price/add-button colours).
- **H** Fonts (heading/body, custom), favicon per restaurant (KADO, F&M, Corner, MG), document title + suffix, meta description, `lang` attribute.
- **H** Basket: add/remove/qty, totals, **Ikigai's dine-in/takeaway/delivery + 12% service fee**, sauce "Included with meal" instead of 0 GEL, fly-to-basket animation (F&M), **Show to waiter** QR.
- **M** Phone layouts: `phone_layout` single/twin, Ikigai's stacked cards, no mid-word breaks, No Bun Burger card (F&M).
- **M/H** 3D: live thumbnails (reveal on any of three signals, RISKS §2), 3D modal, spin toggle, per-dish camera angle, scale.
- **M** AR, on real devices, per restaurant: iOS Quick Look (and the on-device USDZ fallback), Android WebXR with the custom placement (plate guide, scale gauge, placed FX, labels, **scan guide + tap step**, **steam** only on the dishes F&M lists, no steam on cold dishes), Scene Viewer fallback, the solo-dish AR link.
- **H** Analytics events, same names, same fields: `page_load`, `first_interaction`, `scroll_depth`, `category_filter`, `menu_group`, `item_view`, `modal_close`, `ar_tap`, `ar_success`, `ar_fallback`, `ar_duration`, `ar_placed`, `basket_add/remove/open/clear`, `waiter_qr_shown`, `lang_change`, `theme_change`, including `platform` and `ar_cap`. Otherwise the funnel (74% past hero, 13% open 3D, 5% AR) stops being comparable.

### 3.4 Per-restaurant looks and behaviour

Production forks the look **per restaurant** inside one file. MENU-PLATFORM §2.1a says the
rebuild renders a template server-side and never re-skins in the browser. So each fork
becomes one of:

1. **A template setting**, when more than one restaurant could use it: menu groups/kitchens, diet badges, service fee + order type, announcement, "included with meal" labels, steam list. **Preferred.** These are features, not one restaurant's CSS.
2. **A restaurant skin file** (`<slug>.skin.css`, same mechanism as `japan.skin.css`), only for what really is one brand's look (Mugsy street diner, Pipes signature card, F&M doodles, KADO).
3. **Dropped, on the known-differences list**, with the owner told. Only for dead code (e.g. the Aurora demo that is precached for every restaurant, ARCHITECTURE-DEBT §4).

Templates to port for the restaurants that matter first: `monday_greens` (R), `elegant_black` (R, Corner + KADO), Food & Market's white theme, Ikigai's `minimal_sushi`, Mamma Italia's.

### 3.5 Service worker: the trap that would keep diners on the old site

Production registers `sw.js` (cache `bl-v237`) and precaches the page. A phone that
visited before the switch **keeps serving the old cached menu from its own storage**, whatever
DNS says, until that worker updates. So the rebuild must serve, **at `/sw.js` on every
migrated host**, a kill-switch worker: on install, `skipWaiting`; on activate, delete
every `bl-v*` cache, `clients.claim()`, unregister itself, and reload open pages. It stays
up for at least 60 days. **H**: load production, then switch the host, then check the page
now comes from the rebuild with no cached `bl-v*` left.

### 3.6 The owner's side

Production's admin has these; each needs a rebuild equivalent, or an explicit "not
needed" from Temo:

- Menu editor: filters (missing en/ka/price/image, AR, photo-only, text-only, hidden), food/drinks tabs, top-level categories and menu order, search (restored in c4c6075), twin/single phone preview, spin toggle, view angle, AR scale.
- Theme editor: presets, day/night, fonts, branding (logo, hero gallery, hero video + mobile + poster), background, **announcement**, content texts, Mugsy's JSON fields, unsaved-changes guard, reset.
- **Change history with revert**, plus `changed_by` (PR #86). The rebuild shows History as "not built yet". **Gap.**
- Account log (last sign-in, send reset, remove account) and branches (create, permission). Plans at 300/450/900 GEL are UI-only (ARCHITECTURE-DEBT §3). The rebuild uses `studio` and `model_quota` instead.
- For migrated restaurants, the **3D Studio is hidden** (studio = false). Their models are made by us in the Library Studio or with Upload & optimise, straight into the restaurant.

---

## 4. How one restaurant moves (the runbook)

### 4.1 Before (no downtime, nothing public changes)

1. **Freeze.** Tell the team the restaurant is frozen on production for its cutover week. Other restaurants keep shipping.
2. **Import, full fidelity.** Extend `menu/import_live.py` → `import_tenant.py` from "menu" to **everything in §3.2**: every column, every theme key, `legacy id → uuid` map, members. Read-only against production's public endpoint, as today. Re-runnable (`source_ref`), so a re-import after a late change is one command.
3. **Copy assets.** Every model, photo, hero image/video, logo and favicon is **copied** into our R2 and addressed by our keys. Models go through **Upload & optimise** only when a better version is wanted; by default the exact production file is kept, so the diner sees the same model.
4. **Look.** Port its template/skin (§3.4).
5. **Preview URL**: `https://betareal-menu.betareal-ar.workers.dev/<slug>`. The owner and we compare it side by side with production.

### 4.2 Prove it

6. **Run the parity harness** (§5) until it is clean or every difference is on the signed-off list.
7. **Real phones**: one iPhone, one Android. AR on 3 dishes, basket → waiter QR scanned by a second phone, language switch, day/night. Screenshots saved to the restaurant's migration folder.
8. **Owner sign-off** on the preview. Their "yes" is the gate, as with models.

### 4.3 Switch (minutes, reversible)

9. Point the restaurant's hostname(s) at the rebuild's menu Worker. Printed QRs don't change.
10. The kill-switch `sw.js` is live on that host (§3.5).
11. The rebuild's `/w/` accepts old waiter payloads, `?item=` resolves legacy ids.
12. **Watch 48 hours**: page loads, 3D opens and AR events against the restaurant's previous 7 days. A drop of more than 30% in any of them means roll back first and investigate after.

### 4.4 Accounts

Passwords never cross. Production stores client passwords in plain text
(ARCHITECTURE-DEBT §1). The owner gets a **set-password link** from the rebuild. Their
old production login keeps working until the restaurant is retired there, so nobody is
locked out in between.

### 4.5 Rollback

Point DNS back. Production is untouched and still has the restaurant for **30 days**
after the switch. Only then is it hidden there (by Niko).

---

## 5. The parity harness (to build before the first migration)

One command, per restaurant, driven by headless Chrome (the same CDP approach already
used for the embed and admin screenshots):

```
python parity.py <prod-slug> --rebuild <slug>
```

For every combination of **{phone 390, desktop 1400} × {day, night} × {each allowed language}**:

- **Data diff**: extract from both DOMs the ordered categories, and per dish: name, description, price text, old price, variants/add-ons, featured/3D/text-only flags. Any mismatch is listed by dish.
- **Visual diff**: screenshot both, align, and report a per-region difference score. The images go in a report page so a person can look, because a DOM check can't tell whether something is visible (the 2026-07-03 lesson).
- **Behaviour script**: open a 3D dish, spin, close; add two dishes with a variant and an add-on; open the basket; show waiter QR, decode it, check the totals; switch language; switch theme; open `?item=<legacy id>`; open each `?menu=` group.
- **Event diff**: the events each page sent during the script, compared by name and fields.
- **Report**: one HTML page per restaurant, a green/red line per §3 item, plus the known-differences list with who accepted each one.

---

## 6. Order

1. **A demo first** (`cafe` or `luxury`): it has a custom domain, no owner and no risk. It proves the harness, the kill-switch worker and the DNS move.
2. **Corner at Tabidze**: partly imported already (rebuild has 58 dishes; production now has 109 and 5 in 3D, so re-import), `elegant_black` is already ported, and it has the announcement banner.
3. **Monday Greens**: the case-study client. Its template is already ported and it has 170 dishes. Only after Corner has run clean for 2 weeks.
4. **Ikigai** (service fee + order type become template features), **KADO** (136 assets, `elegant_black`), **Mamma Italia**.
5. **Food & Market** last: the most per-restaurant code (96 scoped rules, kitchens, steam list, test-copy experiments still running on production).
6. Demos: only the ones sales actually uses.

---

## 7. Blockers that are not code

1. **DNS.** `betareal.ge` lives on Niko's personal Cloudflare account. Pointing one hostname at our Worker needs either that zone moved to the BetaReal account (which also fixes the r2.dev risk and Error 1014) or Niko adding each record. This is the gating item.
2. **Niko's agreement.** The team ships to production daily. A freeze window and a "this restaurant now lives there" rule need him.
3. **Production data we can't read publicly**: `events`, `change_history`, auth users. A read-only export from Niko's Supabase (service key or dashboard CSV) is needed for §3.2's history rows.
4. **The engine host.** Migrated restaurants' 3D is made by us, and the engine currently runs only while Temo's PC is on and signed in. It had been down 41 hours on 2026-09-28. Move it to an always-on host (HANDOFF, the 09-18 plan: Render Standard, $25/mo) before a paying client depends on it.

---

## 8. What gets better on the move (put these on the known-differences list as improvements)

- Models served from our own R2 through the Worker instead of `r2.dev` (RISKS §1).
- No client password stored anywhere.
- The page is rendered with its template on the server: no flash of the default look, and far less JavaScript per restaurant.
- Embeds on the restaurant's own website (EMBED.md) become available.
- Every model shipped at real-world size through one optimiser.

---

## 9. Questions for Temo (answers change the plan)

1. Which production restaurants are **paying clients** today? Is the list MG, Corner, F&M, Ikigai, KADO, Mamma Italia right?
2. **Branches**: production has brands → branches. Is "one tenant per branch" fine, or do we need a group above them (one owner, one menu, several addresses)?
3. **Freeze window**: is a one-week freeze per restaurant acceptable to Niko and the team?
4. **Change history + revert**: does a migrated client need it on day one? It's the largest owner-side gap.
5. **Analytics history**: carry each restaurant's old events across, or start its rebuild dashboard fresh at cutover and keep production's numbers as the "before"?
6. **Food & Market's test copy** (`food-and-market-test2-main`) and its motion/AR experiments: which of them are final and must be matched?
7. **DNS**: move the `betareal.ge` zone to the BetaReal Cloudflare account, or ask Niko for per-host records?
