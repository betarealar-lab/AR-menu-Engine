-- 0002_grants.sql — who may touch a table at all, before RLS decides which rows.
--
-- Found by `check_schema.py` the first time it ran: every policy in 0001 was correct and
-- every query still failed with `permission denied for table items`. Two different
-- mechanisms, and they are easy to confuse because either one alone looks like the whole
-- answer:
--
--     GRANT   may this ROLE touch this TABLE at all       - coarse, per table
--     POLICY  which ROWS of it, for this user             - fine, per row
--
-- Supabase's "Automatically expose new tables" would have issued these grants silently
-- on our behalf. It is switched OFF deliberately (DECISIONS §9, and Supabase's own
-- advice on that screen): with it on, a table created in a hurry is reachable through
-- the public API from the instant it exists, and if RLS has not been written for it yet
-- there is nothing between the anon key and the rows. Off means a new table is
-- unreachable until someone deliberately says otherwise. That is this file.
--
-- The rule that follows from MENU-PLATFORM §2.1: **`anon` is granted nothing, anywhere.**
-- A diner is not signed in, and a diner never queries the database - they read a page
-- rendered at the edge from a published snapshot. If a diner-facing feature ever appears
-- to need a row from here, the fix is to put it in the snapshot, not to grant `anon`.

-- The two roles PostgREST connects as. Neither gets anything by default.
revoke all on all tables in schema public from anon, authenticated;

-- Signed-in restaurant staff. RLS narrows every one of these to their own tenant; see
-- `is_member_of` in 0001.
grant select, update                 on tenants          to authenticated;
grant select                         on tenant_members   to authenticated;
grant select                         on super_admins     to authenticated;
grant select                         on templates        to authenticated;
grant select, insert, update, delete on categories       to authenticated;
grant select, insert, update, delete on items            to authenticated;
grant select, insert, update, delete on models           to authenticated;
grant select, insert                 on publications     to authenticated;
grant select, insert, update         on live_publication to authenticated;

-- No INSERT on `tenants` and no DELETE on `publications`, on purpose:
--   creating a restaurant is signup, which runs server-side with the secret key and has
--   to create the tenant and its first membership together or neither;
--   a publication is a log of what was served to real diners, and a log somebody can
--   quietly delete rows from is not a log.

-- The policy helpers. PUBLIC has EXECUTE by default in Postgres, but "by default" is not
-- a thing to rely on for the two functions every policy in the schema calls.
grant execute on function is_member_of(uuid)  to authenticated;
grant execute on function is_super_admin()    to authenticated;

-- Anything added later starts closed too, rather than inheriting whatever the last
-- migration happened to leave lying around.
alter default privileges in schema public revoke all on tables from anon, authenticated;
