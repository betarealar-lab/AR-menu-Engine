-- 0033 · Every dish gets its own page, at an address we can switch off or replace.
--
-- Temo, 2026-09-28: "every dish [should] have their own URL preview page, independent from
-- menu, QRs auto generated, easily downloadable and constant, but it must also have an
-- off switch cause we plan to use that to make flyers and posters as products, so if some
-- malicious people copy it we must be able to turn it off when they stop paying ... turn
-- off the URL and also reroll/regenerate the url."
--
-- So a dish page is addressed by an opaque TOKEN, not by the dish id:
--
--   /p/<token>      10 characters, no look-alikes (no 0/o/1/l/i), unguessable in practice
--
-- and the token is the thing that can be killed. The dish id cannot be revoked - it is in
-- the menu, in analytics, in the embed - but a token exists only to be printed, so:
--
--   off       dish_links.active = false          that one flyer stops working
--   all off   tenant_embed.pages_active = false  every flyer of that restaurant stops
--   reroll    a new token; the old one is gone   a copied or leaked flyer dies, and the
--                                                restaurant gets a new code to print
--
-- "Constant": a token never changes on its own. Renaming the dish, moving it, re-making
-- its model - none of that touches it. Only a reroll does, and only a super admin can.
--
-- Everything that changes a link is a super-admin FUNCTION, not a table grant: these are a
-- product we sell, and an owner who could re-enable their own links after we switched them
-- off for non-payment would make the switch decorative. Owners may READ their links.
--
-- One-dish mode on the menu is reachable ONLY through a live token (the page sets a
-- server-side flag, never a query parameter), so a copier cannot route around a dead token
-- by printing `/<slug>?dish=...` instead.


-- ── the table ───────────────────────────────────────────────────────────────────────

create table if not exists dish_links (
    item_id     uuid primary key references items (id) on delete cascade,
    tenant_id   uuid        not null references tenants (id) on delete cascade,
    token       text        not null unique check (token ~ '^[a-hj-km-np-z2-9]{10}$'),
    active      boolean     not null default true,
    created_utc timestamptz not null default now(),
    -- When the token was last replaced. NULL = the original.
    rotated_utc timestamptz,
    changed_by  uuid        references auth.users (id) on delete set null,
    changed_utc timestamptz not null default now()
);

comment on table dish_links is
    'One public page per dish at /p/<token>. The token is the revocable part: off, all-off '
    '(tenant_embed.pages_active) and reroll are super-admin functions (0033).';

create index if not exists dish_links_tenant on dish_links (tenant_id);

alter table dish_links enable row level security;
alter table dish_links force  row level security;
drop policy if exists dish_links_read on dish_links;
create policy dish_links_read on dish_links for select using (is_member_of(tenant_id));
grant select on dish_links to authenticated;

-- The restaurant-wide switch lives beside the embed switch, in the one table owners
-- cannot write (0028): tenants itself is owner-writable, so a column there would be a
-- switch the restaurant could flip back.
alter table tenant_embed add column if not exists pages_active boolean not null default true;


-- ── tokens ──────────────────────────────────────────────────────────────────────────
--
-- 31 characters (a-z and 2-9 without 0 o 1 l i, which get misread off paper), 10 of them:
-- 31^10 is about 8e14. Drawn from gen_random_uuid()'s random bytes, which are the
-- cryptographic generator, rather than random(), which is not.
create or replace function dish_token()
returns text language plpgsql volatile
set search_path = public, pg_temp as $fn$
declare
    alpha constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
    b     bytea := uuid_send(gen_random_uuid());
    out   text  := '';
begin
    for i in 0..9 loop
        -- Byte 6 and 8 of a v4 uuid carry version/variant bits; skip them.
        out := out || substr(alpha, (get_byte(b, (array[0,1,2,3,4,5,7,9,10,11])[i + 1]) % 31) + 1, 1);
    end loop;
    return out;
end $fn$;

revoke all on function dish_token() from public, anon, authenticated;


-- ── every dish has one, automatically ────────────────────────────────────────────────

create or replace function dish_links_autocreate()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
    insert into dish_links (item_id, tenant_id, token)
    values (new.id, new.tenant_id, dish_token())
    on conflict (item_id) do nothing;
    return new;
end $fn$;

drop trigger if exists dish_links_autocreate on items;
create trigger dish_links_autocreate
    after insert on items
    for each row execute function dish_links_autocreate();

-- Every dish that already exists.
insert into dish_links (item_id, tenant_id, token)
select i.id, i.tenant_id, dish_token() from items i
on conflict (item_id) do nothing;


-- ── the three levers, super admins only ─────────────────────────────────────────────

create or replace function set_dish_link_active(p_item uuid, p_active boolean)
returns boolean language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
    if not is_super_admin() then
        raise exception 'only BetaReal can switch a dish page on or off' using errcode = '42501';
    end if;
    update dish_links set active = p_active, changed_by = auth.uid(), changed_utc = now()
     where item_id = p_item;
    return found;
end $fn$;

create or replace function reroll_dish_link(p_item uuid)
returns text language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
    v_token text;
begin
    if not is_super_admin() then
        raise exception 'only BetaReal can replace a dish page address' using errcode = '42501';
    end if;
    -- A fresh token until it is unique. At 8e14 the loop is a formality.
    loop
        v_token := dish_token();
        exit when not exists (select 1 from dish_links where token = v_token);
    end loop;
    update dish_links
       set token = v_token, rotated_utc = now(), changed_by = auth.uid(), changed_utc = now()
     where item_id = p_item;
    if not found then
        -- A dish from before 0033's backfill cannot exist, but a missing row must not turn
        -- a reroll into a silent no-op.
        insert into dish_links (item_id, tenant_id, token, changed_by)
        select i.id, i.tenant_id, v_token, auth.uid() from items i where i.id = p_item;
    end if;
    return v_token;
end $fn$;

create or replace function set_dish_pages_active(p_tenant uuid, p_active boolean)
returns boolean language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
    if not is_super_admin() then
        raise exception 'only BetaReal can switch a restaurant''s dish pages' using errcode = '42501';
    end if;
    insert into tenant_embed (tenant_id, pages_active, updated_by)
    values (p_tenant, p_active, auth.uid())
    on conflict (tenant_id) do update
       set pages_active = excluded.pages_active, updated_by = auth.uid(), updated_utc = now();
    return true;
end $fn$;

revoke all on function set_dish_link_active(uuid, boolean) from public, anon;
revoke all on function reroll_dish_link(uuid) from public, anon;
revoke all on function set_dish_pages_active(uuid, boolean) from public, anon;
grant execute on function set_dish_link_active(uuid, boolean) to authenticated;
grant execute on function reroll_dish_link(uuid) to authenticated;
grant execute on function set_dish_pages_active(uuid, boolean) to authenticated;


-- ── the one thing a diner's phone may ask ───────────────────────────────────────────
--
-- A token -> which restaurant and which dish, or nothing. Nothing covers every way a
-- page can be dead: unknown token, rerolled away, switched off, restaurant switched off,
-- dish hidden. The page cannot tell them apart and must not: "this flyer was revoked"
-- is information a copier would like to have.
create or replace function resolve_dish_link(p_token text)
returns table (slug text, item_id uuid)
language sql stable security definer
set search_path = public, pg_temp as $fn$
    select t.slug, l.item_id
      from dish_links l
      join tenants t on t.id = l.tenant_id
      join items i on i.id = l.item_id and i.visible
      left join tenant_embed te on te.tenant_id = l.tenant_id
     where l.token = lower(p_token)
       and l.active
       and coalesce(te.pages_active, true)
     limit 1
$fn$;

revoke all on function resolve_dish_link(text) from public;
grant execute on function resolve_dish_link(text) to anon, authenticated;
