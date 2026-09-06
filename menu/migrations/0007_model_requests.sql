-- 0007: a restaurant asking for a 3D model.
--
-- This table is the ONLY thing the menu platform and the engine share. The platform
-- records what a restaurant asked for; the engine decides how it gets made. Neither
-- imports the other, and the word "Meshy" appears nowhere in this schema.
--
-- That boundary is the point. The engine is going to change - a second engine, a
-- self-hosted one at a fraction of the cost, a re-run of every dish through something
-- better in a year. Every one of those is an engine change and none of them is a platform
-- change, as long as the contract is "here is a dish and its photos" and not "here is a
-- job for the queue".
--
-- Three things that are cheap now and impossible to retrofit:
--
-- 1. THE PHOTOS OUTLIVE THE MODEL. `photo_keys` is kept forever, including after the
--    model is built and after it is replaced. A better engine in a year is worth nothing
--    if we cannot find the inputs, and the inputs are the asset - the model is derived.
--
-- 2. GENERATING COSTS REAL MONEY. 30 credits a go. A self-serve button with no cap is a
--    faucet pointed at our own bank account the moment there are fifty restaurants
--    instead of two, and a quota added AFTER owners have had it free is a fight. So a
--    request is approved by quota, in a trigger, where nobody can reach around it.
--
-- 3. DISH IDS MUST NOT COLLIDE ACROSS RESTAURANTS. The engine keys its storage on
--    slug(dish), and slug of "Khachapuri" is the same string for every restaurant in
--    Georgia. Two tenants asking for the same dish would silently share one R2 prefix and
--    overwrite each other model. `dish` here is the ITEM UUID, not its name - unique
--    forever, and the human name travels separately as the title.

create table if not exists model_requests (
    id           uuid primary key default gen_random_uuid(),
    tenant_id    uuid        not null references tenants (id) on delete cascade,
    -- Nullable: a restaurant may build a library before it has a menu to hang it on.
    item_id      uuid        references items (id) on delete set null,

    -- The engine own identifiers, so the queue, the Scan Studio, `models` and this table
    -- all name the same thing the same way. `dish` is a uuid on purpose (see 3).
    dish         text        not null,
    variant      text        not null default 'default',
    -- What a person calls it. dataset.py already separates the two for this reason.
    title        text        not null default '',

    -- R2 keys, in capture order: front, right, back, left (dataset.SLOTS). Keys and not
    -- URLs - the bucket is private and a URL here would be a URL that expires.
    photo_keys   text[]      not null default '{}',

    -- pending    asked for, over quota, waiting on us
    -- approved   cleared to run; the engine may claim it
    -- running    the engine has it
    -- done       `model_id` points at the result
    -- failed     `note` says what a restaurant should be told, in their words
    -- cancelled  withdrawn before it cost anything
    state        text        not null default 'pending'
                 check (state in ('pending', 'approved', 'running',
                                  'done', 'failed', 'cancelled')),
    note         text        not null default '',

    -- Which engine ran it, and what it cost. Not for billing - for knowing, when there
    -- are three engines, which one is actually worth its credits.
    engine       text,
    credits      integer     not null default 0,

    model_id     uuid        references models (id) on delete set null,

    requested_by  uuid       references auth.users (id) on delete set null,
    requested_utc timestamptz not null default now(),
    decided_utc   timestamptz,
    finished_utc  timestamptz
);

comment on table model_requests is
    'The contract between the menu platform and the engine. The platform writes what was '
    'asked for; the engine writes what happened. Neither imports the other.';

create index if not exists model_requests_tenant on model_requests (tenant_id, state);

-- The engine claim query. Oldest first, so a restaurant that asked yesterday is not
-- overtaken forever by one that asks every hour.
create index if not exists model_requests_ready
    on model_requests (requested_utc) where state = 'approved';

-- One open request per dish. Without this a double-tap on a slow connection is two
-- generations and sixty credits for one plate of food.
create unique index if not exists model_requests_one_open
    on model_requests (tenant_id, dish, variant)
    where state in ('pending', 'approved', 'running');


-- The quota, enforced where nobody can reach around it ---------------------------------

alter table tenants add column if not exists model_quota integer not null default 10;

comment on column tenants.model_quota is
    'How many generations this restaurant may set off without us saying yes. Raised per '
    'tenant when they are paying for it. The cap exists so self-serve cannot outspend us.';

create or replace function model_requests_used(t uuid)
returns integer language sql stable security definer
set search_path = public, pg_temp as $fn$
    -- Cancelled costs nothing. Failed DOES count: it spent the credits either way, and a
    -- quota that resets on failure is a quota with a retry loop through it.
    select count(*)::integer from model_requests
     where tenant_id = t and state <> 'cancelled';
$fn$;

create or replace function model_request_gate()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
    v_quota integer;
begin
    select model_quota into v_quota from tenants where id = new.tenant_id;
    -- Under quota it just runs: a restaurant that has to wait for a human to press a
    -- button is not self-serve, and the whole point of the cap is that it can be trusted.
    if model_requests_used(new.tenant_id) < coalesce(v_quota, 0) then
        new.state := 'approved';
        new.decided_utc := now();
    else
        new.state := 'pending';
        new.note := 'Waiting for us to approve this one.';
    end if;
    new.requested_by := auth.uid();
    new.requested_utc := now();
    return new;
end $fn$;

comment on function model_request_gate() is
    'Runs on INSERT, before the row lands. The state a request starts in is decided HERE '
    'and not by whatever the client sent - see the column grants below.';

drop trigger if exists model_request_gate on model_requests;
create trigger model_request_gate before insert on model_requests
    for each row execute function model_request_gate();


-- Who may do what ----------------------------------------------------------------------

alter table model_requests enable row level security;
alter table model_requests force  row level security;

drop policy if exists model_requests_read   on model_requests;
drop policy if exists model_requests_insert on model_requests;
drop policy if exists model_requests_update on model_requests;

create policy model_requests_read on model_requests for select
    using (is_member_of(tenant_id));

create policy model_requests_insert on model_requests for insert
    with check (is_member_of(tenant_id));

-- An owner may withdraw a request. They may not approve one, and they may not mark one
-- done. `with check` is evaluated against the row as it WOULD BE, so this is the whole
-- enforcement: no path from here reaches 'approved'.
create policy model_requests_update on model_requests for update
    using (is_member_of(tenant_id))
    with check (is_member_of(tenant_id) and state in ('pending', 'cancelled'));

grant select, insert on model_requests to authenticated;

-- Column-level, deliberately. An owner may cancel; they may not rewrite the photos of a
-- request the engine is already running, or edit what an engine said it cost. This is
-- simpler and harder to get wrong than a second trigger.
grant update (state) on model_requests to authenticated;

-- The engine reads and writes this table with the service key, which bypasses RLS - it is
-- a trusted backend process, not a request handler. That distinction is the entire reason
-- the service key is allowed to exist.
