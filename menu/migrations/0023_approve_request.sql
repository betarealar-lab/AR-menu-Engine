-- 0023: a pending request can actually be approved, and we are not our own client.
--
-- Found on 2026-09-12 by a request that looked stuck and was not. `sacdeli modelebi` was
-- at 4 of 3 used, so `model_request_gate()` filed the fourth as `pending` - correctly -
-- and then nothing in the system could ever move it:
--
--   `model_request_gate()` is BEFORE INSERT. Raising `model_quota` with
--   `set_model_quota()` does not re-evaluate a row that already exists, so the obvious
--   remedy does nothing at all and gives no hint that it did nothing.
--
--   An owner may write `state`, and only the values 'pending' and 'cancelled' (0007), so
--   the restaurant cannot move it either - as designed.
--
--   And there was no super-admin path. `admin_queue()` (0014) lists the row, and the
--   developer screen marks it "3h waiting on us" after an hour, which is a clock over a
--   control that was never built. The only way to approve anything was a service-key
--   write by hand.
--
-- So the state a request enters when we are over quota was a dead end with a warning
-- light on it. That is the worst version of this: the screen told an owner "a few
-- minutes" while the row waited on a button nobody had made.
--
-- Two things here, and they are deliberately separate.

-- 1 · Approving one request ------------------------------------------------------------
--
-- SECURITY DEFINER and `is_super_admin()` inside, the same shape as `set_model_quota()`
-- and `create_tenant()`: the rule is about the CALLER, not the row.
--
-- **It does not raise the quota**, and that is the point of having a function per
-- decision. Approving this dish is "yes, build that one" - a judgement about one plate of
-- food, costing 30 credits, made by someone looking at the photos. Raising the quota is
-- "this restaurant may set off three more without asking us". Wiring the button to the
-- second would mean every yes quietly granted a standing allowance, which is the one
-- thing the cap in 0007 exists to prevent. Both exist; they are clicked for different
-- reasons.
--
-- **Only `pending`.** Not `failed`: that request already spent its credits, its photos
-- are the photos that failed, and re-approving it would be the retry loop 0007's comment
-- and AUDIT.md §5 both refuse. Asking again is a new row, with new photos, counted again.
-- Not `cancelled` either - withdrawn means withdrawn, and the unique index in 0007 has
-- already let the dish be re-requested by then.
--
-- **One statement, not a check and then a write.** Two of us on the developer screen at
-- once, both clicking Approve on the same row, must not produce two generations and sixty
-- credits. `where ... and state = 'pending'` takes the row lock and re-evaluates the
-- predicate after it, so the second caller matches nothing and is told why rather than
-- succeeding silently.
create or replace function approve_model_request(p_request uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_state text;
begin
    if not is_super_admin() then
        raise exception 'not allowed' using errcode = '42501';
    end if;

    update model_requests
       set state = 'approved',
           -- The note is owner-facing and currently reads "Waiting for us to approve this
           -- one." Leaving it there would put that sentence under a row that is building.
           note = '',
           decided_utc = now()
     where id = p_request
       and state = 'pending';
    if found then
        return 'approved';
    end if;

    -- It did not match. Say which of the two reasons it was, because "nothing happened"
    -- on a button that spends 30 credits is the one answer nobody can act on.
    select state into v_state from model_requests where id = p_request;
    if not found then
        raise exception 'no such request' using errcode = 'P0002';
    end if;
    raise exception 'a request in % cannot be approved, only one in pending', v_state
        using errcode = '22023';
end $fn$;

comment on function approve_model_request(uuid) is
    'Move one pending model request to approved so the engine may claim it. Super admins '
    'only, and pending only - a failed request is never re-approved (that is a retry loop '
    'through the quota; ask again as a new request). Does NOT change model_quota: that is '
    'set_model_quota(), and it is a different decision.';

revoke all on function approve_model_request(uuid) from public;
grant execute on function approve_model_request(uuid) to authenticated;


-- 2 · A super admin is not subject to the quota ----------------------------------------
--
-- Temo, 2026-09-12: *"for supaadmin there should be no dish limits ofc."*
--
-- 0007 says what the cap is for: *"A self-serve button with no cap is a faucet pointed at
-- our own bank account the moment there are fifty restaurants instead of two."* It
-- protects our credits from a CLIENT. A super admin is not a client - they are the person
-- whose credits those are, and the person who would have to approve the request anyway.
-- Capping them means the owner of the balance queues for permission from themselves, on a
-- screen that then tells them to wait for us.
--
-- It is not a loosening of the boundary, because the boundary was never the quota. A super
-- admin could already call `set_model_quota()` to 1000, or `approve_model_request()` as of
-- this file. What the cap added in that one case was a detour, and the detour is what
-- produced a stuck row on a test tenant.
--
-- **`auth.uid()` is the whole condition, so the engine is unaffected.** The bridge and
-- `keepalive.py` use the service key, where `auth.uid()` is null, `is_super_admin()` is
-- false, and the quota path runs exactly as before. Nothing that inserts without a signed-in
-- person changes behaviour.
--
-- Everything else in this function is 0013 byte for byte. Restated in full rather than
-- patched because `create or replace function` has no partial form, and a gate whose
-- current text has to be assembled from three migrations is a gate nobody can read.
create or replace function model_request_gate()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
    v_quota integer;
begin
    new.requested_by := auth.uid();
    new.requested_utc := now();

    -- The primary dimension, from the three. Width first: it is what a photo measures
    -- best. Height last: it is what the generator invents most often.
    if new.width_cm is not null then
        new.scale_cm := new.width_cm;  new.scale_axis := 'width';
    elsif new.length_cm is not null then
        new.scale_cm := new.length_cm; new.scale_axis := 'length';
    elsif new.height_cm is not null then
        new.scale_cm := new.height_cm; new.scale_axis := 'height';
    elsif new.scale_cm is null then
        new.scale_axis := null;
    end if;

    if new.kind = 'rescale' then
        new.state := 'approved';
        new.decided_utc := now();
        return new;
    end if;
    select model_quota into v_quota from tenants where id = new.tenant_id;
    -- `is_super_admin()` first, and short-circuiting, so a super admin's request does not
    -- depend on the tenant's counter at all.
    if is_super_admin()
       or model_requests_used(new.tenant_id) < coalesce(v_quota, 0) then
        new.state := 'approved';
        new.decided_utc := now();
    else
        new.state := 'pending';
        new.note := 'Waiting for us to approve this one.';
    end if;
    return new;
end $fn$;

comment on function model_request_gate() is
    'Runs on INSERT, before the row lands. The state a request starts in is decided HERE '
    'and not by whatever the client sent - see the column grants in 0007. A super admin '
    'is never gated by the quota (0023): the cap protects our credits from a client, and '
    'a super admin is not one.';
