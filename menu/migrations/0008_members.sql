-- 0008: letting somebody else into a restaurant.
--
-- 0002 gave `authenticated` SELECT on `tenant_members` and nothing else, so nobody could
-- add anybody - the only membership that has ever existed was the one `create_tenant()`
-- writes for whoever made the restaurant. That is fine for one founder and useless for a
-- restaurant with a manager and two staff.
--
-- Same shape as 0006 and for the same reason: a function rather than a grant. An INSERT
-- grant on `tenant_members` would let a member add themselves to a DIFFERENT restaurant -
-- the policy can only see the row being written, and that row would look perfectly legal.
-- The check has to be "am I already in the tenant I am writing to", which is a statement
-- about the caller and not about the row, so it lives in a function.

create or replace function add_tenant_member(
    p_tenant uuid,
    p_user   uuid,
    p_role   text default 'staff'
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
    if auth.uid() is null then
        raise exception 'not signed in' using errcode = '42501';
    end if;

    -- The whole point of the function. Being a member of restaurant A must not be a way
    -- to write yourself into restaurant B.
    if not is_member_of(p_tenant) then
        raise exception 'not your restaurant' using errcode = '42501';
    end if;

    if p_role not in ('owner', 'staff') then
        raise exception 'unknown role: %', p_role using errcode = '22023';
    end if;

    insert into tenant_members (tenant_id, user_id, role)
    values (p_tenant, p_user, p_role)
    on conflict (tenant_id, user_id) do update set role = excluded.role;
end $fn$;

comment on function add_tenant_member(uuid, uuid, text) is
    'Add somebody to a restaurant you are already in. SECURITY DEFINER because the rule is '
    'about the CALLER, not about the row - an INSERT policy cannot express it.';


create or replace function remove_tenant_member(p_tenant uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
    if not is_member_of(p_tenant) then
        raise exception 'not your restaurant' using errcode = '42501';
    end if;

    -- Removing yourself when you are the last one leaves a restaurant nobody can edit and
    -- no way to fix it from inside the product. Blocked here rather than in a screen,
    -- because a screen is not where a rule like this survives.
    if p_user = auth.uid()
       and (select count(*) from tenant_members where tenant_id = p_tenant) <= 1 then
        raise exception 'you are the only person with access'
            using errcode = '23503';
    end if;

    delete from tenant_members where tenant_id = p_tenant and user_id = p_user;
end $fn$;

comment on function remove_tenant_member(uuid, uuid) is
    'Refuses to remove the last member. A restaurant nobody can edit cannot be fixed from '
    'inside the product.';

revoke all on function add_tenant_member(uuid, uuid, text) from public;
revoke all on function remove_tenant_member(uuid, uuid) from public;
grant execute on function add_tenant_member(uuid, uuid, text) to authenticated;
grant execute on function remove_tenant_member(uuid, uuid)    to authenticated;


-- Reading who else is in a restaurant with you.
--
-- `members_read` in 0001 is `user_id = auth.uid() or is_super_admin()`, so an owner could
-- see their OWN membership row and nothing else - a members list that always had exactly
-- one person in it. Widened to everyone in a restaurant you belong to, which is the set
-- the screen is for.
drop policy if exists members_read on tenant_members;
create policy members_read on tenant_members for select
    using (user_id = auth.uid() or is_member_of(tenant_id));
