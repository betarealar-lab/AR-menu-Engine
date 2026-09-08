-- 0018: the free-model limit is ours to set, not the restaurant's.
--
-- Found while building the quota screen. `tenants_write` is `using (is_member_of(id))`
-- and `authenticated` held a TABLE-level UPDATE grant, so any member of a restaurant
-- could change any column on their own tenants row straight from the browser with the
-- anon key. Including:
--
--   model_quota  how many models they get free before a request needs our approval. It is
--                the only thing standing between a client and our Meshy credits, and it is
--                enforced in `model_request_gate()` by reading exactly this column.
--   slug         the address on every QR code already printed and stuck to a table.
--
-- Neither is a thing a restaurant should be able to change, and neither has ever been
-- written by the admin: the only updates it makes are `settings`, `theme`, `template_id`
-- and `setup_done` (grep says so, and the four call sites are listed below). So this is a
-- lock, not a change of behaviour - nothing that works today stops working.
--
--   admin/lib/data/menu.ts      update({ settings })
--   admin/lib/data/theme.ts     update(patch)  -> theme, template_id, settings
--   admin/app/(admin)/setup     update({ setup_done: true })
--
-- **Why a column grant and not a policy.** RLS policies are per-ROW; they cannot say "this
-- row, but not that column". Postgres does that with column privileges - and a table-level
-- UPDATE grant overrides column-level ones, so the table grant has to go first and the
-- allowed columns be named. That is why the list below is explicit and why adding a column
-- to `tenants` in future means adding it here too. The alternative, a trigger that
-- compares old and new, hides the rule inside procedural code where nobody looks.

revoke update on tenants from authenticated;

-- Everything a restaurant legitimately edits about itself. `name` is included because it
-- is their own name; `languages` because adding Georgian is theirs to decide;
-- `country`/`currency` because they are set at signup from a form the owner filled in and
-- correcting a mistake there should not need us.
grant update (name, theme, template_id, languages, settings, setup_done, country, currency)
  on tenants to authenticated;

comment on column tenants.model_quota is
    'Free models before a request needs our approval. Read by model_request_gate(). '
    'NOT writable by authenticated (0018) - a restaurant cannot raise its own limit. '
    'Change it with set_model_quota(), which is super-admin only.';


-- The one way it changes, and who may do it -------------------------------------------
--
-- SECURITY DEFINER because the rule is about the CALLER, not the row: "are you one of us".
-- That is the same shape as create_tenant, add_tenant_member and redeem_invite, and it
-- keeps the check in the database rather than in a screen that hides a button.
create or replace function set_model_quota(p_tenant uuid, p_quota integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
    if not is_super_admin() then
        raise exception 'not allowed' using errcode = '42501';
    end if;
    if p_quota is null or p_quota < 0 or p_quota > 1000 then
        -- Bounded because this is a number typed into a box. Zero is meaningful - it means
        -- every request comes to us first - and a thousand is far past any real restaurant,
        -- so anything outside is a typo or a probe, and both should be refused rather than
        -- stored.
        raise exception 'quota must be between 0 and 1000' using errcode = '22023';
    end if;
    update tenants set model_quota = p_quota where id = p_tenant;
    if not found then
        raise exception 'no such restaurant' using errcode = 'P0002';
    end if;
    return p_quota;
end $fn$;

comment on function set_model_quota(uuid, integer) is
    'Set a restaurant''s free-model limit. Super admins only - the column itself is not '
    'writable by authenticated (0018).';

revoke all on function set_model_quota(uuid, integer) from public;
grant execute on function set_model_quota(uuid, integer) to authenticated;


-- Reading it back is already solved -----------------------------------------------------
--
-- `admin_overview()` (0014) returns `quota` and `quota_used` for every restaurant, gated
-- by `is_super_admin()` inside a SECURITY DEFINER function - which is this codebase's
-- pattern for "data that is ours, not a tenant's", and the reason an owner gets an empty
-- set rather than an error telling them the function exists.
--
-- A first draft of this migration added a `tenant_quota_overview` VIEW instead. It was
-- wrong twice: `authenticated` has no SELECT on views here so it returned nothing, and had
-- that been "fixed" with a grant it would have leaked every restaurant's numbers to every
-- signed-in owner, because a plain view runs as its OWNER and RLS on `tenants` would never
-- have been consulted. Two ways to read the same number is also one way for them to
-- disagree. There is one.
