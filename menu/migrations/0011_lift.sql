-- 0011: the number.
--
-- "Dishes with a 3D model get opened 2.4x more often than dishes without one." That is the
-- retention argument, made by a restaurant's own diners, and it is the first thing on the
-- home screen. It gets its own function so the definition of "more often" lives in one
-- place and cannot quietly differ between the home screen, the analytics screen and
-- whatever ends up in a sales deck.
--
-- Counted PER DISH, PER SESSION. Not per hit: one diner opening a dish four times is one
-- diner who opened it. Not per group: a restaurant with one 3D dish and thirty photo
-- dishes would otherwise compare one dish's opens against thirty dishes' opens and call
-- the 3D one thirty times worse. The average is over dishes, and every visible dish is in
-- the average, including the ones nobody opened - a dish with zero opens is a fact about
-- the dish, not a row to skip.

create or replace function event_3d_lift(p_tenant uuid, p_days integer default 30)
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
           and e.created_utc > now() - make_interval(days => greatest(p_days, 1))
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
       and is_member_of(p_tenant)          -- the security boundary, inside the function
$fn$;

comment on function event_3d_lift(uuid, integer) is
    'Average opens per dish, per session, for dishes with 3D vs without. Over dishes, '
    'including the ones nobody opened.';

revoke all on function event_3d_lift(uuid, integer) from public;
grant execute on function event_3d_lift(uuid, integer) to authenticated;
