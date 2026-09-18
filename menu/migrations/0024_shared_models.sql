-- 0024: the BetaReal library — one model, on any menu we choose.
--
-- Until now a model belonged to exactly one restaurant and could never leave it. That is
-- right for a scanned dish: Monday Greens' khachapuri is *theirs*, and the whole promise
-- of the product is that a diner sees the plate that arrives at their table, not a stock
-- photograph of one (`betareal-ai-engine-strategy`). Nothing here weakens that.
--
-- What it adds is the other case, which we have been hitting by hand: a model WE made
-- that is not about one restaurant. A generic salmon nigiri, a demo burger, the sushi in
-- the JAPAN demo. Today putting one of those on a second menu means generating it again -
-- 30 credits to rebuild a mesh that already exists, on a plate nobody is claiming is
-- theirs.
--
-- **The library is a flag, not a place.** A model stays in the tenant that made it and
-- keeps its history; `shared` says it may also be pointed at from elsewhere. The
-- alternative - a "library tenant" that owns the shared rows - would need every model to
-- be MOVED into it, which loses which restaurant it came from, and it would make the
-- library a tenant that owns no menu and has no members, which every query that walks
-- tenants would then have to special-case.
--
-- **And it stays a pointer.** MENU-PLATFORM §3: an item points at a model, nothing is
-- copied. Copying the row into the borrowing tenant would have avoided this whole
-- migration - and it would mean a model fixed once is fixed in one place and stale in
-- five others, with nothing saying which. One row, many pointers, one fix.
--
-- Three things have to change together, and any one of them alone is broken:
--
--   1. the column, and who may set it
--   2. who may READ a shared row - or the borrowing restaurant's own admin cannot
--      resolve the model sitting on its own dish
--   3. `public_menu`, or the dish publishes with no 3D and nothing says why


-- 1 · The column ----------------------------------------------------------------------

alter table models add column if not exists shared boolean not null default false;

comment on column models.shared is
    'In the BetaReal library: this model may be attached to an item in ANY tenant. Set by '
    'super admins only, enforced by models_shared_guard - see 0024. Default false, so '
    'every model a restaurant makes stays theirs unless we deliberately say otherwise.';

-- Listing the library is "every shared model, newest first", across all tenants. The
-- existing index is (tenant_id, tenant_state) and cannot serve that.
create index if not exists models_shared_idx
    on models (created_utc desc) where shared;


-- 2 · Who may put a model in the library ----------------------------------------------
--
-- `models_rw` (0001) gives a restaurant full write on its own models, and a new column is
-- covered by that grant the moment it exists. So without this, any owner could set
-- `shared = true` on their own row and put their dish into a library that is supposed to
-- be curated - and, because of the read policy below, into everyone's reach.
--
-- A trigger rather than column grants. The alternative is `revoke update on models` and
-- re-granting each of the other twenty-odd columns by name, which works today and breaks
-- quietly the first time somebody adds a column and forgets the grant: the admin would
-- save, Postgres would refuse that one column, and the screen would say Saved. A trigger
-- covers every future column by default and says why in words.
--
-- It guards INSERT as well as UPDATE. An owner cannot write `shared = true` on the way in
-- either, which is the same hole through a different door.
create or replace function models_shared_guard()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
    -- The engine writes with the service key, where `auth.uid()` is null and
    -- `is_super_admin()` is false. It has no reason to touch this column and does not,
    -- but if it ever does, it is us, not a client - so the check is only about a change,
    -- and an unchanged value is never an error.
    if tg_op = 'INSERT' then
        if new.shared and auth.uid() is not null and not is_super_admin() then
            raise exception 'only a super admin may put a model in the BetaReal library'
                using errcode = '42501';
        end if;
        return new;
    end if;

    if new.shared is distinct from old.shared
       and auth.uid() is not null and not is_super_admin() then
        raise exception 'only a super admin may change whether a model is in the BetaReal library'
            using errcode = '42501';
    end if;
    return new;
end $fn$;

drop trigger if exists models_shared_guard on models;
create trigger models_shared_guard
    before insert or update on models
    for each row execute function models_shared_guard();

comment on function models_shared_guard() is
    'Only a super admin may set models.shared. Everything else about a model stays the '
    'owning restaurant''s to write, which is why this is one trigger on one column rather '
    'than a rewrite of the table grants.';


-- 3 · Who may read one -----------------------------------------------------------------
--
-- This is the part that is easy to miss, and it is not a convenience.
--
-- A super admin attaches a library model owned by tenant A to a dish in tenant B. Tenant
-- B's owner opens their menu editor. `models_rw` scopes reads to `is_member_of(tenant_id)`
-- and they are not a member of A, so the row does not come back: the dish shows as having
-- no model while `public_menu` happily serves the 3D to diners. The admin would be lying
-- to the person who owns the menu.
--
-- A permissive SELECT policy is OR-ed with `models_rw`, so this widens reading and
-- nothing else. Writing is still `models_rw` alone - a borrowing restaurant can see the
-- model on its dish, and cannot rename it, re-scale it, judge it or delete it.
--
-- What this exposes: every row we have deliberately marked as a stock model. That is a
-- catalogue, not tenant data, and it is the same set of files any diner can already fetch
-- from a published menu.
drop policy if exists models_shared_read on models;
create policy models_shared_read on models for select
    using (shared);


-- 4 · Publishing -----------------------------------------------------------------------
--
-- `public_menu` joined `m.tenant_id = i.tenant_id`, so a cross-tenant model was dropped
-- silently: the admin showed the dish attached, and the diner got a dish with no 3D. The
-- join now also accepts a library model.
--
-- **The tenancy rule is unchanged for everything else.** A model belonging to another
-- restaurant and NOT in the library still does not publish, which is the property worth
-- keeping and the one `check_publish.py` proves by trying it.
--
-- Restated in full because `create or replace function` has no partial form. Byte for
-- byte 0015 apart from the one join condition.
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
$fn$;

comment on function public_menu(text) is
    'Everything a diner''s page renders, and nothing else. Callable by anon so the public '
    'app can hold the weakest key that works instead of a direct database connection. A '
    'dish may carry a model from the BetaReal library (models.shared, 0024); a model '
    'belonging to another restaurant and not in the library is still never served.';

revoke all on function public_menu(text) from public;
grant execute on function public_menu(text) to anon, authenticated;
