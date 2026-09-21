-- 0028: one dish, on somebody else's website.
--
-- A restaurant that already has a website - or a delivery site, or a WordPress page an
-- agency built - pastes one block next to a dish, and that dish shows up there in 3D with
-- a "View on your table" button. The model still comes from us: their page holds only the
-- dish's id, never a file. See EMBED.md.
--
-- Three things, all additive:
--
--   1. `tenant_embed` - per restaurant, an ACTIVE switch and an ALLOWED-SITES list.
--      Its own table, not columns on `tenants`, because `tenants_write` is is_member_of():
--      an owner can update their own tenants row, and an owner must not be able to switch
--      their own embeds back on or add sites to their own list. Only a super admin writes
--      here. No row means the defaults: active, allowed anywhere (the Vimeo default -
--      a dish id is a uuid nobody can guess, and it only leaves the admin when we hand it
--      out).
--
--   2. `public_dish(uuid)` - public_menu's rule, for one dish. Everything the embed page
--      renders and nothing else: a hidden dish returns null, an unapproved model is left
--      out, a model belonging to another restaurant is never served unless it is in the
--      shared library. Callable by anon, so the embed page holds the weakest key that
--      works - exactly like the menu.
--
--   3. `record_events` learns three names - embed_view, embed_3d, embed_ar. New names
--      rather than reusing item_open / ar_open, because a dish on a stranger's page is a
--      different audience from a diner at the table, and mixing them would quietly change
--      every number the menu dashboard already shows. The function is 0017's, unchanged
--      except for the list - check_features.py reads the newest whitelist, so it has to
--      stay one parenthesised list.

-- ── 1. per-restaurant embed settings ─────────────────────────────────────────────────

create table if not exists tenant_embed (
    tenant_id     uuid primary key references tenants (id) on delete cascade,
    -- Off: every embed of this restaurant shows its photo and nothing else - no 3D, no AR.
    -- The lever for a restaurant that stops paying, without anyone editing their site.
    active        boolean     not null default true,
    -- Lowercase hostnames: {'restaurant-x.ge'}. Each also covers its subdomains, so
    -- www.restaurant-x.ge is included. Empty = allowed anywhere.
    allowed_sites text[]      not null default '{}',
    updated_utc   timestamptz not null default now(),
    updated_by    uuid        references auth.users (id) on delete set null
);

comment on table tenant_embed is
    'Where a restaurant''s dishes may be embedded, and whether they may be at all. '
    'Super-admin write only: tenants itself is owner-writable, which is why this is not '
    'two columns on it.';

alter table tenant_embed enable row level security;

drop policy if exists tenant_embed_read on tenant_embed;
create policy tenant_embed_read on tenant_embed for select
    using (is_member_of(tenant_id));

drop policy if exists tenant_embed_write on tenant_embed;
create policy tenant_embed_write on tenant_embed for all
    using (is_super_admin()) with check (is_super_admin());

grant select, insert, update, delete on tenant_embed to authenticated;


-- ── 2. one dish, for a public page ───────────────────────────────────────────────────

create or replace function public_dish(p_item uuid)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $fn$
    select jsonb_build_object(
        'tenant', jsonb_build_object(
            'id', t.id, 'slug', t.slug, 'name', t.name,
            'languages', t.languages, 'currency', t.currency),
        'embed', jsonb_build_object(
            'active', coalesce(e.active, true),
            'allowed_sites', to_jsonb(coalesce(e.allowed_sites, '{}'::text[]))),
        'item', jsonb_build_object(
            'id', i.id, 'name', i.name, 'description', i.description, 'i18n', i.i18n,
            'price_minor', i.price_minor, 'price_text', i.price_text,
            'currency', i.currency, 'photo_key', i.photo_key,
            'is_3d', i.is_3d, 'text_only', i.text_only),
        -- The same approval rule as public_menu: a model reaches a public page only once
        -- the owner said yes.
        'model', case when m.id is not null and m.tenant_state = 'approved'
                      then jsonb_build_object(
                          'draco_key', m.draco_key, 'usdz_key', m.usdz_key,
                          'external_glb', m.external_glb, 'external_usdz', m.external_usdz,
                          'poster_key', m.poster_key,
                          'ar_scale', m.ar_scale, 'view_orbit', m.view_orbit)
                 end)
      from items i
      join tenants t on t.id = i.tenant_id
      left join models m
             on m.id = i.model_id
            and (m.tenant_id = i.tenant_id or m.shared)
      left join tenant_embed e on e.tenant_id = i.tenant_id
     where i.id = p_item
       and i.visible
$fn$;

comment on function public_dish(uuid) is
    'Everything the embed page (/d/<id>) renders for one dish, and nothing else. Null for '
    'a hidden or missing dish. Same model rules as public_menu. Anon-callable. 0028.';

revoke all on function public_dish(uuid) from public;
grant execute on function public_dish(uuid) to anon, authenticated;


-- ── 3. the three embed event names ───────────────────────────────────────────────────

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
        -- The five basket names are 0017's addition, the three embed names 0028's. The nine
        -- above them are 0009's, unchanged.
        if v_name not in ('view', 'hero_pass', 'category', 'item_open', 'ar_open',
                          'ar_placed', 'delivery', 'lang', 'theme',
                          'basket_add', 'basket_remove', 'basket_open', 'basket_clear',
                          'waiter_qr',
                          'embed_view', 'embed_3d', 'embed_ar') then
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
    '0017 added the five basket names, 0028 the three embed names.';

revoke all on function record_events(uuid, text, jsonb) from public;
-- `anon` deliberately: a diner is not signed in, and this is the one thing they may do.
grant execute on function record_events(uuid, text, jsonb) to anon, authenticated;
