-- 0039: the 3D Studio is developer-only, for now.
--
-- Temo, 2026-10-08: "lock away self serve 3d studio functionalities to developer access
-- only for now." The priority moved to migrating the manual-scan (Premium) clients off
-- production (docs/ROADMAP.md, 2026-10-04); every paying client is a restaurant we scan
-- for, and none of them should be offered a Studio.
--
-- **No new mechanism.** 0029 already made the Studio an entitlement on the restaurant and
-- enforced it where it bites: `model_request_gate()` refuses a request from a restaurant
-- with `studio = false` unless the caller is a super admin (or the engine). So "developer
-- only" is: every restaurant off, and off by default. Super admins keep the whole Studio
-- on every restaurant, the Library Studio and Upload & optimise, unchanged.
--
-- **Reversible by flag.** Turning it back on for one restaurant is
-- `update tenants set studio = true where slug = '...'`, by a super admin
-- (`tenants_studio_guard`, 0029). Every restaurant that existed when this ran had it ON,
-- all of them internal: corner, corner-by-eleven, demo-kitchen, japan, melting-pot, mg,
-- restaurant, sacdeli-modelebi, steakhouse-n1, tutto-bene.

alter table tenants alter column studio set default false;

update tenants set studio = false where studio;

comment on column tenants.studio is
    'Does this restaurant have the 3D Studio - asking for models, judging them, attaching '
    'them? Off by default and off everywhere since 0039 (developer-only for now). Enforced '
    'in model_request_gate, not only in the admin (0029). Super admins are never gated.';
