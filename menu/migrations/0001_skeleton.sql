-- 0001_skeleton.sql — tenants, menus, the model library, and publications.
--
-- The skeleton from MENU-PLATFORM.md §6. Nothing here is styled, nothing is pretty, and
-- everything connects. Read §2 of that file before changing any of it: this migration is
-- where three of the five "expensive to reverse" decisions actually live.
--
--   §2.3  every row carries a tenant, and RLS is on from the first migration. Not from
--         the second. Retrofitting tenancy is not a migration, it is an audit of every
--         query in the system forever, with one restaurant reading another's data as the
--         price of missing one.
--   §2.4  assets are addressed by content hash, never by tenant slug, so renaming a
--         restaurant does not rot every URL in every published snapshot.
--   §2.5  events are not menu data and are not in this file. ~19M rows a month against
--         ~40k of menu data; they go to an append-only sink and a rollup, later.
--
-- And DECISIONS §9.3: there is no billing, no plan, no quota column anywhere. Pricing
-- does not exist yet, and a schema that pretends to know the tiers is the wrong schema
-- built twice.

-- ─────────────────────────────────────────────────────────────────────
-- Extensions
-- ─────────────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";      -- gen_random_uuid()


-- ─────────────────────────────────────────────────────────────────────
-- Who is who
-- ─────────────────────────────────────────────────────────────────────

create table if not exists tenants (
    id           uuid primary key default gen_random_uuid(),
    -- The slug is the tenant's address, and it is deliberately NOT part of any storage
    -- key (§2.4). Renaming is a row update and nothing else moves.
    slug         text        not null unique
                 check (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
    name         text        not null,
    -- Everything a diner sees that is not an item: colours, logo, hero, hours, address.
    -- JSON rather than columns because a template's settings are the template's business
    -- and adding one must not need a migration.
    theme        jsonb       not null default '{}'::jsonb,
    template_id  text,
    created_utc  timestamptz not null default now(),
    created_by   uuid        references auth.users (id) on delete set null
);

comment on table tenants is
    'One restaurant. Everything else in this schema hangs off tenant_id.';

-- Which logins may administer which restaurant. Kept separate from tenants so a chain
-- can have several people, and one person several restaurants, without either table
-- knowing about the other''s shape.
create table if not exists tenant_members (
    tenant_id  uuid        not null references tenants (id) on delete cascade,
    user_id    uuid        not null references auth.users (id) on delete cascade,
    role       text        not null default 'owner'
               check (role in ('owner', 'staff')),
    added_utc  timestamptz not null default now(),
    primary key (tenant_id, user_id)
);

-- Us. A separate, explicit table rather than "turn RLS off when it is inconvenient",
-- which is the same mistake as a plaintext password table: it works, and then it is the
-- worst thing in the codebase.
create table if not exists super_admins (
    user_id   uuid primary key references auth.users (id) on delete cascade,
    added_utc timestamptz not null default now()
);


-- ─────────────────────────────────────────────────────────────────────
-- Templates — a registry, not fourteen hardcoded branches (§2.2)
-- ─────────────────────────────────────────────────────────────────────

create table if not exists templates (
    id           text primary key
                 check (id ~ '^[a-z0-9_]{2,40}$'),
    name         text        not null,
    -- Default theme values. A tenant''s `theme` is merged over this at publish time, so
    -- a template can gain a setting later without touching a single tenant row.
    defaults     jsonb       not null default '{}'::jsonb,
    -- Off means "exists, not offered in the catalogue yet". How a template is built and
    -- reviewed before anyone can pick it.
    listed       boolean     not null default false,
    created_utc  timestamptz not null default now()
);

comment on table templates is
    'Adding a restaurant look is a row here plus a component. Never a per-tenant branch.';


-- ─────────────────────────────────────────────────────────────────────
-- The model library
-- ─────────────────────────────────────────────────────────────────────

create table if not exists models (
    id            uuid primary key default gen_random_uuid(),
    tenant_id     uuid        not null references tenants (id) on delete cascade,
    title         text        not null default '',

    -- How this row finds its files in the engine. `dish`/`variant` are the engine's own
    -- identifiers (dataset.py), so the queue, the Scan Studio and this table all name a
    -- dish the same way. No vendor name appears here - ROADMAP Part 1, decision 5.
    dish          text        not null,
    variant       text        not null default 'default',

    -- R2 object keys for what a diner actually loads. Keys, not URLs: the bucket is
    -- private and the Worker signs or streams them, so a URL here would be a URL that
    -- expires (§2.6).
    draco_key     text,
    usdz_key      text,
    poster_key    text,

    -- Real-world size, baked into the shipped file rather than applied by the viewer.
    scale_cm      numeric(6,2),
    scale_axis    text check (scale_axis in ('width', 'height', 'length')),

    -- draft    generated, nobody has looked at it
    -- approved the owner said yes. Only these may be attached to an item
    -- rejected the owner said no. Kept, because a rejected model is the research
    tenant_state  text        not null default 'draft'
                  check (tenant_state in ('draft', 'approved', 'rejected')),
    decided_utc   timestamptz,
    decided_by    uuid        references auth.users (id) on delete set null,

    created_utc   timestamptz not null default now(),
    unique (tenant_id, dish, variant)
);

comment on column models.tenant_state is
    'The OWNER''s verdict - DECISIONS 9.4. Our internal fault tags are not in this table '
    'and are never shown to a tenant.';


-- ─────────────────────────────────────────────────────────────────────
-- The menu
-- ─────────────────────────────────────────────────────────────────────

create table if not exists categories (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid        not null references tenants (id) on delete cascade,
    name        text        not null,
    position    integer     not null default 0,
    visible     boolean     not null default true,
    created_utc timestamptz not null default now()
);

create table if not exists items (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid        not null references tenants (id) on delete cascade,
    category_id uuid        references categories (id) on delete set null,

    name        text        not null,
    description text        not null default '',
    -- Minor units, integer. 12.30 as a float is 12.299999999999999, and a menu that
    -- disagrees with the till by a tetri is a menu nobody trusts.
    price_minor integer     not null default 0 check (price_minor >= 0),
    currency    text        not null default 'GEL' check (char_length(currency) = 3),

    photo_key   text,
    -- THE POINTER. A model's "active" state is not a column on models, it is whether a
    -- row here points at it (MENU-PLATFORM §3). Nothing is copied, which is what lets
    -- one model serve every branch of a chain later.
    model_id    uuid        references models (id) on delete set null,

    visible     boolean     not null default true,
    position    integer     not null default 0,
    created_utc timestamptz not null default now()
);

create index if not exists items_tenant_idx      on items (tenant_id, position);
create index if not exists items_model_idx       on items (model_id) where model_id is not null;
create index if not exists categories_tenant_idx on categories (tenant_id, position);
create index if not exists models_tenant_idx     on models (tenant_id, tenant_state);


-- ─────────────────────────────────────────────────────────────────────
-- Publishing — the line between the owner's draft and what diners get
-- ─────────────────────────────────────────────────────────────────────
--
-- Everything above is the DRAFT. It is edited continuously and no diner ever reads it.
-- Publishing compiles it into one immutable JSON object on R2, and the menu Worker
-- renders from that (§2.1). This table is the log of those compiles and the pointer to
-- the current one.

create table if not exists publications (
    id             uuid primary key default gen_random_uuid(),
    tenant_id      uuid        not null references tenants (id) on delete cascade,
    -- Monotonic per tenant. It is also the edge cache key, which is why a publish takes
    -- effect in seconds: a new version is a new key, not a purge that has to propagate.
    version        bigint      not null,
    snapshot_key   text        not null,
    -- Of the snapshot bytes. Publishing twice with no edits in between should not
    -- invalidate a cache that is serving correctly.
    snapshot_sha   text        not null,
    item_count     integer     not null default 0,
    model_count    integer     not null default 0,
    published_utc  timestamptz not null default now(),
    published_by   uuid        references auth.users (id) on delete set null,
    unique (tenant_id, version)
);

-- Exactly one live publication per tenant, enforced rather than remembered.
create table if not exists live_publication (
    tenant_id      uuid primary key references tenants (id) on delete cascade,
    publication_id uuid not null references publications (id) on delete restrict,
    updated_utc    timestamptz not null default now()
);


-- ─────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────
--
-- On for every table, with no exceptions and no "we will add it later". The publishable
-- key ships in the browser by design, and it is only safe because of what follows.

create or replace function is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from super_admins where user_id = auth.uid());
$$;

create or replace function is_member_of(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from tenant_members
        where tenant_id = t and user_id = auth.uid()
    ) or exists (select 1 from super_admins where user_id = auth.uid());
$$;

comment on function is_member_of(uuid) is
    'SECURITY DEFINER on purpose: a policy on tenant_members that queried tenant_members '
    'would recurse. Both functions are the only place that decision is made.';

alter table tenants          enable row level security;
alter table tenant_members   enable row level security;
alter table super_admins     enable row level security;
alter table templates        enable row level security;
alter table models           enable row level security;
alter table categories       enable row level security;
alter table items            enable row level security;
alter table publications     enable row level security;
alter table live_publication enable row level security;

-- Force it even for the table owner, so a future SECURITY DEFINER function cannot
-- quietly become a way around all of this.
alter table tenants          force row level security;
alter table tenant_members   force row level security;
alter table models           force row level security;
alter table categories       force row level security;
alter table items            force row level security;
alter table publications     force row level security;
alter table live_publication force row level security;

-- Tenants -------------------------------------------------------------
drop policy if exists tenants_read  on tenants;
drop policy if exists tenants_write on tenants;
create policy tenants_read on tenants for select
    using (is_member_of(id));
create policy tenants_write on tenants for update
    using (is_member_of(id)) with check (is_member_of(id));

-- Membership ----------------------------------------------------------
drop policy if exists members_read on tenant_members;
create policy members_read on tenant_members for select
    using (user_id = auth.uid() or is_super_admin());

-- Super admins: readable only by super admins. Nobody else needs to know we exist.
drop policy if exists super_read on super_admins;
create policy super_read on super_admins for select using (is_super_admin());

-- Templates: the catalogue is meant to be browsable by any signed-in owner choosing one.
-- Only listed ones, and only we may write.
drop policy if exists templates_read  on templates;
drop policy if exists templates_write on templates;
create policy templates_read on templates for select
    using (listed or is_super_admin());
create policy templates_write on templates for all
    using (is_super_admin()) with check (is_super_admin());

-- Everything owned by a tenant, one shape repeated ---------------------
do $$
declare t text;
begin
    foreach t in array array['models', 'categories', 'items', 'publications']
    loop
        execute format('drop policy if exists %I on %I', t || '_rw', t);
        execute format($f$
            create policy %I on %I for all
                using (is_member_of(tenant_id))
                with check (is_member_of(tenant_id))
        $f$, t || '_rw', t);
    end loop;
end $$;

drop policy if exists live_rw on live_publication;
create policy live_rw on live_publication for all
    using (is_member_of(tenant_id)) with check (is_member_of(tenant_id));

-- Note what has NO policy for the anon role: all of it. A diner is not signed in and
-- never queries any of this - they read a rendered page from the edge (§2.1). If a
-- diner-facing feature ever seems to need a row from here, the answer is to put it in
-- the snapshot, not to add a policy.
