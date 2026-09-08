-- 0021: let a super admin actually change a template.
--
-- `templates` already had the right rules and none of the permission to use them:
--
--   templates_read    using (listed or is_super_admin())     -- correct
--   templates_write   using (is_super_admin())               -- correct, and DEAD
--
-- ...because `authenticated` was granted SELECT and nothing else. A policy decides WHICH
-- ROWS a grant may touch; it never grants anything. With no INSERT, UPDATE or DELETE on
-- the table, `templates_write` could not fire for anybody, and a super admin opening a
-- template screen would have watched every save fail with a permission error that named
-- the table and not the reason.
--
-- This is the same class of mismatch as 0018 and the exact opposite direction. There, a
-- table-level grant was wider than the rule anybody intended; here it was narrower. Both
-- are invisible until somebody tries the thing, which is why both now have a check that
-- tries the thing.
--
-- The rows stay ours: `templates_write` is `is_super_admin()`, so this grant hands nothing
-- to an owner. What it removes is the contradiction.

grant insert, update, delete on templates to authenticated;

comment on table templates is
    'The shapes a menu can take. A template is a STYLESHEET (shipped in the menu app, in '
    'app/src/lib/css) plus a default palette (this table). Read by anyone when `listed`, '
    'by super admins always; written by super admins only - policy templates_write, and '
    'the grant it needs, 0021.';
