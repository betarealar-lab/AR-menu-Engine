-- 0006: creating a restaurant, atomically.
--
-- 0002 withheld INSERT on `tenants` from `authenticated` on purpose: "creating a
-- restaurant is signup, which runs server-side with the secret key and has to create the
-- tenant and its first membership together or neither."
--
-- The first half of that has aged badly. Reaching for the service key inside a request
-- handler is the exact move `check_schema.py` exists to make impossible, and a key that
-- bypasses RLS entirely should not be one route's away from every restaurant's data. The
-- second half is the real requirement, and a function gives it properly: both inserts in
-- one statement, in one transaction.
--
-- So `authenticated` still has no INSERT on `tenants`. It has permission to call exactly
-- this, which creates a restaurant it will immediately own and nothing else.

create or replace function create_tenant(
    p_name        text,
    p_slug        text,
    p_template_id text default 'monday_greens'
) returns uuid
language plpgsql
security definer
-- Pinned, because a SECURITY DEFINER function that resolves names through the caller's
-- search_path is a way to run the caller's code as the owner.
set search_path = public, pg_temp
as $$
declare
    v_id uuid;
begin
    if auth.uid() is null then
        raise exception 'not signed in' using errcode = '42501';
    end if;

    -- Only templates that are actually offered. Without this, a hand-rolled call could
    -- put a restaurant on a template whose stylesheet we do not ship, and the menu would
    -- render unstyled for real diners.
    if not exists (select 1 from templates where id = p_template_id and listed) then
        raise exception 'no such template: %', p_template_id using errcode = '22023';
    end if;

    if btrim(coalesce(p_name, '')) = '' then
        raise exception 'a restaurant needs a name' using errcode = '22023';
    end if;

    insert into tenants (slug, name, template_id, created_by, settings)
    values (p_slug, btrim(p_name), p_template_id, auth.uid(),
            jsonb_build_object('site_name', btrim(p_name),
                               'template_key', p_template_id))
    returning id into v_id;

    -- The half that has to happen or the whole thing must not. Without it the creator
    -- cannot see the restaurant they just made: `is_member_of` is what every policy asks,
    -- and inserting a tenant row does not make you a member of it.
    insert into tenant_members (tenant_id, user_id, role)
    values (v_id, auth.uid(), 'owner');

    return v_id;
end $$;

comment on function create_tenant(text, text, text) is
    'The only way a restaurant comes into existence. SECURITY DEFINER so the tenant and '
    'its first membership are one transaction - 0002 says together or neither.';

revoke all on function create_tenant(text, text, text) from public;
grant execute on function create_tenant(text, text, text) to authenticated;
