-- 0017: let the basket be counted.
--
-- The menu got a working basket on 2026-09-07 and has been firing five events ever since -
-- `basket_add`, `basket_remove`, `basket_open`, `basket_clear`, `waiter_qr`. Not one of
-- them was ever stored. `record_events` (0009) whitelists nine names and none of those five
-- is on it, so every one was dropped one layer below the place anybody would look for it.
--
-- Silently is the point, and the design is right: an open `name` column becomes a junk
-- drawer within a year and then no query can be trusted, so the whitelist must reject what
-- it does not know. What went wrong is that the menu was taught to send names the database
-- had never been told to accept, and nothing connected the two. `check_features.py` now
-- reads the names out of the built bundle AND out of this function, and fails if they
-- disagree - which is the part that stops this recurring.
--
-- **What was lost.** `basket_add` carries the number this company is a bet on, in its meta:
--
--     after_3d   the diner had already opened this dish in the 3D viewer
--     after_ar   the diner had already put this dish on their table in AR
--
-- That is the entire claim - that seeing a dish in 3D makes somebody order it - and it was
-- being thrown away at the door. Nothing is recoverable; counting starts now.
--
-- The function below is 0009's, unchanged except for the five names. Deliberately a copy
-- rather than a rewrite: the session-length check, the tenant check, the batch cap, the
-- item-belongs-to-tenant rule and the integer return are all load-bearing and none of them
-- is what this migration is about.

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
        --
        -- The five basket names are 0017's addition. The nine above them are 0009's,
        -- unchanged.
        if v_name not in ('view', 'hero_pass', 'category', 'item_open', 'ar_open',
                          'ar_placed', 'delivery', 'lang', 'theme',
                          'basket_add', 'basket_remove', 'basket_open', 'basket_clear',
                          'waiter_qr') then
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
    'whitelists the event name - an open name column is a junk drawer within a year. '
    '0017 added the five basket names.';

revoke all on function record_events(uuid, text, jsonb) from public;
-- `anon` deliberately: a diner is not signed in, and this is the one thing they may do.
grant execute on function record_events(uuid, text, jsonb) to anon, authenticated;


-- Did 3D sell the dish? One row per restaurant, per day.
--
-- `after_3d` and `after_ar` are set by the page at the moment the diner tapped add, so this
-- is not a join across sessions and a guess about ordering - it is what happened, recorded
-- in the right order by the thing that watched it happen.
create or replace view basket_lift as
select e.tenant_id,
       (e.created_utc at time zone 'UTC')::date                   as day,
       count(*)                                                   as adds,
       count(*) filter (where (e.meta->>'after_3d')::boolean)     as after_3d,
       count(*) filter (where (e.meta->>'after_ar')::boolean)     as after_ar,
       count(distinct e.session)                                  as sessions
from events e
where e.name = 'basket_add'
group by e.tenant_id, (e.created_utc at time zone 'UTC')::date;

comment on view basket_lift is
    'basket adds per restaurant per day, split by whether the diner had already seen that '
    'dish in 3D or in AR. The claim the product is sold on, measured.';
