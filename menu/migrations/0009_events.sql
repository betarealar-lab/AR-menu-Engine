-- 0009: what diners actually do.
--
-- MENU-PLATFORM §2.5 said events go to an append-only sink and deliberately did not build
-- one. This is it, and it exists because the numbers we already have are the most useful
-- thing anybody has told us about the product: on the live menu, about 74% of diners get
-- past the hero, ~13% open a dish in 3D and ~5% reach AR. Every argument about what to
-- build next is really an argument about those three numbers, and right now they come from
-- one restaurant read by hand.
--
-- ── the shape ─────────────────────────────────────────────────────────────────────────
--
-- Raw rows, aggregated by query. NOT a pre-rolled summary table, yet: a rollup is easy to
-- add when volume demands it and impossible to reconstruct if the raw rows were never
-- kept. What IS impossible to retrofit is capturing the wrong things, so the funnel is
-- named here and the session id is captured from the first event.
--
-- ── who may write ─────────────────────────────────────────────────────────────────────
--
-- A diner is anonymous, so this has to accept writes from nobody in particular. It does
-- NOT do that by granting `anon` an INSERT: an open write endpoint on a table is a table
-- somebody fills with garbage at their leisure. `anon` may call one function, that
-- function validates and bounds everything it writes, and the table itself stays closed.
--
-- ── what is deliberately not here ─────────────────────────────────────────────────────
--
-- No IP address, no user agent, no device fingerprint, no anything that identifies a
-- person. A session id is a random string the page forgets when the tab closes. This is
-- enough to count a funnel and not enough to follow anybody, and that is the whole
-- intended ceiling - a menu that watched its diners would be a menu no restaurant should
-- put a QR code on.

create table if not exists events (
    id          bigserial primary key,
    tenant_id   uuid        not null references tenants (id) on delete cascade,

    -- Random, per tab, forgotten when it closes. Its only job is to tell one diner
    -- opening four dishes apart from four diners opening one each.
    session     text        not null check (char_length(session) between 8 and 64),

    name        text        not null,
    -- Which dish, where the event is about one. Null for page-level events. `set null`
    -- rather than cascade: a deleted dish must not erase the fact that people looked at it.
    item_id     uuid        references items (id) on delete set null,

    -- Room for the one extra fact an event needs - which category, which delivery link -
    -- without a migration per event type. Bounded by the function, not by trust.
    meta        jsonb       not null default '{}'::jsonb,

    created_utc timestamptz not null default now()
);

comment on table events is
    'Append-only. No IP, no user agent, no fingerprint - enough to count a funnel and not '
    'enough to follow anybody.';

-- Every dashboard query is "this restaurant, this date range", so that is the index.
create index if not exists events_tenant_time on events (tenant_id, created_utc desc);
create index if not exists events_tenant_name on events (tenant_id, name, created_utc desc);

alter table events enable row level security;
alter table events force  row level security;

drop policy if exists events_read on events;
create policy events_read on events for select using (is_member_of(tenant_id));

grant select on events to authenticated;
-- Note what is NOT granted: nobody has INSERT on this table, including `authenticated`.
-- The only way a row gets in is the function below.


-- The one write path -------------------------------------------------------------------

create or replace function record_events(
    p_tenant  uuid,
    p_session text,
    p_events  jsonb
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_row   jsonb;
    v_name  text;
    v_item  uuid;
    v_count integer := 0;
begin
    -- A tenant that does not exist is the shape of somebody poking at the endpoint, and
    -- writing those rows would mean the table grows without any restaurant to show them to.
    if not exists (select 1 from tenants where id = p_tenant) then
        return 0;
    end if;
    if p_session is null or char_length(p_session) not between 8 and 64 then
        return 0;
    end if;

    -- A page sends a handful per flush. The cap is what stops one request being a million
    -- rows, and it is silent rather than an error: a diner must never see an analytics
    -- failure, and a caller who sent too many is not somebody worth talking to.
    for v_row in
        select value from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) limit 50
    loop
        v_name := left(coalesce(v_row->>'name', ''), 40);

        -- A whitelist, not a length check. An open `name` column becomes a junk drawer
        -- within a year, and then no query can be trusted because nobody knows which
        -- spellings of "opened the 3D" are in there.
        if v_name not in ('view', 'hero_pass', 'category', 'item_open', 'ar_open',
                          'ar_placed', 'delivery', 'lang', 'theme') then
            continue;
        end if;

        begin
            v_item := nullif(v_row->>'item', '')::uuid;
        exception when others then
            v_item := null;
        end;

        -- The item must belong to this restaurant. Without that, an id from anywhere could
        -- be attached to anyone's analytics.
        if v_item is not null
           and not exists (select 1 from items where id = v_item and tenant_id = p_tenant)
        then
            v_item := null;
        end if;

        insert into events (tenant_id, session, name, item_id, meta)
        values (p_tenant, p_session, v_name, v_item,
                case when jsonb_typeof(v_row->'meta') = 'object'
                     then v_row->'meta' else '{}'::jsonb end);
        v_count := v_count + 1;
    end loop;

    return v_count;
end $fn$;

comment on function record_events(uuid, text, jsonb) is
    'The ONLY way a row reaches `events`. Validates the tenant, bounds the batch, and '
    'whitelists the event name - an open name column is a junk drawer within a year.';

revoke all on function record_events(uuid, text, jsonb) from public;
-- `anon` deliberately: a diner is not signed in, and this is the one thing they may do.
grant execute on function record_events(uuid, text, jsonb) to anon, authenticated;


-- Reading it back ----------------------------------------------------------------------

-- The funnel, in one query, for one restaurant. A view rather than SQL typed into a screen
-- so that the definition of "a session that reached AR" lives in one place and cannot
-- quietly differ between the dashboard and whatever we paste into a report.
create or replace function event_funnel(p_tenant uuid, p_days integer default 30)
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
       and e.created_utc > now() - make_interval(days => greatest(p_days, 1))
     group by e.name
$fn$;

-- Which dishes diners actually opened in 3D. The question every restaurant asks first, and
-- the one that decides which dish is worth the next 30 credits.
create or replace function event_top_items(p_tenant uuid, p_days integer default 30,
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
       and e.created_utc > now() - make_interval(days => greatest(p_days, 1))
     group by e.item_id, i.name
     order by 3 desc
     limit greatest(p_limit, 1)
$fn$;

-- Sessions per day, for the one chart worth drawing.
create or replace function event_daily(p_tenant uuid, p_days integer default 30)
returns table (day date, sessions bigint, opens bigint)
language sql stable
set search_path = public, pg_temp
as $fn$
    select (e.created_utc at time zone 'UTC')::date as day,
           count(distinct e.session),
           count(*) filter (where e.name = 'item_open')
      from events e
     where e.tenant_id = p_tenant
       and is_member_of(p_tenant)
       and e.created_utc > now() - make_interval(days => greatest(p_days, 1))
     group by 1
     order by 1
$fn$;

grant execute on function event_funnel(uuid, integer)             to authenticated;
grant execute on function event_top_items(uuid, integer, integer) to authenticated;
grant execute on function event_daily(uuid, integer)              to authenticated;
