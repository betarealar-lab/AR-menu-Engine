-- 0037 · A page for a MODEL, not only for a dish - and a description to put on it.
--
-- Temo, 2026-09-28: dish pages keep their X, because behind a dish there is a menu to go
-- back to. "But if model is betareal's so no menu then remove the X." A BetaReal model -
-- a demo, a stock plate, one made for a pitch - is on no restaurant's menu, so it needs a
-- page of its own that is ONLY the model: /m/<token>, the same 3D viewer and AR as the
-- menu, nothing to close to.
--
-- Same shape as dish pages (0033), for the same reasons: an opaque token that can be
-- switched off or rerolled by a super admin, created automatically for every model, and a
-- public resolver that answers nothing for any kind of dead page. A model page resolves
-- only while the model is approved and not retired.
--
-- `models.description`: what the page says under the model. Dish pages take the dish's
-- description from the menu; a model has had nowhere to put one.

alter table models add column if not exists description text not null default '';

create table if not exists model_links (
    model_id    uuid primary key references models (id) on delete cascade,
    token       text        not null unique check (token ~ '^[a-hj-km-np-z2-9]{10}$'),
    active      boolean     not null default true,
    created_utc timestamptz not null default now(),
    rotated_utc timestamptz,
    changed_by  uuid        references auth.users (id) on delete set null,
    changed_utc timestamptz not null default now()
);

comment on table model_links is
    'One public page per model at /m/<token>: the model alone, no menu, no close button. '
    'Off and reroll are super-admin functions (0037).';

alter table model_links enable row level security;
alter table model_links force  row level security;
-- Whoever may see the model may see its page address - the library's own rule.
drop policy if exists model_links_read on model_links;
create policy model_links_read on model_links for select
    using (exists (select 1 from models m where m.id = model_links.model_id and is_member_of(m.tenant_id)));
grant select on model_links to authenticated;

create or replace function model_links_autocreate()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
    insert into model_links (model_id, token) values (new.id, dish_token())
    on conflict (model_id) do nothing;
    return new;
end $fn$;

drop trigger if exists model_links_autocreate on models;
create trigger model_links_autocreate after insert on models
    for each row execute function model_links_autocreate();

insert into model_links (model_id, token)
select m.id, dish_token() from models m
on conflict (model_id) do nothing;


create or replace function set_model_link_active(p_model uuid, p_active boolean)
returns boolean language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
    if not is_super_admin() then
        raise exception 'only BetaReal can switch a model page on or off' using errcode = '42501';
    end if;
    update model_links set active = p_active, changed_by = auth.uid(), changed_utc = now()
     where model_id = p_model;
    return found;
end $fn$;

create or replace function reroll_model_link(p_model uuid)
returns text language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
    v_token text;
begin
    if not is_super_admin() then
        raise exception 'only BetaReal can replace a model page address' using errcode = '42501';
    end if;
    loop
        v_token := dish_token();
        exit when not exists (select 1 from model_links where token = v_token);
    end loop;
    insert into model_links (model_id, token, rotated_utc, changed_by)
    values (p_model, v_token, now(), auth.uid())
    on conflict (model_id) do update
       set token = excluded.token, rotated_utc = now(), changed_by = auth.uid(), changed_utc = now();
    return v_token;
end $fn$;

revoke all on function set_model_link_active(uuid, boolean) from public, anon;
revoke all on function reroll_model_link(uuid) from public, anon;
grant execute on function set_model_link_active(uuid, boolean) to authenticated;
grant execute on function reroll_model_link(uuid) to authenticated;


-- What a diner's phone gets for a model page: the files and the words, nothing else. The
-- owning restaurant's id comes along only so its visits can be counted for that restaurant;
-- a BetaReal model has none, and its page records nothing (the event sink requires one).
create or replace function resolve_model_link(p_token text)
returns table (
    model_id uuid, title text, description text, draco_key text, usdz_key text,
    poster_key text, external_glb text, external_usdz text, view_orbit text, tenant_id uuid
)
language sql stable security definer
set search_path = public, pg_temp as $fn$
    select m.id, coalesce(nullif(m.title, ''), 'BetaReal'), m.description, m.draco_key, m.usdz_key,
           m.poster_key, m.external_glb, m.external_usdz, m.view_orbit, m.tenant_id
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
