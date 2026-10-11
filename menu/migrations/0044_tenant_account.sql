-- 0044: a restaurant's logins, as BetaReal sees them (super admin only).
--
-- Nika, 2026-10-11: the developer console's "Account" button - who can sign in to a
-- restaurant's admin, when they last signed in, when they were last active, and what they
-- did. Passwords are NOT here and cannot be: Supabase keeps only a one-way hash. The page
-- offers a reset link instead (admin/app/api/account-reset).
--
--   sign-ins   auth.sessions - one row per signed-in device: when it started, when it was
--              last refreshed (the admin refreshes while open), and the browser
--   activity   change_history (0036) - every edit, with who made it

create or replace function admin_tenant_account(p_tenant uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = public, auth
as $$
declare
    v jsonb;
begin
    if not is_super_admin() then
        raise exception 'only BetaReal can see a restaurant''s logins';
    end if;

    select jsonb_build_object(
        'tenant', (select jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug,
                                             'created_utc', t.created_utc)
                     from tenants t where t.id = p_tenant),
        'members', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'user_id', u.id,
                       'email', u.email,
                       'role', m.role,
                       'added_utc', m.added_utc,
                       'created_utc', u.created_at,
                       'confirmed', u.email_confirmed_at is not null,
                       'last_sign_in_utc', u.last_sign_in_at,
                       'last_active_utc', greatest(
                           (select max(coalesce(s.refreshed_at, s.updated_at, s.created_at))
                              from auth.sessions s where s.user_id = u.id),
                           (select max(h.changed_at) from change_history h
                             where h.changed_by = u.id and h.tenant_id = p_tenant),
                           u.last_sign_in_at),
                       'edits', (select count(*) from change_history h
                                  where h.changed_by = u.id and h.tenant_id = p_tenant),
                       'is_super', exists (select 1 from super_admins sa where sa.user_id = u.id))
                   order by m.role, u.email)
              from tenant_members m join auth.users u on u.id = m.user_id
             where m.tenant_id = p_tenant), '[]'::jsonb),
        'sessions', coalesce((
            select jsonb_agg(x order by x->>'started_utc' desc) from (
                select jsonb_build_object(
                           'email', u.email,
                           'started_utc', s.created_at,
                           'seen_utc', coalesce(s.refreshed_at, s.updated_at, s.created_at),
                           'user_agent', left(coalesce(s.user_agent, ''), 200)) as x
                  from auth.sessions s
                  join tenant_members m on m.user_id = s.user_id and m.tenant_id = p_tenant
                  join auth.users u on u.id = s.user_id
                 order by s.created_at desc
                 limit 50) q), '[]'::jsonb),
        'activity', coalesce((
            select jsonb_agg(x order by (x->>'at') desc) from (
                select jsonb_build_object(
                           'at', h.changed_at,
                           'email', u.email,
                           'source', h.source,
                           'label', h.label,
                           'field', h.field,
                           'old', left(coalesce(h.old_value #>> '{}', ''), 160),
                           'new', left(coalesce(h.new_value #>> '{}', ''), 160)) as x
                  from change_history h
                  left join auth.users u on u.id = h.changed_by
                 where h.tenant_id = p_tenant
                 order by h.changed_at desc
                 limit 200) q), '[]'::jsonb)
    ) into v;
    return v;
end;
$$;

revoke all on function admin_tenant_account(uuid) from public, anon;
grant execute on function admin_tenant_account(uuid) to authenticated;
