-- 0036 · Change history that actually records something, and undo.
--
-- Temo, 2026-09-28: "change history is not working." It never could: the History screen was
-- ported from the platform and reads `change_history` filtered on `restaurant_id` - a table
-- the rebuild never had. Every visit ended in the "not set up" card.
--
-- What is recorded, by triggers, so no screen can forget to log and no script can skip it:
--
--   item        a dish: every changed column, one row per field; created; deleted (with
--               the whole row kept, so a deleted dish can be RESTORED, not only mourned)
--   category    the same, for categories
--   theme       one row per changed key inside tenants.theme  (colours, fonts, hero...)
--   settings    one row per changed key inside tenants.settings (hours, links, address...)
--   restaurant  the restaurant's own columns: name, template, languages, plan switches
--   model       title, approval, owner, retired, angle, size - library models included
--   dish_page   a dish page switched on/off, or its address rerolled
--
-- Deliberately NOT recorded: `position` (dragging 170 dishes into order would bury
-- everything else under 170 rows) and timestamps nobody edits.
--
-- Who: `auth.uid()` of whoever made the change - NULL for the engine and for scripts run
-- with the service key, which the screen shows as "BetaReal (system)".
--
-- Undo: `revert_change(id)` writes the old value back through the same table rules a person
-- editing it would meet - a restaurant can undo its own menu and theme; models, dish pages
-- and plan switches are BetaReal's. The undo is itself a change, and is recorded, so an
-- undo can be undone.

create table if not exists change_history (
    id          bigserial primary key,
    -- NULL for a BetaReal library model: those changes are visible to super admins only.
    tenant_id   uuid        references tenants (id) on delete cascade,
    source      text        not null check (source in
                   ('item', 'category', 'theme', 'settings', 'restaurant', 'model', 'dish_page')),
    record_id   text,
    label       text,
    field       text        not null,
    old_value   jsonb,
    new_value   jsonb,
    changed_by  uuid        references auth.users (id) on delete set null,
    changed_at  timestamptz not null default now()
);

create index if not exists change_history_tenant_time on change_history (tenant_id, changed_at desc);

alter table change_history enable row level security;
alter table change_history force  row level security;
drop policy if exists change_history_read on change_history;
create policy change_history_read on change_history for select using (is_member_of(tenant_id));
grant select on change_history to authenticated;
-- No insert/update/delete grant: only the triggers (security definer) write here, so the
-- log cannot be edited by the people whose edits it records.


-- ── the one writer ──────────────────────────────────────────────────────────────────

create or replace function log_change(
    p_tenant uuid, p_source text, p_record text, p_label text,
    p_field text, p_old jsonb, p_new jsonb
) returns void language sql security definer
set search_path = public, pg_temp as $fn$
    insert into change_history (tenant_id, source, record_id, label, field, old_value, new_value, changed_by)
    values (p_tenant, p_source, p_record, p_label, p_field, p_old, p_new, auth.uid());
$fn$;
revoke all on function log_change(uuid, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;

-- Every top-level column that differs, except the ones named. One helper so items,
-- categories, models and restaurants all diff the same way.
create or replace function log_row_diff(
    p_tenant uuid, p_source text, p_record text, p_label text,
    p_old jsonb, p_new jsonb, p_skip text[]
) returns void language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
    k text;
begin
    for k in select jsonb_object_keys(p_new) loop
        continue when k = any (p_skip);
        if p_old -> k is distinct from p_new -> k then
            perform log_change(p_tenant, p_source, p_record, p_label, k, p_old -> k, p_new -> k);
        end if;
    end loop;
end $fn$;
revoke all on function log_row_diff(uuid, text, text, text, jsonb, jsonb, text[]) from public, anon, authenticated;


-- ── items and categories ────────────────────────────────────────────────────────────

create or replace function history_items()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
    if tg_op = 'INSERT' then
        perform log_change(new.tenant_id, 'item', new.id::text, new.name, '__created__', null, to_jsonb(new));
    elsif tg_op = 'DELETE' then
        perform log_change(old.tenant_id, 'item', old.id::text, old.name, '__deleted__', to_jsonb(old), null);
        return old;
    else
        perform log_row_diff(new.tenant_id, 'item', new.id::text, new.name, to_jsonb(old), to_jsonb(new),
                             array['position', 'created_utc', 'id', 'tenant_id']);
    end if;
    return new;
end $fn$;

drop trigger if exists history_items on items;
create trigger history_items after insert or update or delete on items
    for each row execute function history_items();

create or replace function history_categories()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
    if tg_op = 'INSERT' then
        perform log_change(new.tenant_id, 'category', new.id::text, new.name, '__created__', null, to_jsonb(new));
    elsif tg_op = 'DELETE' then
        perform log_change(old.tenant_id, 'category', old.id::text, old.name, '__deleted__', to_jsonb(old), null);
        return old;
    else
        perform log_row_diff(new.tenant_id, 'category', new.id::text, new.name, to_jsonb(old), to_jsonb(new),
                             array['position', 'created_utc', 'id', 'tenant_id']);
    end if;
    return new;
end $fn$;

drop trigger if exists history_categories on categories;
create trigger history_categories after insert or update or delete on categories
    for each row execute function history_categories();


-- ── the restaurant: theme and settings key by key, the rest column by column ────────

create or replace function history_tenants()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
    k text;
    o jsonb := coalesce(old.theme, '{}'::jsonb);
    n jsonb := coalesce(new.theme, '{}'::jsonb);
begin
    for k in select jsonb_object_keys(o || n) loop
        if o -> k is distinct from n -> k then
            perform log_change(new.id, 'theme', new.id::text, new.name, k, o -> k, n -> k);
        end if;
    end loop;
    o := coalesce(old.settings, '{}'::jsonb);
    n := coalesce(new.settings, '{}'::jsonb);
    for k in select jsonb_object_keys(o || n) loop
        if o -> k is distinct from n -> k then
            perform log_change(new.id, 'settings', new.id::text, new.name, k, o -> k, n -> k);
        end if;
    end loop;
    perform log_row_diff(new.id, 'restaurant', new.id::text, new.name, to_jsonb(old), to_jsonb(new),
                         array['theme', 'settings', 'created_utc', 'created_by', 'id']);
    return new;
end $fn$;

drop trigger if exists history_tenants on tenants;
create trigger history_tenants after update on tenants
    for each row execute function history_tenants();


-- ── models, library ones included ────────────────────────────────────────────────────

create or replace function history_models()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
    if tg_op = 'INSERT' then
        perform log_change(new.tenant_id, 'model', new.id::text, coalesce(nullif(new.title, ''), new.dish),
                           '__created__', null, jsonb_build_object('title', new.title, 'tenant_state', new.tenant_state));
        return new;
    end if;
    perform log_row_diff(coalesce(new.tenant_id, old.tenant_id), 'model', new.id::text,
                         coalesce(nullif(new.title, ''), new.dish), to_jsonb(old), to_jsonb(new),
                         array['created_utc', 'id', 'dish', 'variant', 'decided_utc', 'decided_by']);
    -- Moving a model between owners: the restaurant it LEFT should see that too.
    if old.tenant_id is distinct from new.tenant_id and old.tenant_id is not null and new.tenant_id is not null then
        perform log_change(old.tenant_id, 'model', new.id::text, coalesce(nullif(new.title, ''), new.dish),
                           'tenant_id', to_jsonb(old.tenant_id), to_jsonb(new.tenant_id));
    end if;
    return new;
end $fn$;

drop trigger if exists history_models on models;
create trigger history_models after insert or update on models
    for each row execute function history_models();


-- ── dish pages ───────────────────────────────────────────────────────────────────────

create or replace function history_dish_links()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
    v_name text;
begin
    select name into v_name from items where id = new.item_id;
    if old.active is distinct from new.active then
        perform log_change(new.tenant_id, 'dish_page', new.item_id::text, v_name, 'active',
                           to_jsonb(old.active), to_jsonb(new.active));
    end if;
    if old.token is distinct from new.token then
        perform log_change(new.tenant_id, 'dish_page', new.item_id::text, v_name, 'address',
                           to_jsonb(old.token), to_jsonb(new.token));
    end if;
    return new;
end $fn$;

drop trigger if exists history_dish_links on dish_links;
create trigger history_dish_links after update on dish_links
    for each row execute function history_dish_links();

create or replace function history_tenant_embed()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
    if tg_op = 'UPDATE' and old.pages_active is not distinct from new.pages_active
       and old.active is not distinct from new.active then
        return new;
    end if;
    if tg_op = 'INSERT' or old.pages_active is distinct from new.pages_active then
        perform log_change(new.tenant_id, 'dish_page', null, null, 'all_pages_active',
                           case when tg_op = 'INSERT' then null else to_jsonb(old.pages_active) end,
                           to_jsonb(new.pages_active));
    end if;
    if tg_op = 'UPDATE' and old.active is distinct from new.active then
        perform log_change(new.tenant_id, 'restaurant', null, null, 'embed_active',
                           to_jsonb(old.active), to_jsonb(new.active));
    end if;
    return new;
end $fn$;

drop trigger if exists history_tenant_embed on tenant_embed;
create trigger history_tenant_embed after insert or update on tenant_embed
    for each row execute function history_tenant_embed();


-- ── reading it, with names ───────────────────────────────────────────────────────────
--
-- The screen needs WHO, and auth.users is not readable from a browser. This returns the
-- email of whoever made each change, for rows the caller may see anyway. `p_library`
-- asks for BetaReal's own (tenant_id NULL) rows - super admins only, by the same RLS rule.
create or replace function change_history_list(
    p_tenant uuid, p_library boolean default false, p_limit integer default 100, p_before bigint default null
) returns table (
    id bigint, source text, record_id text, label text, field text,
    old_value jsonb, new_value jsonb, changed_at timestamptz, who text
)
language sql stable security definer
set search_path = public, pg_temp as $fn$
    select h.id, h.source, h.record_id, h.label, h.field, h.old_value, h.new_value, h.changed_at,
           coalesce(u.email, 'BetaReal (system)')
      from change_history h
      left join auth.users u on u.id = h.changed_by
     where (case when p_library then h.tenant_id is null and is_super_admin()
                 else h.tenant_id = p_tenant and is_member_of(p_tenant) end)
       and (p_before is null or h.id < p_before)
     order by h.id desc
     limit least(greatest(p_limit, 1), 500)
$fn$;

revoke all on function change_history_list(uuid, boolean, integer, bigint) from public, anon;
grant execute on function change_history_list(uuid, boolean, integer, bigint) to authenticated;


-- ── undo ─────────────────────────────────────────────────────────────────────────────
--
-- Writes the old value back as the CALLER, through the tables' own rules: it is SECURITY
-- INVOKER on purpose, so RLS and the guards decide - an owner can undo a price, cannot
-- undo us switching their dish pages off. A deleted dish or category is restored from the
-- row kept at deletion (a restored dish gets a NEW dish page address: the old one was
-- deleted with it, and that is the safe direction).
create or replace function revert_change(p_id bigint)
returns text language plpgsql security invoker
set search_path = public, pg_temp as $fn$
declare
    h   change_history;
    tbl text;
begin
    select * into h from change_history where id = p_id;
    if not found then
        raise exception 'no such change (or not yours to see)';
    end if;

    if h.source in ('item', 'category') then
        tbl := case h.source when 'item' then 'items' else 'categories' end;
        if h.field = '__deleted__' then
            execute format('insert into %I select * from jsonb_populate_record(null::%I, $1)', tbl, tbl)
            using h.old_value;
            return 'restored';
        elsif h.field = '__created__' then
            execute format('delete from %I where id = $1::uuid', tbl) using h.record_id;
            return 'removed';
        end if;
        execute format(
            'update %1$I set %2$I = (jsonb_populate_record(null::%1$I, jsonb_build_object(%3$L, $1))).%2$I where id = $2::uuid',
            tbl, h.field, h.field)
        using h.old_value, h.record_id;
        return 'reverted';
    elsif h.source in ('theme', 'settings') then
        execute format(
            'update tenants set %1$I = case when $1 is null then coalesce(%1$I, ''{}'') - $2
                                            else jsonb_set(coalesce(%1$I, ''{}''), array[$2], $1) end
              where id = $3', h.source)
        using h.old_value, h.field, h.tenant_id;
        return 'reverted';
    elsif h.source = 'restaurant' then
        if h.field in ('embed_active') then
            update tenant_embed set active = (h.old_value)::boolean where tenant_id = h.tenant_id;
        else
            execute format(
                'update tenants set %1$I = (jsonb_populate_record(null::tenants, jsonb_build_object(%2$L, $1))).%1$I where id = $2',
                h.field, h.field)
            using h.old_value, h.tenant_id;
        end if;
        return 'reverted';
    elsif h.source = 'model' then
        if h.field = '__created__' then
            raise exception 'a new model cannot be undone here - retire it instead';
        end if;
        execute format(
            'update models set %1$I = (jsonb_populate_record(null::models, jsonb_build_object(%2$L, $1))).%1$I where id = $2::uuid',
            h.field, h.field)
        using h.old_value, h.record_id;
        return 'reverted';
    elsif h.source = 'dish_page' then
        if h.field = 'active' then
            perform set_dish_link_active(h.record_id::uuid, (h.old_value)::boolean);
        elsif h.field = 'all_pages_active' then
            perform set_dish_pages_active(h.tenant_id, coalesce((h.old_value)::boolean, true));
        else
            -- A rerolled address cannot come back: the whole point of a reroll is that the
            -- old code is dead. Reroll again for a fresh one instead.
            raise exception 'a rerolled address cannot be brought back - that is what makes rerolling safe';
        end if;
        return 'reverted';
    end if;
    raise exception 'this change cannot be undone';
end $fn$;

revoke all on function revert_change(bigint) from public, anon;
grant execute on function revert_change(bigint) to authenticated;
