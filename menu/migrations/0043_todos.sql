-- 0043: BetaReal's to-do list, and the owner's "Need help?" button.
--
-- Nika, 2026-10-11: one list for us (super admins) holding our own ideas and the
-- restaurants that asked for help. An owner presses "Need help?" in their admin; it lands
-- here as a help request with the restaurant and who asked, and one of us calls or
-- messages them. No messaging in the product: the request is only the notification.
--
-- Only super admins can read or write the list. An owner reaches it through exactly one
-- door, `request_help`, which files a request for a restaurant they belong to - so an
-- owner can neither read the list nor file one for somebody else's restaurant.

create table if not exists todos (
    id           uuid        primary key default gen_random_uuid(),
    kind         text        not null default 'idea' check (kind in ('idea', 'help')),
    title        text        not null check (length(title) between 1 and 300),
    notes        text        not null default '' check (length(notes) <= 4000),
    -- Help requests: which restaurant, and who pressed the button.
    tenant_id    uuid        references tenants (id) on delete cascade,
    requested_by uuid        references auth.users (id) on delete set null,
    created_by   uuid        default auth.uid() references auth.users (id) on delete set null,
    created_utc  timestamptz not null default now(),
    -- A second press while a request is open bumps this rather than filing a duplicate.
    updated_utc  timestamptz not null default now(),
    done_utc     timestamptz,
    done_by      uuid        references auth.users (id) on delete set null
);

create index if not exists todos_open on todos (done_utc, kind, updated_utc desc);
create unique index if not exists todos_one_open_help
    on todos (tenant_id) where kind = 'help' and done_utc is null;

alter table todos enable row level security;
drop policy if exists todos_super on todos;
create policy todos_super on todos for all
    using (is_super_admin()) with check (is_super_admin());
grant select, insert, update, delete on todos to authenticated;

-- The owner's button. Returns when the open request was (re)sent.
create or replace function request_help(p_tenant uuid, p_message text default '')
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
    v_name text;
    v_msg  text := left(coalesce(trim(p_message), ''), 1000);
    v_at   timestamptz := now();
begin
    if auth.uid() is null or not is_member_of(p_tenant) then
        raise exception 'not a member of this restaurant';
    end if;
    select name into v_name from tenants where id = p_tenant;
    if v_name is null then
        raise exception 'no such restaurant';
    end if;

    update todos
       set updated_utc  = v_at,
           requested_by = auth.uid(),
           notes = case when v_msg = '' then notes
                        when notes = '' then v_msg
                        else notes || E'\n\n' || v_msg end
     where tenant_id = p_tenant and kind = 'help' and done_utc is null;
    if not found then
        insert into todos (kind, title, notes, tenant_id, requested_by, created_by)
        values ('help', 'Help: ' || v_name, v_msg, p_tenant, auth.uid(), auth.uid());
    end if;
    return v_at;
end;
$$;

-- Has this restaurant got a request open? Drives the button's "Sent" state.
create or replace function help_status(p_tenant uuid)
returns timestamptz
language sql stable
security definer
set search_path = public
as $$
    select updated_utc from todos
     where tenant_id = p_tenant and kind = 'help' and done_utc is null
       and is_member_of(p_tenant);
$$;

-- The list as we read it: restaurant name and slug, and the asker's email to reach them.
create or replace function admin_todos()
returns table (
    id uuid, kind text, title text, notes text,
    tenant_id uuid, tenant_name text, tenant_slug text,
    requester_email text, created_utc timestamptz, updated_utc timestamptz,
    done_utc timestamptz
)
language sql stable
security definer
set search_path = public
as $$
    select t.id, t.kind, t.title, t.notes,
           t.tenant_id, tn.name, tn.slug,
           u.email::text, t.created_utc, t.updated_utc, t.done_utc
      from todos t
      left join tenants tn on tn.id = t.tenant_id
      left join auth.users u on u.id = t.requested_by
     where is_super_admin()
     order by (t.done_utc is not null), (t.kind <> 'help'), t.updated_utc desc;
$$;

revoke all on function request_help(uuid, text) from public, anon;
revoke all on function help_status(uuid)        from public, anon;
revoke all on function admin_todos()            from public, anon;
grant execute on function request_help(uuid, text) to authenticated;
grant execute on function help_status(uuid)        to authenticated;
grant execute on function admin_todos()            to authenticated;
