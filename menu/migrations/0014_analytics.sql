-- 0014: analytics that answer the questions people actually ask.
--
-- Temo, 2026-09-06: per-table numbers, and "lets say i wanna know stats of last hour or
-- last 5 days only" - plus a developer view across every restaurant, for us.
--
-- Three changes:
--
-- 1. TIME IS MINUTES, NOT DAYS. `p_days integer` cannot express "the last hour", which is
--    the question you ask on the evening you put the QR codes on the tables. One unit
--    everywhere - 60 is an hour, 7200 is five days - rather than two parameters that can
--    disagree. The old signatures are dropped rather than kept beside the new ones:
--    overloaded analytics functions are how a screen ends up quietly calling the wrong one.
--
-- 2. PER TABLE. The QR codes have carried `?t=<n>` since the day they were generated
--    (share/page.tsx) precisely so this could be added without reprinting anything. The
--    menu page reads it and puts it in the event's meta; this reads it back out.
--
-- 3. A CROSS-RESTAURANT VIEW, for super admins only. Every other function here is scoped
--    by `is_member_of`; this one is scoped by `is_super_admin()` and returns nothing to
--    anybody else.

drop function if exists event_funnel(uuid, integer);
drop function if exists event_top_items(uuid, integer, integer);
drop function if exists event_daily(uuid, integer);
drop function if exists event_3d_lift(uuid, integer);

-- The funnel ---------------------------------------------------------------------------
create or replace function event_funnel(p_tenant uuid, p_minutes integer default 43200)
returns table (name text, sessions bigint, hits bigint)
language sql stable
set search_path = public, pg_temp
as $fn$
    select e.name,
           count(distinct e.session) as sessions,
           count(*)                  as hits
      from events e
     where e.tenant_id = p_tenant
       and is_member_of(p_tenant)          -- the security boundary, not the where-clause
       and e.created_utc > now() - make_interval(mins => greatest(p_minutes, 1))
     group by e.name
$fn$;

-- Which dishes diners actually opened ---------------------------------------------------
create or replace function event_top_items(p_tenant uuid, p_minutes integer default 43200,
                                           p_limit integer default 20)
returns table (item_id uuid, name text, opens bigint, ar bigint)
language sql stable
set search_path = public, pg_temp
as $fn$
    select e.item_id,
           coalesce(i.name, 'deleted dish'),
           count(*) filter (where e.name = 'item_open'),
           count(*) filter (where e.name in ('ar_open', 'ar_placed'))
      from events e
      left join items i on i.id = e.item_id
     where e.tenant_id = p_tenant
       and is_member_of(p_tenant)
       and e.item_id is not null
       and e.created_utc > now() - make_interval(mins => greatest(p_minutes, 1))
     group by e.item_id, i.name
     order by 3 desc
     limit greatest(p_limit, 1)
$fn$;

-- Over time. Buckets follow the range: minutes for an hour, hours for a day, days beyond.
-- A thirty-day chart drawn in minutes is 43,200 bars nobody can read.
create or replace function event_series(p_tenant uuid, p_minutes integer default 43200)
returns table (bucket timestamptz, sessions bigint, opens bigint)
language sql stable
set search_path = public, pg_temp
as $fn$
    select date_trunc(
               case when p_minutes <= 180   then 'minute'
                    when p_minutes <= 4320  then 'hour'      -- up to three days
                    else 'day' end,
               e.created_utc) as bucket,
           count(distinct e.session),
           count(*) filter (where e.name = 'item_open')
      from events e
     where e.tenant_id = p_tenant
       and is_member_of(p_tenant)
       and e.created_utc > now() - make_interval(mins => greatest(p_minutes, 1))
     group by 1
     order by 1
$fn$;

-- The number: dishes with 3D vs without ------------------------------------------------
create or replace function event_3d_lift(p_tenant uuid, p_minutes integer default 43200)
returns table (with_3d numeric, without_3d numeric, dishes_3d bigint, dishes_plain bigint)
language sql stable
set search_path = public, pg_temp
as $fn$
    with opens as (
        select e.item_id, count(distinct e.session) as n
          from events e
         where e.tenant_id = p_tenant
           and e.name = 'item_open'
           and e.item_id is not null
           and e.created_utc > now() - make_interval(mins => greatest(p_minutes, 1))
         group by e.item_id
    )
    select
        round(coalesce(avg(coalesce(o.n, 0)) filter (where i.model_id is not null and i.is_3d), 0), 2),
        round(coalesce(avg(coalesce(o.n, 0)) filter (where i.model_id is null or not i.is_3d), 0), 2),
        count(*) filter (where i.model_id is not null and i.is_3d),
        count(*) filter (where i.model_id is null or not i.is_3d)
      from items i
      left join opens o on o.item_id = i.id
     where i.tenant_id = p_tenant
       and i.visible
       and is_member_of(p_tenant)
$fn$;

-- Per table ----------------------------------------------------------------------------
-- The table number rides in the event's meta as `t`, put there by the menu page from the
-- `?t=` on the QR code. A scan with no table number is counted as "no table" rather than
-- dropped: it is the code on the door or the bill, and that is worth knowing too.
create or replace function event_by_table(p_tenant uuid, p_minutes integer default 43200)
returns table (table_no text, sessions bigint, opens bigint, ar bigint)
language sql stable
set search_path = public, pg_temp
as $fn$
    select coalesce(nullif(e.meta->>'t', ''), '—') as table_no,
           count(distinct e.session),
           count(*) filter (where e.name = 'item_open'),
           count(*) filter (where e.name in ('ar_open', 'ar_placed'))
      from events e
     where e.tenant_id = p_tenant
       and is_member_of(p_tenant)
       and e.created_utc > now() - make_interval(mins => greatest(p_minutes, 1))
     group by 1
     order by 2 desc
$fn$;

grant execute on function event_funnel(uuid, integer)              to authenticated;
grant execute on function event_top_items(uuid, integer, integer)  to authenticated;
grant execute on function event_series(uuid, integer)              to authenticated;
grant execute on function event_3d_lift(uuid, integer)             to authenticated;
grant execute on function event_by_table(uuid, integer)            to authenticated;


-- Ours -----------------------------------------------------------------------------------
-- Every restaurant at once: how many diners, how much 3D, how many models, what is stuck.
-- Scoped by is_super_admin(), so an owner calling it gets an empty set rather than an
-- error they could probe.
create or replace function admin_overview(p_minutes integer default 43200)
returns table (
    tenant_id     uuid,
    slug          text,
    name          text,
    dishes        bigint,
    dishes_3d     bigint,
    models        bigint,
    models_draft  bigint,
    requests_open bigint,
    requests_failed bigint,
    sessions      bigint,
    item_opens    bigint,
    ar_opens      bigint,
    quota         integer,
    quota_used    integer
)
language sql stable security definer
set search_path = public, pg_temp
as $fn$
    select t.id, t.slug, t.name,
           (select count(*) from items i where i.tenant_id = t.id and i.visible),
           (select count(*) from items i where i.tenant_id = t.id and i.visible
                                           and i.model_id is not null and i.is_3d),
           (select count(*) from models m where m.tenant_id = t.id and not m.archived),
           (select count(*) from models m where m.tenant_id = t.id and not m.archived
                                            and m.tenant_state = 'draft'),
           (select count(*) from model_requests r where r.tenant_id = t.id
                     and r.state in ('pending', 'approved', 'running')),
           (select count(*) from model_requests r where r.tenant_id = t.id and r.state = 'failed'),
           (select count(distinct e.session) from events e where e.tenant_id = t.id
                     and e.created_utc > now() - make_interval(mins => greatest(p_minutes, 1))),
           (select count(*) from events e where e.tenant_id = t.id and e.name = 'item_open'
                     and e.created_utc > now() - make_interval(mins => greatest(p_minutes, 1))),
           (select count(*) from events e where e.tenant_id = t.id and e.name = 'ar_open'
                     and e.created_utc > now() - make_interval(mins => greatest(p_minutes, 1))),
           t.model_quota,
           model_requests_used(t.id)
      from tenants t
     where is_super_admin()
     order by t.name
$fn$;

comment on function admin_overview(integer) is
    'Every restaurant, for us. SECURITY DEFINER with is_super_admin() inside, so an owner '
    'gets an empty set rather than an error that tells them the function exists.';

-- What is stuck, across every restaurant. The queue an operator actually watches.
create or replace function admin_queue()
returns table (
    id uuid, tenant_name text, title text, kind text, state text,
    note text, requested_utc timestamptz, minutes_waiting integer
)
language sql stable security definer
set search_path = public, pg_temp
as $fn$
    select r.id, t.name, r.title, r.kind, r.state, r.note, r.requested_utc,
           (extract(epoch from (now() - r.requested_utc)) / 60)::integer
      from model_requests r
      join tenants t on t.id = r.tenant_id
     where is_super_admin()
       and r.state in ('pending', 'approved', 'running', 'failed')
     order by r.requested_utc
$fn$;

revoke all on function admin_overview(integer) from public;
revoke all on function admin_queue() from public;
grant execute on function admin_overview(integer) to authenticated;
grant execute on function admin_queue()           to authenticated;
