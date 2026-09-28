-- 0030 · The library owns models. The developer Studio makes them there.
--
-- Until now every model belonged to a restaurant (`models.tenant_id not null`) and "the
-- library" was restaurant models with `shared = true`. That made a model BetaReal built
-- for itself - a demo dish, a stock plate, a test of a new engine - either impossible or a
-- lie: it had to be filed under some restaurant that never asked for it, and it showed up
-- in that restaurant's Studio, its counts and its analytics.
--
-- Temo, 2026-09-28: developers get an independent 3D Studio that adds to the library, not
-- to a tenant's model list. So:
--
--   * `models.tenant_id` may be NULL. NULL means BetaReal's own - the library.
--   * A library model is always `shared`. There is no such thing as a private library
--     model: "ours, and nobody may borrow it" is a draft, and draft already exists.
--   * `model_requests.tenant_id` may be NULL too, so a developer can generate straight
--     into the library through the same queue, bridge and engine as everybody else.
--   * A new request kind, `upload`: a GLB a developer already has (a Meshy web export, a
--     hand-fixed Blender file) goes through the SAME optimiser as a generated master -
--     decimate, texture budget, real-world scale, Draco, USDZ - instead of shipping raw.
--     Before this, an uploaded .glb went straight onto the menu exactly as uploaded.
--   * `engine_requested`: which engine a developer asked for. The engine is ours to
--     choose, never a client's, so the gate clears it for anyone who is not a super admin.
--
-- Nothing here changes what a restaurant can do. Every NULL-tenant path is super-admin
-- only, and that is enforced by the policies that already exist: `is_member_of(NULL)` is
-- true for a super admin and false for everybody else (0001), so an owner cannot read,
-- write or request a library row - the rule needs no second copy.


-- 1 · models ---------------------------------------------------------------------------

alter table models alter column tenant_id drop not null;

alter table models drop constraint if exists models_library_is_shared;
alter table models add constraint models_library_is_shared
    check (tenant_id is not null or shared);

comment on column models.tenant_id is
    'The restaurant that owns this model, or NULL for the BetaReal library (0030). A '
    'library model is always shared (models_library_is_shared).';

-- The existing unique (tenant_id, dish, variant) treats NULLs as distinct, so it does not
-- stop two library rows for one dish. This does, and it is the conflict target the bridge
-- upserts against for a library request.
create unique index if not exists models_library_dish
    on models (dish, variant) where tenant_id is null;


-- 2 · model_requests -------------------------------------------------------------------

alter table model_requests alter column tenant_id drop not null;

alter table model_requests drop constraint if exists model_requests_kind_check;
alter table model_requests add constraint model_requests_kind_check
    check (kind in ('generate', 'rescale', 'upload'));

alter table model_requests add column if not exists engine_requested text;

comment on column model_requests.engine_requested is
    'The engine a developer picked (engines.REGISTRY name). NULL = the default. Cleared '
    'by the gate for anyone who is not a super admin (0030).';

create index if not exists model_requests_library
    on model_requests (state, requested_utc desc) where tenant_id is null;


-- 3 · The gate -------------------------------------------------------------------------
--
-- Restated in full (no partial `create or replace`). 0029 plus the three rules at the top:
-- library requests, uploads and engine choice are ours alone.
create or replace function model_request_gate()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
    v_quota integer;
    v_studio boolean;
    v_staff boolean := auth.uid() is null or is_super_admin();
begin
    new.requested_by := auth.uid();
    new.requested_utc := now();

    -- The library is BetaReal's. RLS already refuses an owner here (is_member_of(NULL) is
    -- false for them), but the error that produces is an opaque RLS violation; this says
    -- what happened.
    if new.tenant_id is null and not v_staff then
        raise exception 'only BetaReal may add to the library' using errcode = '42501';
    end if;

    -- An upload is a model we made or fixed by hand. Clients ask for models; they do not
    -- ship files (the same rule /api/asset enforces for the bytes).
    if new.kind = 'upload' and not v_staff then
        raise exception 'BetaReal builds the 3D models' using errcode = '42501';
    end if;

    if not v_staff then
        new.engine_requested := null;
    end if;

    select studio into v_studio from tenants where id = new.tenant_id;
    if v_studio is false and not v_staff then
        raise exception 'the 3D Studio is not part of this restaurant''s plan'
            using errcode = '42501';
    end if;

    if new.width_cm is not null then
        new.scale_cm := new.width_cm;  new.scale_axis := 'width';
    elsif new.length_cm is not null then
        new.scale_cm := new.length_cm; new.scale_axis := 'length';
    elsif new.height_cm is not null then
        new.scale_cm := new.height_cm; new.scale_axis := 'height';
    elsif new.scale_cm is null then
        new.scale_axis := null;
    end if;

    -- Neither spends a credit: a rescale re-optimises a master we have, an upload
    -- optimises a master somebody handed us.
    if new.kind in ('rescale', 'upload') then
        new.state := 'approved';
        new.decided_utc := now();
        return new;
    end if;

    select model_quota into v_quota from tenants where id = new.tenant_id;
    if is_super_admin()
       or model_requests_used(new.tenant_id) < coalesce(v_quota, 0) then
        new.state := 'approved';
        new.decided_utc := now();
    else
        new.state := 'pending';
        new.note := 'Waiting for us to approve this one.';
    end if;
    return new;
end $fn$;

comment on function model_request_gate() is
    'Runs on INSERT, before the row lands. Library requests, uploads and engine choice are '
    'BetaReal''s alone (0030); then the plan (0029); then the starting state (0007/0023).';


-- 4 · The developer directory ----------------------------------------------------------
--
-- Everything the restaurant list on the developer console needs, in one call, so the page
-- can search and sort in the browser without a round trip per keystroke. Super admins
-- only: anybody else gets zero rows, not an error (same shape as admin_overview, 0014).
create or replace function admin_directory()
returns table (
    tenant_id       uuid,
    slug            text,
    name            text,
    template_id     text,
    studio          boolean,
    setup_done      boolean,
    created_utc     timestamptz,
    members         bigint,
    categories      bigint,
    dishes          bigint,
    dishes_3d       bigint,
    models          bigint,
    models_draft    bigint,
    requests_open   bigint,
    requests_failed bigint,
    sessions_7d     bigint,
    last_event_utc  timestamptz,
    embed_on        boolean
)
language sql stable security definer
set search_path = public, pg_temp
as $fn$
    select t.id, t.slug, t.name, t.template_id, t.studio, t.setup_done, t.created_utc,
           (select count(*) from tenant_members tm where tm.tenant_id = t.id),
           (select count(*) from categories c where c.tenant_id = t.id),
           (select count(*) from items i where i.tenant_id = t.id and i.visible),
           (select count(*) from items i where i.tenant_id = t.id and i.visible
                                           and i.model_id is not null and i.is_3d),
           (select count(*) from models m where m.tenant_id = t.id and not m.archived),
           (select count(*) from models m where m.tenant_id = t.id and not m.archived
                                            and m.tenant_state = 'draft'),
           (select count(*) from model_requests r where r.tenant_id = t.id
                     and r.state in ('pending', 'approved', 'running')),
           (select count(*) from model_requests r where r.tenant_id = t.id
                     and r.state = 'failed'),
           (select count(distinct e.session) from events e where e.tenant_id = t.id
                     and e.created_utc > now() - interval '7 days'),
           (select max(e.created_utc) from events e where e.tenant_id = t.id),
           -- No row means the defaults, and the default is on (0028).
           coalesce((select te.active from tenant_embed te where te.tenant_id = t.id), true)
      from tenants t
     where is_super_admin()
     order by t.name
$fn$;

revoke all on function admin_directory() from public, anon;
grant execute on function admin_directory() to authenticated;

comment on function admin_directory() is
    'Every restaurant with the numbers the developer console searches and sorts on. Super '
    'admins only; everyone else gets no rows (0030).';
