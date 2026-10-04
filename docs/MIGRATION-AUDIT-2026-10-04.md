# BetaReal: Astro engine and migration readiness audit

**Decision: keep existing production in place. The Astro rebuild is a useful foundation, but it is not ready to replace Monday Greens.**

Reviewed 4 October 2026, repository `betarealar-lab/AR-menu-Engine`, main at [`96cdfe89`](https://github.com/betarealar-lab/AR-menu-Engine/tree/96cdfe89d09e26bfd5c6b5b5246f8c0d7660c467). Findings apply to this checkout and the public pages observed today; later commits can change them.

Your boundaries: manual restaurant scanning comes first; self-service comes later. Monday Greens should remain as it is for now. Niko, Temo and George review launch readiness. This report proposes requiring all three approvals. No production deployment, database mutation, DNS change, upload, generation or paid operation was performed. Public page visits may produce ordinary view analytics.

## 1. What already works in the architecture

The rebuild no longer needs to paint a generic restaurant page and replace it with a tenant menu. Astro resolves the restaurant, template, colors and dish content on the server and sends restaurant-specific HTML. Category filtering uses that existing markup. Posters appear before interactive 3D; model-viewer and hero video are deferred. These are sound choices for the problem you described.

The public app uses a Supabase anonymous key and a narrowly shaped `public_menu` RPC, rather than a direct privileged database connection. SQL filters hidden dishes and only includes model URLs after approval. The admin has session verification, database tenant isolation, super-admin restrictions for raw model uploads, change history, and a database-enforced Studio entitlement. These safeguards are real work already implemented, not things to rebuild from scratch.

Sources: [`[slug].astro`](https://github.com/betarealar-lab/AR-menu-Engine/blob/96cdfe89d09e26bfd5c6b5b5246f8c0d7660c467/app/src/pages/%5Bslug%5D.astro#L99), [`public_menu`](https://github.com/betarealar-lab/AR-menu-Engine/blob/96cdfe89d09e26bfd5c6b5b5246f8c0d7660c467/menu/migrations/0026_public_menu_template_defaults.sql#L34), [`Studio entitlement`](https://github.com/betarealar-lab/AR-menu-Engine/blob/96cdfe89d09e26bfd5c6b5b5246f8c0d7660c467/menu/migrations/0029_studio_entitlement.sql).

## 2. Current workflow and where it splits

| Step | Current implementation | Operational implication |
|---|---|---|
| Create restaurant | Admin calls transactional `create_tenant`, creating the tenant and first owner together | Good foundation; new tenants inherit `studio=true`, so manual clients need a separate switch-off step |
| Choose template | Database row supplies ID/defaults; guest app ships four corresponding styles | Adding a database template does not automatically add a renderer/layout |
| Enter content/design | Next admin writes restaurant, item, category and theme data into Supabase | Guest SSR reads live data; there is no verified staged release boundary protecting a paying menu from partial edits |
| Provide manual models | BetaReal super-admin uploads models; multipart supports optimization inputs and as-is GLB/USDZ | Manual import exists; optimization still depends on engine/bridge availability |
| Process models | Bridge creates jobs; workers claim leases, process files, then reconcile model records | Offline processing delays new assets and updates, not already-served restaurant menus |
| Review and attach | Model approval and item attachment control what `public_menu` exposes | Good database rule, but arbitrary asset access currently weakens the privacy boundary |
| Serve diners | Cloudflare Worker fetches a restaurant RPC, builds HTML, serves R2 assets | Faster initial architecture, but every menu request still depends on a successful database request |
| Track activity | Browser events go through `/e` to anonymous `record_events` | Useful analytics, but no adequate abuse boundary was demonstrated |
| Release | Manual admin deployment workflow; guest build/deploy separate; SQL migrations separate | No single enforced gate verifies all three components and all client parity requirements |

There is also a Python publish/snapshot renderer alongside the live Astro renderer. Passing its tests does not establish that the Worker behaves identically. Several comments and planning documents describe older behavior. Prefer the deployed route and current migrations when they disagree with documentation.

## 3. Confirmed migration blockers

### A. Monday Greens is visibly different

Compared [current Monday Greens](https://monday-greens.betareal.ge/) with [the rebuild fixture](https://betareal-menu.betareal-ar.workers.dev/mg) in the same browser session:

| Current production | Rebuild observation |
|---|---|
| Georgian opening language in this session | English opening language |
| Dark green opening theme | Light turquoise opening theme with a visible theme toggle |
| Food/Drinks group switch and food-first category presentation | No group switch; food and drink categories appear together |
| Contact block, telephone, hours, map, delivery, review and Instagram links | No anchor links exposed in the rebuilt page DOM |
| Existing layout/hero treatment | Different spacing, veil/gradient and category presentation |

These observations alone fail your “stay as it is” requirement. Language/theme may partly reflect default/preference rules, and the imported fixture may be stale; neither explanation makes it ready. Baseline must be the current production page and data, captured at a known time.

Evidence: [current screenshot](monday-greens-current.png), [rebuild screenshot](monday-greens-rebuild.png). Screenshots show the initial desktop viewport, not a full phone parity test. The rebuild's DOM had no `#menu-groups` and no anchors. Its route forwards only a fixed runtime settings list, and common markup does not recreate every production block. CSS containing an old feature is not proof that its markup or wiring is present.

### B. Template creation does not create the promised template

`createTemplate({basedOn})` copies palette defaults only. It does not record which shipped layout the new ID should inherit. The guest renderer recognizes four IDs, and an unknown ID silently falls back to Monday Greens. A founder can create/list a template that appears valid in admin but uses the wrong guest layout.

**Fix:** separate template identity from renderer identity. Validate the renderer and feature contract before listing a template. Generate the admin and guest registry from one source; reject unsupported combinations before release.

Sources: [`templates.ts`](https://github.com/betarealar-lab/AR-menu-Engine/blob/96cdfe89d09e26bfd5c6b5b5246f8c0d7660c467/admin/lib/data/templates.ts), [`fallback at line 137`](https://github.com/betarealar-lab/AR-menu-Engine/blob/96cdfe89d09e26bfd5c6b5b5246f8c0d7660c467/app/src/pages/%5Bslug%5D.astro#L137).

### C. Template edits can change existing restaurants

Admin documentation says defaults only seed new restaurants. Actual `public_menu` merges current template defaults beneath the restaurant theme on every request. Editing a default therefore changes existing restaurants wherever they have not overridden that key.

**Fix:** choose an explicit policy. For your migration requirements, pin each restaurant to an immutable template version, with an intentional reviewed upgrade. Alternatively, copy a complete initial configuration and never resolve mutable global defaults at runtime. Do not advertise seed-only behavior while performing a live merge.

Source: [`0026`](https://github.com/betarealar-lab/AR-menu-Engine/blob/96cdfe89d09e26bfd5c6b5b5246f8c0d7660c467/menu/migrations/0026_public_menu_template_defaults.sql#L44).

### D. Importing a fixture is not a complete production migration

`menu/import_tenant.py` exists and imports useful menu data. Its own header calls it a comparison fixture, not a migration path. It retains external model/photo URLs, so the new ecosystem still depends on old asset origins. It does not migrate every legacy feature, membership, analytics or routing requirement.

Its repeat-import behavior also needs correction: item conflict updates omit `addons`, `featured` and `currency`; models omit updated title/poster; vanished source items are not reconciled away. A repeat import can leave stale content. A zero `sort_order` is treated as false by `or pos`, which can change ordering. Price parsing treats some decorated single-number text as a plain price despite the documentation's stronger claim.

No `parity.py` implementation was found. Existing `menu/app/sw.js` is the old caching worker, not the planned migration cache-retirement route, and it is not an Astro `/sw.js` page. Current Astro routes do not provide the legacy host/query/deep-link mapping described in `docs/MIGRATION.md`.

**Fix:** make migration a complete, repeatable translation with a dry-run diff, stable legacy IDs, explicit deletion/hiding policy, asset manifest and parity results. Implement and test compatibility for existing printed URLs, `?item=`, restaurant aliases and legacy staff QR payloads. Retire old service workers at the same origins/scopes; never rely on DNS alone to clear phone caches.

Sources: [`import_tenant.py`](https://github.com/betarealar-lab/AR-menu-Engine/blob/96cdfe89d09e26bfd5c6b5b5246f8c0d7660c467/menu/import_tenant.py), [`migration requirements`](https://github.com/betarealar-lab/AR-menu-Engine/blob/96cdfe89d09e26bfd5c6b5b5246f8c0d7660c467/docs/MIGRATION.md).

### E. Manual-client operation is only partly formalized

`studio=false` is enforced in the model-request trigger, and clients cannot change it themselves. That is good. Creation still defaults to Studio on, while the admin creates a tenant without specifying a manual-service mode. A founder must subsequently switch it off. The permissions context also defaults to Studio enabled while entitlement data is missing.

**Fix:** an atomic manual-client intake path with Studio disabled by default. Establish separate capabilities for client content editing, model request, model upload, model approval, attachment and publication. Show upload/processing failures and asset readiness clearly, including GLB/USDZ/poster/scale. Verify that a manual restaurant owner can manage approved content without seeing generation prompts or accidentally spending credits. Test this as an actual client account, not only a super-admin.

## 4. Security findings

| Priority | Finding and evidence | Required action |
|---|---|---|
| High | Staff can call `add_tenant_member` with owner role, including promoting themselves, and remove another member. SQL checks membership, not owner authority. The last-member guard is not a last-owner guard. Admin treats every non-super member as `brand_owner`. | Enforce capabilities in SQL/RLS and server routes; reserve membership management for owners/BetaReal; preserve at least one owner. Add negative role tests. Friendship/equal founder standing can coexist with strict restaurant-account roles. |
| High | Public `/a/<key>` reads arbitrary keys from the bound buckets without checking publication/ownership. An isolated mock proved 200 responses for `lib/raw/internal-master.glb` and `catalog/known-dish/record.json`, cached publicly for a year. Raw upload inputs really use `lib/raw/`. | Serve only approved public output keys from a dedicated public asset manifest/bucket. Authenticate private previews/source downloads. Audit reachable prefixes without deleting originals. CORS or unguessable names do not replace authorization. Actual private object contents were not accessed. |
| Medium | Anonymous `record_events` accepts repeated batches with arbitrary object metadata. `/e` reads the full body before its 8,192-character check; the direct anonymous RPC bypasses that proxy limit. | Bound metadata/body bytes at the authoritative entry point, add abuse controls and retention, label untrusted analytics and validate durations. Avoid making diner access depend on analytics success. |
| Medium | Build safeguards park only `.env.local`; secret-bearing alternative `.env*` files can bypass that protection. The parked filename is not ignored. The scanner skips when `.env.local` is absent. `process.exit()` on build failure prevents the surrounding `finally` restoration. | Use a clean build environment with an allowlist of public build variables; ignore all secret/parked files; scan complete artifacts; restore before returning a failed exit code. Verify rotation of the previously exposed credential mentioned by repo comments—rotation was not independently checked. |
| Conditional | Scan Studio intentionally permits access when `STUDIO_USERS` is empty; it only warns when exposed beyond the local machine. JSON body reading lacks an application size cap. | Fail closed in hosted mode; bound requests, use individual access identities and verify deployed authentication. This is a code/config risk, not a claim that the hosted Studio is currently open. |
| Before public self-service | Signup creates email-confirmed accounts before invite redemption; concurrent redemption can leave orphan accounts. No application throttling was found there. | Keep invitation controls limited, require email verification for public signup, handle races/cleanup, and add throttling before self-service launch. |

Primary evidence: [`member RPCs`](https://github.com/betarealar-lab/AR-menu-Engine/blob/96cdfe89d09e26bfd5c6b5b5246f8c0d7660c467/menu/migrations/0008_members.sql#L14), [`usePlan`](https://github.com/betarealar-lab/AR-menu-Engine/blob/96cdfe89d09e26bfd5c6b5b5246f8c0d7660c467/admin/lib/usePlan.ts), [`asset route`](https://github.com/betarealar-lab/AR-menu-Engine/blob/96cdfe89d09e26bfd5c6b5b5246f8c0d7660c467/app/src/pages/a/%5B...key%5D.js#L51), [`events RPC`](https://github.com/betarealar-lab/AR-menu-Engine/blob/96cdfe89d09e26bfd5c6b5b5246f8c0d7660c467/menu/migrations/0032_analytics_window.sql#L35), [`build wrapper`](https://github.com/betarealar-lab/AR-menu-Engine/blob/96cdfe89d09e26bfd5c6b5b5246f8c0d7660c467/admin/scripts/build-cf.mjs), [`Scan Studio`](https://github.com/betarealar-lab/AR-menu-Engine/blob/96cdfe89d09e26bfd5c6b5b5246f8c0d7660c467/studio.py#L166).

This is a code/config review, not a penetration test or security certification. Live database grants, deployment settings, secret history, dependency vulnerabilities, backups and recovery were not verified.

## 5. Performance: better structure, speed still unproven

One public fetch sample, without browser compression accounting:

| Page | HTML bytes | Fetch elapsed |
|---|---:|---:|
| Current Monday Greens | 777,931 | 0.35 seconds |
| Rebuild `/mg` | 416,464 | 1.90 seconds |
| Rebuild `/corner` | 218,534 | 0.31 seconds |

Monday Greens HTML is approximately **46.5% smaller**. These samples are not controlled FCP/LCP measurements and cannot establish a speed regression or improvement. The old page populates content after loading; the new response includes content. Both approaches must be measured to useful-menu readiness.

The Astro menu makes an uncached RPC per request, with no explicit fetch timeout or last-known-good fallback in the route. A database failure yields an unavailable page. Template CSS is still inserted inline, and substantial shared viewer logic remains. Saved language/theme preferences are applied after JavaScript starts, so a returning visitor can still see a language/theme change even though the restaurant itself was rendered correctly.

Astro does not itself reduce GLB/USDZ bytes or GPU work. Imported assets remain external until copied, and the viewer still upgrades nearby posters and warms AR after idle. Preserve model quality first; measure whether this competes with first interaction on lower-end phones. Do not mass-prefetch all models.

Recommended serving model: reviewed, versioned menu releases with cached complete HTML/data and immutable assets. Keep the last approved release available if admin/database/processing is down. Updates can publish quickly and invalidate caches deliberately. If prices must update instantly, design that narrow path explicitly rather than making every visual customization immediately live.

Before launch, agree measurable budgets: suggested mobile p75 LCP ≤2.5s, INP ≤200ms, CLS ≤0.1, plus no regression against the same client's current page and an agreed first-3D/AR-ready target. Run repeated cold/warm tests on identical data, network and devices; include Safari, Android Chrome, Instagram and Facebook in-app browsers. Real-phone AR placement, scale and recovery must be checked physically.

## 6. The template contract to build next

Use one shared platform for restaurant data, navigation, languages, categories, cards, basket/staff handoff, viewer, AR, analytics and accessibility. Templates select a layout and visual tokens. Client-specific needs become declared features with settings, rather than copied websites or tenant-name conditions.

Each template version should declare:

| Contract field | Purpose |
|---|---|
| Template ID, immutable version, renderer ID | Reproducible rendering and safe upgrades |
| Configuration schema, defaults, validation | Same meanings and constraints in admin and menu |
| Supported features and dependencies | Groups, fees, order types, announcements, diet badges, contact blocks, galleries etc. cannot silently disappear |
| Editable settings and capability requirements | Define what client owners, staff and BetaReal can change |
| Preview fixtures and release checks | Demonstrate empty/large menus, multilingual text, variants, no-3D and manual assets |
| Compatibility/schema migration rules | Upgrade an existing restaurant intentionally without breaking saved content |

The admin should consume this contract to display correct fields and constraints. A custom feature is ready only when its schema, server rendering, browser behavior, admin controls, validation, permissions and tests ship together. Avoid arbitrary executable client customization; use approved components/features. Validate listing against the installed guest renderer version.

Monday Greens parity comes before extracting a more elegant shared base. Refactoring its layout while migrating makes it much harder to know which differences are intentional. Self-service then becomes a later workflow on the same proven contracts, with guided templates/examples and complete previews.

## 7. Cooperation and release workflow

Suggested division: Temo owns architecture/schema and integration; George reviews admin and permission behavior; Niko reviews restaurant fidelity and diner experience. These are review responsibilities, not ownership allocations. You three remain the launch reviewers.

Use branches/PRs, one tracked feature specification, a designated implementer and another reviewer. Every change states its schema, admin effect, menu effect, manual-client effect and validation. Add automated contract checks to PRs; current deployment CI typechecks/builds/scans but does not run all the local feature/unit suites. Keep staging accounts, data, buckets, Worker routes and credentials separate from production. Version DB/admin/guest compatibility and expand schemas before deploying consumers.

For each restaurant, maintain a readiness record: source snapshot, asset manifest, legacy URL map, selected template version, parity differences, permission results, device checks, performance evidence, rollback rehearsal and three approvals. Also separate technical readiness from commercial permission; a near-final prospect is not automatically an approved production client.

## 8. Required migration gates

1. **Inventory:** capture current dishes, prices, ordering, languages, themes, groups, contacts, custom features, QR/NFC URLs and assets. Monday Greens production remains unchanged.
2. **Isolated import:** dry-run then import into staging; reconcile changes; verify exact asset files and source-ID mapping. Preserve scans/source masters.
3. **Parity:** compare every field and every user-visible behavior. No unexplained missing features. Approved improvements recorded explicitly; Monday Greens currently requires preservation.
4. **Manual admin:** actual owner/staff accounts edit the allowed fields; founders upload/approve/attach; all changes appear correctly in preview. Forbidden operations fail at the database/server.
5. **Security:** close public-source asset access and staff membership escalation; validate secret hygiene, deployed auth, tenant isolation and abuse handling.
6. **Reliability:** serve the approved menu during database/engine failures; check broken assets, slow network, failed jobs and incomplete updates. Rehearse backup restoration and rollback.
7. **Devices/performance:** repeated desktop/mobile tests and real iOS/Android AR; printed QR tests and old service-worker upgrade/offline scenarios. Prove the claimed speed benefit.
8. **Approval:** Niko, Temo and George review the same release evidence. Explicit user authorization remains required before production cutover.
9. **Controlled launch:** migrate one approved client at a time, preserve the old platform and original files, monitor availability/errors/assets and meaningful diner interactions. Do not judge low-volume clients solely by short-window analytics percentages.

## 9. What was tested and what remains unverified

| Verification | Result |
|---|---|
| Actual guest markup/runtime feature checks | 203/203 passed |
| Separate snapshot-renderer checks | 116/116 passed; not proof of live Astro parity |
| Admin unit tests | 26/26 passed |
| Embed unit tests | 14/14 passed |
| In-app-browser unit tests | 7/7 passed; real-phone behavior remains unverified |
| Local job/queue suite | 67/70 initially; three supervisor assertions failed because Windows denied `taskkill` |
| Isolated supervisor follow-up | Using a permitted termination method on the owned stub verified a new child process and incremented restart count |
| Asset authorization mock | Unauthenticated arbitrary raw/JSON keys reached bucket reads and returned 200 |
| Public page checks | Current Monday Greens and rebuilt MG/Corner HTML fetched; MG desktop layout and DOM compared |

No application dependencies were installed, and full Astro/Next builds/typechecks were not run. No production-data or live-write test suites were run. Admin workflows were reviewed in source, not tested through a signed-in client session. Current Corner was not visually compared; this report does not certify any restaurant's full parity. Phone AR, controlled performance, actual deployed SQL policies, disaster recovery, DNS ownership and staging isolation remain release work.

Two operating decisions remain open: which fields restaurant owners/staff should edit, and whether the three-reviewer approval must be unanimous. Until clarified, use restricted client capabilities and all three approvals. Continue building in staging; do not switch existing clients based on test counts or visual resemblance alone.
