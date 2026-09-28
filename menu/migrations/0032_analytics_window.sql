-- 0032 · Analytics over any window, and the numbers owners asked for next.
--
-- Temo, 2026-09-28: "add yesterday option. also more relevant stats like avg time spent."
--
-- 1. **Any window, not "the last N minutes".** Every function in 0014 counts back from
--    now(), so "yesterday" - 00:00 to 24:00 on the restaurant's clock - could not be asked
--    at all. `analytics()` takes a FROM and a TO and a time zone, and the screen computes
--    "today", "yesterday" and any date range from the owner's own calendar.
--
-- 2. **One call, one JSON object.** The screen used to make six round trips; it now makes
--    two (this window and the one before it, for the deltas) and every number on it comes
--    from the same snapshot of the same rows, so no two cards can disagree.
--
-- 3. **Time.** Two new event names, both sent by the menu since this migration's build:
--      leave       visible milliseconds on the menu since it was last shown (meta.ms)
--      item_close  milliseconds a dish was held open in 3D (meta.duration_ms)
--    Time on the menu per session is the sum of its `leave` rows; for sessions from before
--    `leave` existed it falls back to first-to-last event, which UNDER-counts (it cannot
--    see the reading after the last tap) and is labelled as a floor on the screen.
--
-- 4. **Context on `view`** (meta.d device, meta.src where from, meta.pl phone language) -
--    three facts a restaurant cannot get from anywhere else. Old rows have none, and are
--    reported as "not recorded" rather than guessed.
--
-- 5. **3D -> basket.** Of the (diner, dish) pairs opened in 3D, how many were then added
--    to the basket. The number the whole company is a bet on, and it was computable from
--    rows we already had.
--
-- The 0014 functions are left in place: nothing else calls them, and dropping a function a
-- deployed admin still calls is how a deploy order becomes an outage.


-- ── 1. the whitelist learns two names ──────────────────────────────────────────────────

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
    if not exists (select 1 from tenants where id = p_tenant) then
        return 0;
    end if;
    if p_session is null or char_length(p_session) not between 8 and 64 then
        return 0;
    end if;

    for v_row in
        select value from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) limit 50
    loop
        v_name := left(coalesce(v_row->>'name', ''), 40);

        -- A whitelist, not a length check. An open `name` column becomes a junk drawer
        -- within a year, and then no query can be trusted because nobody knows which
        -- spellings of "opened the 3D" are in there.
        --
        -- The five basket names are 0017's addition, the three embed names 0028's, `leave`
        -- and `item_close` 0032's. The nine above them are 0009's, unchanged.
        if v_name not in ('view', 'hero_pass', 'category', 'item_open', 'ar_open',
                          'ar_placed', 'delivery', 'lang', 'theme',
                          'basket_add', 'basket_remove', 'basket_open', 'basket_clear',
                          'waiter_qr',
                          'embed_view', 'embed_3d', 'embed_ar',
                          'leave', 'item_close') then
            continue;
        end if;

        begin
            v_item := nullif(v_row->>'item', '')::uuid;
        exception when others then
            v_item := null;
        end;

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
    'whitelists the event name - an open name column is a junk drawer within a year. '
    '0017 added the five basket names, 0028 the three embed names, 0032 leave/item_close.';

revoke all on function record_events(uuid, text, jsonb) from public;
grant execute on function record_events(uuid, text, jsonb) to anon, authenticated;


-- ── 2. everything the Analytics screen shows, for one window ───────────────────────────

create or replace function analytics(
    p_tenant uuid,
    p_from   timestamptz,
    p_to     timestamptz,
    p_tz     text default 'Asia/Tbilisi'
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_tz   text := p_tz;
    v_unit text;
    v_out  jsonb;
begin
    -- The security boundary. SECURITY DEFINER so the aggregates run in one pass without
    -- RLS re-checking every row; this line is what keeps that safe.
    if not is_member_of(p_tenant) then
        return null;
    end if;
    if p_to <= p_from or p_to - p_from > interval '400 days' then
        return null;
    end if;
    -- An unknown zone would raise; a typo in a browser's zone name must not break the page.
    if not exists (select 1 from pg_timezone_names where name = v_tz) then
        v_tz := 'UTC';
    end if;
    v_unit := case when p_to - p_from <= interval '3 hours' then 'minute'
                   when p_to - p_from <= interval '3 days'  then 'hour'
                   else 'day' end;

    with ev as (
        select e.session, e.name, e.item_id, e.meta, e.created_utc
          from events e
         where e.tenant_id = p_tenant
           and e.created_utc >= p_from and e.created_utc < p_to
    ),
    views as (
        -- One row per menu visitor, with the context of their first view.
        select distinct on (session) session, meta
          from ev where name = 'view'
         order by session, created_utc
    ),
    sess_time as (
        select v.session,
               coalesce(
                   (select sum(least(greatest((l.meta->>'ms')::numeric, 0), 10800000)) / 1000.0
                      from ev l where l.session = v.session and l.name = 'leave'
                       and (l.meta->>'ms') ~ '^[0-9]+(\.[0-9]+)?$'),
                   -- The fallback is capped at 30 minutes: a tab left open on a table
                   -- from lunch to dinner is not a 5-hour read, and one of those dragged
                   -- JAPAN's average to 52 minutes when this was first run.
                   (select least(extract(epoch from max(a.created_utc) - min(a.created_utc)), 1800)
                      from ev a where a.session = v.session)
               ) as secs,
               exists (select 1 from ev l where l.session = v.session and l.name = 'leave') as measured
          from views v
    ),
    closes as (
        select item_id, (meta->>'duration_ms')::numeric / 1000.0 as secs
          from ev
         where name = 'item_close'
           and (meta->>'duration_ms') ~ '^[0-9]+(\.[0-9]+)?$'
           and (meta->>'duration_ms')::numeric between 300 and 600000
    ),
    opened as (
        select session, item_id, min(created_utc) as at
          from ev where name = 'item_open' and item_id is not null
         group by session, item_id
    ),
    added as (
        select session, item_id, min(created_utc) as at
          from ev where name = 'basket_add' and item_id is not null
         group by session, item_id
    )
    select jsonb_build_object(
        'unit', v_unit,
        'tz', v_tz,

        'funnel', (select coalesce(jsonb_object_agg(name, n), '{}'::jsonb) from (
                     select name, count(distinct session) as n from ev group by name) f),
        'hits', (select coalesce(jsonb_object_agg(name, n), '{}'::jsonb) from (
                     select name, count(*) as n from ev group by name) h),

        'time', (select jsonb_build_object(
                    'sessions', count(*),
                    'measured', count(*) filter (where measured),
                    'avg_s', round(avg(secs)::numeric, 1),
                    'median_s', round((percentile_cont(0.5) within group (order by secs))::numeric, 1),
                    'under_10s', count(*) filter (where secs < 10),
                    'over_2m', count(*) filter (where secs >= 120))
                  from sess_time where secs is not null),

        'time_3d', (select jsonb_build_object(
                    'closes', count(*),
                    'avg_s', round(avg(secs)::numeric, 1),
                    'median_s', round((percentile_cont(0.5) within group (order by secs))::numeric, 1))
                  from closes),

        'basket', (select jsonb_build_object(
                    'sessions', (select count(distinct session) from ev where name = 'basket_add'),
                    'adds', (select count(*) from ev where name = 'basket_add'),
                    'waiter', (select count(distinct session) from ev where name = 'waiter_qr'),
                    'opened_pairs', (select count(*) from opened),
                    'opened_then_added', (select count(*) from opened o join added a
                                            on a.session = o.session and a.item_id = o.item_id
                                           and a.at >= o.at))),

        'series', (select coalesce(jsonb_agg(jsonb_build_object('b', b, 'v', v, 'o', o) order by b), '[]'::jsonb)
                   from (select date_trunc(v_unit, created_utc at time zone v_tz) as b,
                                count(distinct session) filter (where name = 'view') as v,
                                count(*) filter (where name = 'item_open') as o
                           from ev group by 1) s),

        'hours', (select coalesce(jsonb_agg(jsonb_build_object('h', h, 'v', v) order by h), '[]'::jsonb)
                  from (select extract(hour from created_utc at time zone v_tz)::int as h,
                               count(distinct session) as v
                          from ev where name = 'view' group by 1) x),

        'devices', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) order by v desc), '[]'::jsonb)
                    from (select coalesce(nullif(meta->>'d', ''), '?') as k, count(*) as v
                            from views group by 1) x),
        'sources', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) order by v desc), '[]'::jsonb)
                    from (select case when meta ? 't' then 'table'
                                      else coalesce(nullif(meta->>'src', ''), '?') end as k,
                                 count(*) as v
                            from views group by 1) x),
        'langs', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) order by v desc), '[]'::jsonb)
                  from (select coalesce(nullif(meta->>'pl', ''), '?') as k, count(*) as v
                          from views group by 1) x),

        'items', (select coalesce(jsonb_agg(to_jsonb(x) order by x.opens desc, x.name), '[]'::jsonb) from (
                    select i.id, coalesce(i.name, 'deleted dish') as name,
                           count(distinct e.session) filter (where e.name = 'item_open') as opens,
                           count(distinct e.session) filter (where e.name in ('ar_open', 'ar_placed')) as ar,
                           count(*) filter (where e.name = 'basket_add') as adds,
                           (select round(avg(c.secs)::numeric, 1) from closes c where c.item_id = i.id) as avg_3d_s
                      from ev e
                      left join items i on i.id = e.item_id
                     where e.item_id is not null
                     group by i.id, i.name
                     order by 3 desc, 5 desc
                     limit 12) x),

        'tables', (select coalesce(jsonb_agg(to_jsonb(x) order by x.v desc), '[]'::jsonb) from (
                     select coalesce(nullif(meta->>'t', ''), '—') as t,
                            count(distinct session) as v,
                            count(*) filter (where name = 'item_open') as o,
                            count(*) filter (where name in ('ar_open', 'ar_placed')) as ar
                       from ev group by 1) x),

        'lift', (with opens as (
                     select item_id, count(distinct session) as n
                       from ev where name = 'item_open' and item_id is not null
                      group by item_id)
                 select jsonb_build_object(
                     'with_3d', round(coalesce(avg(coalesce(o.n, 0)) filter (where i.model_id is not null and i.is_3d), 0), 2),
                     'without_3d', round(coalesce(avg(coalesce(o.n, 0)) filter (where i.model_id is null or not i.is_3d), 0), 2),
                     'dishes_3d', count(*) filter (where i.model_id is not null and i.is_3d),
                     'dishes_plain', count(*) filter (where i.model_id is null or not i.is_3d))
                   from items i left join opens o on o.item_id = i.id
                  where i.tenant_id = p_tenant and i.visible)
    ) into v_out;

    return v_out;
end $fn$;

revoke all on function analytics(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function analytics(uuid, timestamptz, timestamptz, text) to authenticated;

comment on function analytics(uuid, timestamptz, timestamptz, text) is
    'Everything the Analytics screen shows for one window [from, to), bucketed in the '
    'restaurant''s time zone. Members and super admins only; anyone else gets NULL (0032).';
