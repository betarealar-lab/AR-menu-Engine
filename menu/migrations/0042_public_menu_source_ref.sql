-- 0042: public_menu also returns items.source_ref.
--
-- A dish imported from the platform keeps its platform id in `source_ref` (import_tenant).
-- The platform keys per-dish rules on that id - Food & Market's No Bun Burger is
-- `.menu-item[data-item-id="2484"]` - and MIGRATION.md §3.1 needs it for old `?item=<id>`
-- links. Same function as 0026 otherwise. It is not a secret: it is a number in the
-- platform's own public API.

create or replace function public_menu(p_slug text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
                       'tenant_state', m.tenant_state,
                       -- The dish's id on the platform it was imported from (NULL for our
                       -- own). A migrated page keys its platform rules and old links on it.
                       'source_ref', i.source_ref)
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
$function$;
