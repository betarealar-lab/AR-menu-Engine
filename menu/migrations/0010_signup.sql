-- 0010: the front door.
--
-- Self-serve signup, behind an invite code. Temo, 2026-09-06: "goal is self serve but I
-- don't want it available to public before we do testing." A code is the door: you hand
-- one to a restaurant, and without one the signup form does not exist. No allowlist of
-- emails to maintain, nothing to forget to remove.
--
-- Two columns a restaurant needs from its first day and cannot easily gain later:
-- `country`, which decides the currency and the default menu language, and `currency`,
-- which is written once at signup and read by every price on every page from then on. A
-- price without a currency is a number, and a menu that has to guess what a number means
-- is a menu that will guess wrong for the first restaurant outside Georgia.

alter table tenants add column if not exists country  text not null default 'GE'
    check (country ~ '^[A-Z]{2}$');
alter table tenants add column if not exists currency text not null default 'GEL'
    check (currency ~ '^[A-Z]{3}$');

comment on column tenants.currency is
    'Set once at signup from the country. Every price_minor on every item is in this.';


create table if not exists invites (
    code        text primary key
                check (code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$'),
    -- What this code was for. "Corner at Tabidze, met at the jazz night" is worth more
    -- in a month than the code itself.
    note        text        not null default '',
    uses_left   integer     not null default 1 check (uses_left >= 0),
    created_by  uuid        references auth.users (id) on delete set null,
    created_utc timestamptz not null default now(),
    -- Who redeemed it, and into what. One code, one restaurant, is the normal case; a
    -- multi-use code for an event is the reason `uses_left` is a number and this is the
    -- LAST redemption rather than a list.
    used_by     uuid        references auth.users (id) on delete set null,
    used_tenant uuid        references tenants (id) on delete set null,
    used_utc    timestamptz
);

comment on table invites is
    'The door. Readable by super admins only; redeemed through redeem_invite(), never '
    'by a direct update.';

alter table invites enable row level security;
alter table invites force  row level security;

drop policy if exists invites_admin on invites;
create policy invites_admin on invites for all
    using (is_super_admin()) with check (is_super_admin());

grant select, insert, update, delete on invites to authenticated;
-- The policy is what limits that grant to super admins; an owner gets an empty set.


-- Is this code any good? Callable before an account exists, because that is when the
-- question is asked. It answers yes or no and nothing else - not the note, not who made
-- it, not how many uses are left - so it cannot be used to enumerate anything.
create or replace function invite_valid(p_code text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $fn$
    select exists (
        select 1 from invites
         where code = upper(btrim(p_code)) and uses_left > 0
    );
$fn$;

revoke all on function invite_valid(text) from public;
grant execute on function invite_valid(text) to anon, authenticated;


-- Redeeming: the invite, the restaurant and the first membership in one transaction.
--
-- Called AS THE NEW USER, right after their account exists and they are signed in. It
-- reuses create_tenant() so there is still exactly one way a restaurant comes into being
-- (0006), and it burns the code in the same statement - a crash between the two would
-- otherwise leave a restaurant with an unused code, or a used code with no restaurant.
create or replace function redeem_invite(
    p_code        text,
    p_name        text,
    p_slug        text,
    p_template_id text default 'monday_greens',
    p_country     text default 'GE'
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_code   text := upper(btrim(p_code));
    v_tenant uuid;
    v_currency text;
begin
    if auth.uid() is null then
        raise exception 'not signed in' using errcode = '42501';
    end if;

    -- Locked, so two people redeeming the last use of one code at the same moment cannot
    -- both succeed.
    perform 1 from invites where code = v_code and uses_left > 0 for update;
    if not found then
        raise exception 'that invite code is not valid' using errcode = '22023';
    end if;

    -- The currency follows the country, and it is decided HERE and not by the client,
    -- because a client that could pick its own currency could pick a cheap one.
    v_currency := case upper(p_country)
        when 'GE' then 'GEL'
        when 'US' then 'USD'
        when 'GB' then 'GBP'
        when 'TR' then 'TRY'
        when 'AM' then 'AMD'
        when 'AZ' then 'AZN'
        when 'UA' then 'UAH'
        when 'KZ' then 'KZT'
        when 'AE' then 'AED'
        else 'EUR'
    end;

    v_tenant := create_tenant(p_name, p_slug, p_template_id);

    update tenants
       set country = upper(p_country), currency = v_currency
     where id = v_tenant;

    update invites
       set uses_left = uses_left - 1,
           used_by = auth.uid(), used_tenant = v_tenant, used_utc = now()
     where code = v_code;

    return v_tenant;
end $fn$;

comment on function redeem_invite(text, text, text, text, text) is
    'Burns the code and creates the restaurant in one transaction. Reuses create_tenant() '
    'so there is still exactly one way a restaurant comes into being.';

revoke all on function redeem_invite(text, text, text, text, text) from public;
grant execute on function redeem_invite(text, text, text, text, text) to authenticated;


-- Whether a restaurant has finished setting up. Read by the admin to decide whether to
-- show the guided flow or the home screen; written by the flow when it completes. A
-- column rather than "has three dishes", because the owner may legitimately skip steps and
-- must not be dragged back into a wizard every time they sign in.
alter table tenants add column if not exists setup_done boolean not null default false;
