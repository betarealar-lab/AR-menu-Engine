-- 0012: the owner's 3D studio, with everything Scan Studio can do.
--
-- Temo, 2026-09-06: "i want every capability of 3d studio that we created last time to be
-- here meaning multiview, and everything also add photo library too." With three things
-- kept ours - engine choice, optimise targets, fault tags - because each one is a knob on
-- how much we spend, and the credit balance with them.
--
-- What that needs from the database, and did not have:
--
--   A PHOTO LIBRARY. Until now a frame existed only as an R2 key inside one request's
--   `photo_keys`; close the tab before sending and the photo was orphaned in a bucket.
--   `captures` is the library: every frame ever uploaded, by dish and slot, kept forever
--   (0007 - the photos outlive the model). An owner can come back tomorrow and finish.
--
--   MULTIVIEW as a task. Predicting three angles from one photo runs on the engine side,
--   where the image-model key lives, so the admin asks for it the same way it asks for a
--   model: a row the bridge picks up. Free, and ONCE per dish - enforced by a unique index
--   with no state filter, so it cannot be spammed by cancelling and asking again.
--
--   SIZE. The single most common reason a model has to be remade is that it shipped at
--   whatever size the engine invented (dataset.py). Scan Studio asks; the owner's studio
--   asks too, on the plate, before the credits are spent.
--
--   RESCALE without regenerating. Wrong size is an optimise problem, not a generation
--   problem, and re-optimising costs nothing. So a request has a `kind`.
--
--   HIDING. Scan Studio archives instead of deleting because a failed model is evidence.
--   Same here: `models.archived` takes it out of the library without destroying it.


-- The photo library ------------------------------------------------------------------

create table if not exists captures (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid        not null references tenants (id) on delete cascade,
    -- The engine's identifiers (0007): the item uuid, or a request-made uuid for a dish
    -- not on the menu. Text, so a variant can be named ("with sauce").
    dish        text        not null,
    variant     text        not null default 'default',
    -- Which angle. dataset.SLOTS order: 0 front (primary), 1 right, 2 back, 3 left.
    slot        smallint    not null check (slot between 0 and 3),
    key         text        not null,
    -- Predicted by multiview rather than photographed. Not decoration: at review time it
    -- has to be obvious which parts of a model came from a camera and which from an image
    -- model guessing at the back of a plate.
    generated   boolean     not null default false,
    created_utc timestamptz not null default now(),
    -- One frame per slot per dish. Replacing is an upsert; the old key stays in R2.
    unique (tenant_id, dish, variant, slot)
);

comment on table captures is
    'Every frame ever uploaded, by dish and slot. Kept forever - the photos are the asset '
    'and the model is derived (0007).';

create index if not exists captures_tenant_dish on captures (tenant_id, dish, variant);

alter table captures enable row level security;
alter table captures force  row level security;
drop policy if exists captures_rw on captures;
create policy captures_rw on captures for all
    using (is_member_of(tenant_id)) with check (is_member_of(tenant_id));
grant select, insert, update, delete on captures to authenticated;


-- Multiview, as a task ---------------------------------------------------------------

create table if not exists capture_tasks (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid        not null references tenants (id) on delete cascade,
    dish        text        not null,
    variant     text        not null default 'default',
    kind        text        not null default 'multiview' check (kind in ('multiview')),
    -- The one photo it works from. Refused by the engine if more than one frame exists
    -- by the time it runs: a real photograph beats a predicted one every time.
    source_slot smallint    not null check (source_slot between 0 and 3),
    state       text        not null default 'queued'
                check (state in ('queued', 'running', 'done', 'failed')),
    note        text        not null default '',
    credits     integer     not null default 0,
    requested_by  uuid      references auth.users (id) on delete set null,
    requested_utc timestamptz not null default now(),
    finished_utc  timestamptz
);

comment on table capture_tasks is
    'Multiview: predict three angles from one photo. Free for the owner and once per dish.';

-- ONCE. No state filter on purpose: a failed or cancelled one still counts, or the
-- "once" is a retry loop with a button on it.
create unique index if not exists capture_tasks_once
    on capture_tasks (tenant_id, dish, variant, kind);
create index if not exists capture_tasks_ready on capture_tasks (requested_utc)
    where state = 'queued';

alter table capture_tasks enable row level security;
alter table capture_tasks force  row level security;
drop policy if exists capture_tasks_read   on capture_tasks;
drop policy if exists capture_tasks_insert on capture_tasks;
create policy capture_tasks_read on capture_tasks for select
    using (is_member_of(tenant_id));
create policy capture_tasks_insert on capture_tasks for insert
    with check (is_member_of(tenant_id) and state = 'queued');
grant select, insert on capture_tasks to authenticated;
-- No UPDATE for owners at all: the engine writes the outcome, and there is nothing an
-- owner should change about a task once it exists.

create or replace function capture_task_stamp()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
    new.requested_by := auth.uid();
    new.requested_utc := now();
    new.state := 'queued';
    new.credits := 0;
    return new;
end $fn$;
drop trigger if exists capture_task_stamp on capture_tasks;
create trigger capture_task_stamp before insert on capture_tasks
    for each row execute function capture_task_stamp();


-- Size, and rescaling ----------------------------------------------------------------

alter table model_requests add column if not exists kind text not null default 'generate'
    check (kind in ('generate', 'rescale'));
alter table model_requests add column if not exists scale_cm   numeric(6,2);
alter table model_requests add column if not exists scale_axis text
    check (scale_axis is null or scale_axis in ('width', 'height', 'length'));

comment on column model_requests.kind is
    'generate: photos -> model, costs credits. rescale: re-optimise an existing model at '
    'a new size, costs nothing. The quota counts only generate.';

-- The quota counts generations, because rescales are free and a quota that counted them
-- would charge an owner for our engine having guessed the size wrong.
create or replace function model_requests_used(t uuid)
returns integer language sql stable security definer
set search_path = public, pg_temp as $fn$
    select count(*)::integer from model_requests
     where tenant_id = t and state <> 'cancelled' and kind = 'generate';
$fn$;

-- The gate learns about kinds: a rescale is approved outright.
create or replace function model_request_gate()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
    v_quota integer;
begin
    new.requested_by := auth.uid();
    new.requested_utc := now();
    if new.kind = 'rescale' then
        new.state := 'approved';
        new.decided_utc := now();
        return new;
    end if;
    select model_quota into v_quota from tenants where id = new.tenant_id;
    if model_requests_used(new.tenant_id) < coalesce(v_quota, 0) then
        new.state := 'approved';
        new.decided_utc := now();
    else
        new.state := 'pending';
        new.note := 'Waiting for us to approve this one.';
    end if;
    return new;
end $fn$;

-- One open request per dish still holds, but a rescale must not block a regenerate and
-- vice versa - they are different work on the same dish.
drop index if exists model_requests_one_open;
create unique index if not exists model_requests_one_open
    on model_requests (tenant_id, dish, variant, kind)
    where state in ('pending', 'approved', 'running');


-- Hiding, not deleting ---------------------------------------------------------------

alter table models add column if not exists archived boolean not null default false;

comment on column models.archived is
    'Out of the library without being destroyed. A rejected model is still the evidence '
    'for why the next attempt at that dish is different.';

-- Three free models, not ten. Temo, 2026-09-06: "make first 3 models free and then
-- contact us." Existing restaurants keep whatever they were given.
alter table tenants alter column model_quota set default 3;
