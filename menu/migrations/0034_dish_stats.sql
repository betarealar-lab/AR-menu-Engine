-- 0034 · Per-dish numbers: how many people opened each dish in 3D, took it to AR,
-- placed it, added it - and, since 0033, how many scanned its flyer.
--
-- Temo, 2026-09-28: "also add per dish statistics, how many people opened it in 3D and AR
-- and percentages."
--
-- Counts are PEOPLE (distinct sessions), like every percentage on the Analytics screen,
-- except `adds`, which is how many times it went into a basket. Every visible dish is
-- returned, including dishes nobody opened: "which of my 3D dishes does nobody look at"
-- is as useful as the top ten, and a list that only shows dishes with activity hides it.
--
-- The screen computes the percentages from these counts plus `visitors`:
--   opened in 3D    opens / visitors        (of everyone who opened the menu)
--   reached AR      ar / opens              (of the people who opened THIS dish)
--   placed          placed / ar
--
-- `scans` is a view whose event carries the dish - only a dish page (/p/<token>) sends
-- one, so it is exactly "people who scanned this dish's flyer or poster".

create or replace function dish_stats(
    p_tenant uuid,
    p_from   timestamptz,
    p_to     timestamptz
) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $fn$
declare
    v_out jsonb;
begin
    if not is_member_of(p_tenant) then
        return null;
    end if;
    if p_to <= p_from or p_to - p_from > interval '400 days' then
        return null;
    end if;

    with ev as (
        select e.session, e.name, e.item_id, e.meta
          from events e
         where e.tenant_id = p_tenant
           and e.created_utc >= p_from and e.created_utc < p_to
    ),
    per as (
        select item_id,
               count(distinct session) filter (where name = 'item_open')                as opens,
               count(distinct session) filter (where name in ('ar_open', 'ar_placed'))  as ar,
               count(distinct session) filter (where name = 'ar_placed')                as placed,
               count(*)                filter (where name = 'basket_add')               as adds,
               count(distinct session) filter (where name = 'view')                     as scans,
               round(avg(least((meta->>'duration_ms')::numeric, 600000) / 1000.0)
                     filter (where name = 'item_close'
                               and (meta->>'duration_ms') ~ '^[0-9]+(\.[0-9]+)?$'
                               and (meta->>'duration_ms')::numeric >= 300), 1)          as avg_3d_s
          from ev
         where item_id is not null
         group by item_id
    )
    select jsonb_build_object(
        'visitors', (select count(distinct session) from ev where name = 'view'),
        'items', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', i.id, 'name', i.name,
                       'has_3d', i.model_id is not null and i.is_3d,
                       'opens', coalesce(p.opens, 0), 'ar', coalesce(p.ar, 0),
                       'placed', coalesce(p.placed, 0), 'adds', coalesce(p.adds, 0),
                       'scans', coalesce(p.scans, 0), 'avg_3d_s', p.avg_3d_s)
                   order by coalesce(p.opens, 0) desc, coalesce(p.scans, 0) desc, i.name)
              from items i
              left join per p on p.item_id = i.id
             where i.tenant_id = p_tenant and i.visible), '[]'::jsonb)
    ) into v_out;
    return v_out;
end $fn$;

revoke all on function dish_stats(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function dish_stats(uuid, timestamptz, timestamptz) to authenticated;

comment on function dish_stats(uuid, timestamptz, timestamptz) is
    'Per visible dish, for one window: people who opened it in 3D, reached AR, placed it, '
    'scanned its dish page; basket adds; typical seconds in 3D. Members only (0034).';
