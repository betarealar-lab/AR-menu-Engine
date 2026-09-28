-- 0035 · Only 3D dishes have a page.
--
-- Temo, 2026-09-28: "only 3d models need to have QR." A dish page exists to put a dish on
-- somebody's table in AR; a photo dish on a flyer is just a photo, and a QR that opens one
-- dish's photo is not the product.
--
-- `dish_links` rows still exist for every dish (0033 creates one per dish), because a
-- photo dish that gets its model next week should get its address then without anybody
-- remembering to make one - and that address must not change the day it goes 3D. What
-- changes is that the address only RESOLVES while the dish is really 3D: `is_3d` on, a
-- model attached, and that model approved and one this restaurant may show (its own, or
-- from the library) - the same rule `public_menu` uses to put 3D in front of a diner.

create or replace function resolve_dish_link(p_token text)
returns table (slug text, item_id uuid)
language sql stable security definer
set search_path = public, pg_temp as $fn$
    select t.slug, l.item_id
      from dish_links l
      join tenants t on t.id = l.tenant_id
      join items i on i.id = l.item_id and i.visible and i.is_3d
      join models m on m.id = i.model_id
                   and m.tenant_state = 'approved'
                   and (m.tenant_id = i.tenant_id or m.shared)
      left join tenant_embed te on te.tenant_id = l.tenant_id
     where l.token = lower(p_token)
       and l.active
       and coalesce(te.pages_active, true)
     limit 1
$fn$;

revoke all on function resolve_dish_link(text) from public;
grant execute on function resolve_dish_link(text) to anon, authenticated;
