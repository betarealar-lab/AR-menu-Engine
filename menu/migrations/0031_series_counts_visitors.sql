-- 0031 · The over-time chart counts the same visitors as the tiles above it.
--
-- `event_series` (0014) counted distinct sessions of ANY event. Since 0028 that includes
-- `embed_view` - a dish seen on the restaurant's own website - so a restaurant whose only
-- traffic was its embed (demo-kitchen: 41 embed views, 0 menu opens) showed a chart
-- peaking near 30 "visitors" directly under a tile reading Visitors 0. Found by looking at
-- the redesigned Analytics screen, 2026-09-28.
--
-- A menu visitor is a session with a `view`, the same rule `event_funnel` uses for the
-- top of the funnel. Embed traffic gets its own card on the screen instead of being mixed
-- in here.

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
           count(distinct e.session) filter (where e.name = 'view'),
           count(*) filter (where e.name = 'item_open')
      from events e
     where e.tenant_id = p_tenant
       and is_member_of(p_tenant)
       and e.created_utc > now() - make_interval(mins => greatest(p_minutes, 1))
     group by 1
     order by 1
$fn$;

grant execute on function event_series(uuid, integer) to authenticated;
