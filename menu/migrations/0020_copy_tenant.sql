-- 0019: copy a restaurant, so testing never happens on a client.
--
-- Temo: "in developer mode i want to have copy menu for testing and stuff."
--
-- The need is real and it is about blast radius. There are two paying-or-live restaurants
-- in this system and every experiment so far has had to be run against one of them or
-- against a two-dish demo that exercises nothing - reordering 170 items, a template
-- change, a bulk price edit, the language switch. A copy of Monday Greens is 170 items of
-- real, awkward, Georgian-and-English data, and breaking it costs nothing.
--
-- **What is copied, and the reasoning for each.**
--
--   categories, items   the point. Positions, prices, translations, flags, photos.
--   models              the ROWS, pointing at the SAME R2 objects. A model row is a few
--                       hundred bytes; the 4 MB file is not duplicated and no credit is
--                       spent. Without this the copy has no 3D, which is the half worth
--                       testing.
--   theme, settings,    so it LOOKS like the original. A copy that renders differently is
--   template, languages not a copy of the thing you wanted to test.
--
-- **What is deliberately not.**
--
--   slug, name          must be unique and must be obviously a copy. Nobody should be one
--                       glance away from editing the real Monday Greens.
--   model_quota         a test copy gets zero. Copying a quota copies permission to spend
--                       our credits, and a sandbox is exactly where somebody presses
--                       Build without thinking.
--   events              somebody else's diners. Analytics on a copy would be a lie, and
--                       the funnel is the number this company is judged on.
--   model_requests,     in-flight work belongs to the restaurant that asked for it. A
--   captures            copied request would be a second claim on the same queue job.
--   setup_done          left false, so the copy opens on the setup wizard the way a real
--                       new restaurant does - which is itself a thing worth testing.
--
-- SECURITY DEFINER with is_super_admin() inside: it creates a tenant and reads another
-- tenant's rows, so it is exactly the shape of create_tenant and add_tenant_member. The
-- caller is added as a member, or they would make something they cannot open.

create or replace function copy_tenant(p_source uuid, p_slug text default null)
returns table (tenant_id uuid, slug text, categories integer, items integer, models integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_src        tenants%rowtype;
    v_new        uuid;
    v_slug       text;
    v_n          integer := 1;
    v_cats       integer := 0;
    v_items      integer := 0;
    v_models     integer := 0;
begin
    if not is_super_admin() then
        raise exception 'not allowed' using errcode = '42501';
    end if;
    select * into v_src from tenants where id = p_source;
    if not found then
        raise exception 'no such restaurant' using errcode = 'P0002';
    end if;

    -- A slug that is unique, legal and obviously a copy. `tenants_slug_check` wants
    -- lowercase alphanumerics and dashes, 1-63 characters, not starting or ending with a
    -- dash - so the base is trimmed before the suffix is added rather than after, or a
    -- long name would produce `something-very-long-copy` truncated to end in a dash.
    v_slug := coalesce(nullif(regexp_replace(lower(p_slug), '[^a-z0-9-]+', '-', 'g'), ''),
                       left(v_src.slug, 50) || '-copy');
    v_slug := regexp_replace(v_slug, '(^-+|-+$)', '', 'g');
    while exists (select 1 from tenants t where t.slug = v_slug) loop
        v_n := v_n + 1;
        v_slug := left(regexp_replace(coalesce(nullif(p_slug, ''), v_src.slug), '[^a-z0-9-]+', '-', 'g'), 48)
                  || '-copy-' || v_n;
        v_slug := regexp_replace(v_slug, '(^-+|-+$)', '', 'g');
    end loop;

    insert into tenants (slug, name, theme, template_id, languages, settings,
                         country, currency, model_quota, setup_done, created_by)
    values (v_slug,
            left(v_src.name || ' (copy)', 120),
            v_src.theme, v_src.template_id, v_src.languages, v_src.settings,
            v_src.country, v_src.currency,
            0,        -- see the header: a sandbox does not get to spend credits
            false,    -- opens on setup, like a real new restaurant
            auth.uid())
    returning id into v_new;

    insert into tenant_members (tenant_id, user_id, role)
    values (v_new, auth.uid(), 'owner')
    on conflict do nothing;

    -- Categories first: items point at them, and the new ids have to be known before the
    -- items are written. `source_ref` carries the OLD id, which is what makes the remap
    -- below a join rather than a temp table.
    with copied as (
        insert into categories (tenant_id, name, position, visible, i18n, source_ref)
        select v_new, c.name, c.position, c.visible, c.i18n, 'copy:' || c.id
          from categories c where c.tenant_id = p_source
        returning 1
    )
    select count(*) into v_cats from copied;

    with copied as (
        insert into models (tenant_id, title, dish, variant, draco_key, usdz_key, poster_key,
                            scale_cm, scale_axis, tenant_state, view_orbit, ar_scale,
                            external_glb, external_usdz, archived,
                            width_cm, length_cm, height_cm, source_ref)
        select v_new, m.title, m.dish, m.variant, m.draco_key, m.usdz_key, m.poster_key,
               m.scale_cm, m.scale_axis, m.tenant_state, m.view_orbit, m.ar_scale,
               m.external_glb, m.external_usdz, m.archived,
               m.width_cm, m.length_cm, m.height_cm, 'copy:' || m.id
          from models m where m.tenant_id = p_source
        returning 1
    )
    select count(*) into v_models from copied;

    with copied as (
        insert into items (tenant_id, category_id, name, description, price_minor, currency,
                           photo_key, model_id, visible, position, i18n, price_text,
                           price_old_minor, text_only, is_3d, thumb_3d, featured,
                           variants, addons, photo_source_url, source_ref)
        select v_new,
               nc.id,          -- the copied category, found by the old id in source_ref
               i.name, i.description, i.price_minor, i.currency,
               i.photo_key,
               nm.id,          -- the copied model, likewise
               i.visible, i.position, i.i18n, i.price_text,
               i.price_old_minor, i.text_only, i.is_3d, i.thumb_3d, i.featured,
               i.variants, i.addons, i.photo_source_url, 'copy:' || i.id
          from items i
          left join categories nc
                 on nc.tenant_id = v_new and nc.source_ref = 'copy:' || i.category_id
          left join models nm
                 on nm.tenant_id = v_new and nm.source_ref = 'copy:' || i.model_id
         where i.tenant_id = p_source
        returning 1
    )
    select count(*) into v_items from copied;

    return query select v_new, v_slug, v_cats, v_items, v_models;
end $fn$;

comment on function copy_tenant(uuid, text) is
    'Duplicate a restaurant for testing: categories, items, and model ROWS pointing at the '
    'same R2 files. Not its diners, its in-flight requests, or its free-model quota. '
    'Super admins only.';

revoke all on function copy_tenant(uuid, text) from public;
grant execute on function copy_tenant(uuid, text) to authenticated;
