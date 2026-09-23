-- 0029: the 3D Studio is something a restaurant HAS, not something a person is.
--
-- BetaReal is two products off one platform (DECISIONS 9): Premium, where we scan and the
-- restaurant never touches a camera, and self-serve, where they do. The Studio - request a
-- model, judge it, attach it - belongs to the second. Today every restaurant has it,
-- including the ones whose models we make by hand.
--
-- **Why a column on the tenant and not a role.** A role answers "who is this person":
-- owner, staff, super admin. This question is "did this restaurant buy 3D generation",
-- and a Premium client's owner is still an owner - role-gating cannot tell the two apart.
-- An entitlement can, and it is also the shape a plan takes later: `studio` is the first
-- of them, not a special case.
--
-- **Default true, because every restaurant that exists today uses it.** A default of false
-- would silently switch the Studio off for Monday Greens and Corner the moment this ran.
-- New Premium restaurants are created with it off, by hand, until plans exist.

alter table tenants add column if not exists studio boolean not null default true;

comment on column tenants.studio is
    'Does this restaurant have the 3D Studio - asking for models, judging them, attaching '
    'them? Off for Premium clients, whose models we make. Enforced in model_request_gate, '
    'not only in the admin: hiding a button is not a permission (0029).';


-- The gate, which is where it has to bite -------------------------------------------
--
-- The admin will hide the screen, and that is not the control: `model_requests` is a
-- table an authenticated client can insert into under its own RLS, so a restaurant
-- without the Studio could still ask for a model with a five-line script, and each one
-- costs us 30 credits.
--
-- Restated in full because `create or replace function` has no partial form. Byte for
-- byte 0023 apart from the check below.
create or replace function model_request_gate()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
    v_quota integer;
    v_studio boolean;
begin
    new.requested_by := auth.uid();
    new.requested_utc := now();

    -- Before anything else, and never for a super admin: the entitlement is about what a
    -- CLIENT bought, and a super admin making a model for a Premium restaurant by hand is
    -- the Premium product working as intended. `auth.uid() is null` is the engine, which
    -- creates no requests but must never be gated by one.
    select studio into v_studio from tenants where id = new.tenant_id;
    if v_studio is false and auth.uid() is not null and not is_super_admin() then
        raise exception 'the 3D Studio is not part of this restaurant''s plan'
            using errcode = '42501';
    end if;

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
    'Runs on INSERT, before the row lands. Refuses a restaurant whose plan has no Studio '
    '(0029), then decides the starting state - not whatever the client sent (0007). A '
    'super admin is subject to neither (0023): both exist to protect our credits from a '
    'client, and a super admin is not one.';


-- Who may turn it on or off ----------------------------------------------------------
--
-- `tenants_write` (0001) lets an owner update their own restaurant, and a new column
-- rides along with that grant - so without this an owner could grant themselves the
-- Studio. Same shape as `models_shared_guard` (0024/0027), for the same reason.
create or replace function tenants_studio_guard()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
    if new.studio is distinct from old.studio
       and auth.uid() is not null and not is_super_admin() then
        raise exception 'only a super admin may change a restaurant''s plan'
            using errcode = '42501';
    end if;
    return new;
end $fn$;

drop trigger if exists tenants_studio_guard on tenants;
create trigger tenants_studio_guard
    before update on tenants
    for each row execute function tenants_studio_guard();


-- The engine's own progress, which is not the same as being alive --------------------
--
-- `engine_heartbeat` says the PROCESSES are up, because `keepalive.py` writes it from
-- `p.poll() is None` - has this child exited. On 2026-09-18 that was green while four
-- approved requests sat untouched for forty minutes: the bridge was running and simply
-- not converting any of them. Liveness answered a question nobody was asking.
--
-- So the bridge writes its own row, `id = 'bridge'`, after a pass that SUCCEEDED. Two
-- rows, two meanings, and the difference between them is the alarm: the process is up and
-- the last thing it managed to do was an hour ago.
--
-- The table already holds one row per id and its read policy is already super-admin-only,
-- so nothing here changes who can see what.
comment on table engine_heartbeat is
    'Liveness AND progress for the engine, one row per reporter, written with the service '
    'key. `engine` is keepalive saying the processes exist. `bridge` is the bridge saying '
    'its last pass actually worked (0029) - the pair is what tells "up" apart from '
    '"working", which a whole afternoon was lost to.';
