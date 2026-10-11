-- 0041: delete a restaurant (super admin only).
--
-- For the test restaurants that pile up in the developer console (Nika, 2026-10-10). The
-- admin asks for the slug to be typed back before it calls this, and this checks it again,
-- so a mis-click cannot reach it.
--
-- Everything that belongs to the restaurant goes with it (every foreign key to `tenants`
-- is ON DELETE CASCADE): dishes, categories, its models, events, members, publications.
-- Two things deliberately do not:
--   * a model another restaurant's dish still uses is handed to the library
--     (tenant_id = null) first, so deleting one restaurant never empties another's dish;
--   * nothing in R2 is touched. Files are never deleted (AGENTS.md); they stay as
--     training data, and `copy_tenant` shares keys between restaurants.

-- The change-history triggers (0036) log every cascaded row, against a restaurant whose
-- row is being removed in the same statement, which the foreign key refuses. While a
-- delete is running, `log_change` skips that one restaurant; its history goes with it.
create or replace function log_change(
    p_tenant uuid, p_source text, p_record text, p_label text,
    p_field text, p_old jsonb, p_new jsonb
) returns void language sql security definer
set search_path = public, pg_temp as $fn$
    insert into change_history (tenant_id, source, record_id, label, field, old_value, new_value, changed_by)
    select p_tenant, p_source, p_record, p_label, p_field, p_old, p_new, auth.uid()
     where p_tenant::text is distinct from nullif(current_setting('betareal.deleting_tenant', true), '');
$fn$;
revoke all on function log_change(uuid, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;

create or replace function delete_tenant(p_tenant uuid, p_confirm_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_slug text;
begin
    if not is_super_admin() then
        raise exception 'only BetaReal can delete a restaurant';
    end if;
    select slug into v_slug from tenants where id = p_tenant;
    if v_slug is null then
        raise exception 'no such restaurant';
    end if;
    if v_slug is distinct from p_confirm_slug then
        raise exception 'the slug typed does not match /%', v_slug;
    end if;

    update models m set tenant_id = null
     where m.tenant_id = p_tenant
       and exists (select 1 from items i
                    where i.model_id = m.id and i.tenant_id <> p_tenant);

    perform set_config('betareal.deleting_tenant', p_tenant::text, true);
    delete from tenants where id = p_tenant;
end;
$$;

revoke all on function delete_tenant(uuid, text) from public, anon;
grant execute on function delete_tenant(uuid, text) to authenticated;
