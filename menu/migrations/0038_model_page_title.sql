-- 0038 · A model page's title falls back to the dish it is on.
--
-- Most models made before the library had a title field were never given one: their name
-- lives on the dish that uses them. 0037 fell back to "BetaReal", which is a page titled
-- with our name instead of the food. The dish's name is the better fallback; ours is last.

create or replace function resolve_model_link(p_token text)
returns table (
    model_id uuid, title text, description text, draco_key text, usdz_key text,
    poster_key text, external_glb text, external_usdz text, view_orbit text, tenant_id uuid
)
language sql stable security definer
set search_path = public, pg_temp as $fn$
    select m.id,
           coalesce(nullif(m.title, ''),
                    (select i.name from items i where i.model_id = m.id order by i.created_utc limit 1),
                    'BetaReal'),
           coalesce(nullif(m.description, ''),
                    (select i.description from items i where i.model_id = m.id
                      and coalesce(i.description, '') <> '' order by i.created_utc limit 1),
                    ''),
           m.draco_key, m.usdz_key, m.poster_key, m.external_glb, m.external_usdz, m.view_orbit, m.tenant_id
      from model_links l
      join models m on m.id = l.model_id
     where l.token = lower(p_token)
       and l.active
       and m.tenant_state = 'approved'
       and not m.archived
     limit 1
$fn$;

revoke all on function resolve_model_link(text) from public;
grant execute on function resolve_model_link(text) to anon, authenticated;
