-- 0015: one function a diner's page may call, and nothing else.
--
-- The menu app holds `SUPABASE_DB_URL` today: a direct Postgres connection that bypasses
-- row-level security entirely. That is the app serving PUBLIC pages. It works, and it has
-- been fine while everything ran on one laptop, but it is the wrong credential in the
-- wrong place - the public-facing half of the system should hold the weakest key that can
-- do its job, not the strongest one in the building.
--
-- It also cannot go to Cloudflare Workers as it stands: raw TCP to Postgres needs
-- Hyperdrive or a socket shim, and neither is worth carrying to avoid this function.
--
-- So: `public_menu(slug)` returns exactly what a diner's page renders, as one JSON
-- document, and `anon` may call it. No table is readable, no other restaurant is
-- reachable, and there is nothing to enumerate - it takes a slug, which is already public
-- (it is in the URL).
--
-- **What it deliberately leaves out** is as much the point as what it returns:
--
--   hidden items                 `visible` is the owner's switch and it is honoured here
--   unapproved models            DECISIONS §9.4 - only the owner's yes puts a model in
--                                front of a diner, so tenant_state must be 'approved'
--   hidden categories            same rule as items
--   anything about other tenants a slug names one restaurant and returns one restaurant
--   who owns it, who edits it    a diner has no business knowing
--
-- One round trip instead of three, which also removes the two-query fan-out the JS was
-- doing by hand.

create or replace function public_menu(p_slug text)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $fn$
    select case when t.id is null then null else jsonb_build_object(
        'tenant', jsonb_build_object(
            'id', t.id, 'slug', t.slug, 'name', t.name,
            'template_id', t.template_id, 'languages', t.languages,
            'currency', t.currency,
            -- The palette and the settings, kept apart in the database because a theme
            -- editor should be a theme editor, and recombined here because the ported
            -- viewer wants one flat bag (its `theme_config`).
            'theme', coalesce(t.theme, '{}'::jsonb),
            'settings', coalesce(t.settings, '{}'::jsonb)
        ),
        'categories', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', c.id, 'name', c.name, 'i18n', c.i18n, 'position', c.position)
                   order by c.position, c.name)
              from categories c
             where c.tenant_id = t.id and c.visible
        ), '[]'::jsonb),
        'items', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', i.id, 'name', i.name, 'description', i.description,
                       'price_minor', i.price_minor, 'price_text', i.price_text,
                       'price_old_minor', i.price_old_minor, 'currency', i.currency,
                       'category_id', i.category_id, 'position', i.position,
                       'photo_key', i.photo_key, 'i18n', i.i18n,
                       'text_only', i.text_only, 'is_3d', i.is_3d,
                       'thumb_3d', i.thumb_3d, 'featured', i.featured,
                       'variants', i.variants, 'addons', i.addons,
                       -- Only an APPROVED model reaches a diner. Enforced here rather than
                       -- filtered in the renderer, so no caller can forget.
                       'draco_key',    case when m.tenant_state = 'approved' then m.draco_key end,
                       'usdz_key',     case when m.tenant_state = 'approved' then m.usdz_key end,
                       'external_glb', case when m.tenant_state = 'approved' then m.external_glb end,
                       'external_usdz',case when m.tenant_state = 'approved' then m.external_usdz end,
                       'ar_scale', m.ar_scale, 'view_orbit', m.view_orbit,
                       'tenant_state', m.tenant_state)
                   order by i.position, i.name)
              from items i
              left join models m on m.id = i.model_id and m.tenant_id = i.tenant_id
             where i.tenant_id = t.id and i.visible
        ), '[]'::jsonb)
    ) end
      from (select * from tenants where slug = p_slug) t
$fn$;

comment on function public_menu(text) is
    'Everything a diner''s page renders, and nothing else. Callable by anon so the public '
    'app can hold the weakest key that works instead of a direct database connection.';

revoke all on function public_menu(text) from public;
grant execute on function public_menu(text) to anon, authenticated;
