-- Team-only restaurant removal. No storage calls: R2 files are never deleted.
-- Delete children with history triggers BEFORE their tenant (0036), otherwise
-- log_change references a missing tenant and the entire deletion rolls back.
create or replace function public.remove_tenant(p_tenant uuid, p_slug text)
returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_slug text;
begin
    if auth.uid() is null or not public.is_super_admin() then
        raise exception 'Only a BetaReal super admin can remove restaurants' using errcode = '42501';
    end if;
    -- Take the same table locks first for simultaneous removals (avoid lock inversion).
    lock table public.items, public.models, public.model_requests in share row exclusive mode;
    select slug into v_slug from public.tenants where id = p_tenant for update;
    if not found then
        raise exception 'Restaurant no longer exists';
    end if;
    if p_slug is distinct from v_slug then
        raise exception 'Confirmation does not match the current restaurant address';
    end if;
    -- Serialize model assignments and engine state changes through the checks.
    if exists (select 1 from public.items i join public.models m on m.id = i.model_id
               where m.tenant_id = p_tenant and i.tenant_id <> p_tenant) then
        raise exception 'Another restaurant uses this restaurant''s models. Reassign those models before removing it.';
    end if;
    if exists (select 1 from public.model_requests where tenant_id = p_tenant
               and state in ('approved', 'running')) then
        raise exception 'This restaurant has active engine work. Wait for it to finish before removing it.';
    end if;
    delete from public.items where tenant_id = p_tenant;
    delete from public.categories where tenant_id = p_tenant;
    -- Historical publication pointer has a RESTRICT link to publications.
    delete from public.live_publication where tenant_id = p_tenant;
    delete from public.tenants where id = p_tenant;
    return p_tenant;
end $$;
revoke all on function public.remove_tenant(uuid, text) from public, anon;
grant execute on function public.remove_tenant(uuid, text) to authenticated;
