-- 0027: the library is every model, not a list somebody curates.
--
-- Temo, looking at an empty library: *"every model is part of betareal libraly"*.
--
-- 0024 built `shared` as opt-in - default false, and a super admin ticks each model they
-- want reusable. That was my addition, not the ask, and it makes the feature useless at
-- the moment it is most useful: a new restaurant with no 3D of its own, and a library
-- that is empty because nobody has been through twenty-four models ticking boxes.
--
-- So the default flips. Every model is in the library, and `shared` becomes the way to
-- take one OUT - for the case that actually needs a decision, which is a client's dish
-- nobody else should be offered.
--
-- Three things follow from the flip, and the third is the one that would have been a
-- quiet mistake.

-- 1 · The default, and the models that already exist ----------------------------------

alter table models alter column shared set default true;

-- Everything made before today. There is no "was it deliberate" to preserve here: the
-- column has existed for one day and nothing has been ticked, so every false is a default
-- rather than a decision.
update models set shared = true where not shared;

comment on column models.shared is
    'In the BetaReal library: this model may be attached to an item in ANY tenant. TRUE by '
    'default (0027) - the library is every model. Set to false to take one out, which only '
    'a super admin may do. The publish paths read it: a model from another tenant that is '
    'not shared is never served.';


-- 2 · Who may change it ----------------------------------------------------------------
--
-- The guard in 0024 refused a non-super-admin on INSERT as well as UPDATE, because
-- `shared = true` on the way in was a way to put your own dish into a curated list.
--
-- With the default true that check is now simply wrong: it would reject every ordinary
-- insert, since the row arrives shared whether anybody asked for it or not. Worse, it
-- would reject it with "only a super admin may put a model in the BetaReal library" - a
-- sentence about a decision nobody made.
--
-- Putting a model in the library is no longer a privileged act, because it is the
-- default. TAKING ONE OUT still is, and that is a change, so the guard now watches
-- changes only.
create or replace function models_shared_guard()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
    -- The engine writes with the service key, where `auth.uid()` is null. It has no
    -- reason to touch this column, and if it ever does, that is us rather than a client.
    if new.shared is distinct from old.shared
       and auth.uid() is not null and not is_super_admin() then
        raise exception 'only a super admin may change whether a model is in the BetaReal library'
            using errcode = '42501';
    end if;
    return new;
end $fn$;

drop trigger if exists models_shared_guard on models;
create trigger models_shared_guard
    before update on models
    for each row execute function models_shared_guard();

comment on function models_shared_guard() is
    'Only a super admin may change models.shared. Since 0027 the column defaults to true, '
    'so this is about taking a model OUT of the library - putting one in is no longer a '
    'decision anybody makes.';


-- 3 · Reading one, which is where the flip has teeth -----------------------------------
--
-- 0024 gave `models` a permissive policy `using (shared)`, so any signed-in user could
-- read any shared row. That was safe while "shared" meant a handful of stock models we
-- had deliberately published. It is NOT safe now that it means every model in the system:
-- the owner of one restaurant could list every dish model of every other, by title, and
-- the first person to notice would be a competitor who signed up.
--
-- The reason that policy exists is narrow and worth keeping: a restaurant that has been
-- LENT a model must be able to read the row, or its own admin shows a 3D dish as having
-- no 3D while diners see the 3D perfectly well. So the policy now says exactly that, and
-- nothing wider - you may read a shared model you are actually using.
--
-- A super admin already reads everything through `is_member_of()`, so browsing the
-- library is unaffected; this only stops enumeration by everybody else.
drop policy if exists models_shared_read on models;
create policy models_shared_read on models for select
    using (
        shared and exists (
            select 1 from items i
             where i.model_id = models.id
               and is_member_of(i.tenant_id)
        )
    );

comment on policy models_shared_read on models is
    'A restaurant may read a library model it has on one of its own dishes - and only '
    'that one. Without this the borrowing tenant''s admin cannot resolve the model on its '
    'own item; with anything wider, every owner could enumerate every other restaurant''s '
    'models (0027).';
