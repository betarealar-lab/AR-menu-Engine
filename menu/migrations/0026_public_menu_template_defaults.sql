-- 0026: the live page and the published snapshot disagreed about what a template is.
--
-- Found while putting the first restaurant on the JAPAN template, and it is the kind of
-- bug that only shows up the first time a template's palette is not empty.
--
-- `compile_snapshot()` in `menu/publish.py` has always done this:
--
--     theme = template.defaults  merged under  tenant.theme
--
-- ...which is what `templates.defaults` is FOR: the palette a restaurant on that template
-- starts with, before it changes anything. `check_publish.py` has asserted both halves
-- since the day it was written - "template defaults are present", "the tenant overrides
-- them".
--
-- `public_menu()` did not. It returned `t.theme` alone. And `public_menu()` is the
-- function the live Astro page actually calls, so the one that a diner sees was the one
-- without the defaults. A tenant with an empty `theme` got no palette at all and fell
-- through to whatever the template stylesheet happened to ship - which for a brand-new
-- template is the generic dark gold, not the design.
--
-- It went unnoticed because both existing templates have `defaults = '{}'`: monday_greens
-- and elegant_black came out of the platform, where the palette lives in each
-- restaurant's own `theme_config`, so every tenant carried a full palette of its own and
-- there was nothing for the defaults to contribute. The two code paths agreed by
-- coincidence, on a value of zero.
--
-- **This changes nothing for any tenant that exists today** - merging `'{}'` under a
-- theme is that theme - and it means a template's palette is now one thing in one place
-- rather than something every new tenant has to be given a copy of.
--
-- `||` is a shallow merge with the right side winning, which is the same precedence
-- `compile_snapshot` uses: the restaurant's own colour always beats the template's.

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
            -- The template's palette, then the restaurant's own on top of it.
            'theme', coalesce(tpl.defaults, '{}'::jsonb)
                  || coalesce(t.theme, '{}'::jsonb),
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
                       'draco_key',    case when m.tenant_state = 'approved' then m.draco_key end,
                       'usdz_key',     case when m.tenant_state = 'approved' then m.usdz_key end,
                       'external_glb', case when m.tenant_state = 'approved' then m.external_glb end,
                       'external_usdz',case when m.tenant_state = 'approved' then m.external_usdz end,
                       'ar_scale', m.ar_scale, 'view_orbit', m.view_orbit,
                       'tenant_state', m.tenant_state)
                   order by i.position, i.name)
              from items i
              left join models m
                     on m.id = i.model_id
                    and (m.tenant_id = i.tenant_id or m.shared)
             where i.tenant_id = t.id and i.visible
        ), '[]'::jsonb)
    ) end
      from (select * from tenants where slug = p_slug) t
      left join templates tpl on tpl.id = t.template_id
$fn$;

comment on function public_menu(text) is
    'Everything a diner''s page renders, and nothing else. Callable by anon so the public '
    'app can hold the weakest key that works instead of a direct database connection. '
    'The theme is the template''s defaults with the restaurant''s own palette merged over '
    'them (0026), the same precedence compile_snapshot uses. A dish may carry a model from '
    'the BetaReal library (models.shared, 0024); a model belonging to another restaurant '
    'and not in the library is still never served.';

revoke all on function public_menu(text) from public;
grant execute on function public_menu(text) to anon, authenticated;
