-- 0004_real_menu.sql — everything a real menu turned out to need.
--
-- Written after reading the LIVE Monday Greens through the public API rather than
-- guessing: 170 items, 26 categories, 30 items with variants, 37 text-only, all 170 with
-- Georgian names, and 104 theme_config keys of which only 68 are the palette. The schema
-- from 0001 could hold about a tenth of that.
--
-- Everything here is a field that is actually populated in live data. Nothing is added
-- because the platform has a column for it - `name_ru` and `description_ru` exist there
-- and are empty on all 170 rows, which Temo pointed out and the data confirmed.

-- ─────────────────────────────────────────────────────────────────────
-- Languages: a set the tenant declares, not columns somebody migrates
-- ─────────────────────────────────────────────────────────────────────
--
-- The platform has fixed `name_en` / `name_ka` / `name_ru` columns. That works for
-- Georgia and needs a migration for the first restaurant in Warsaw - which is the wrong
-- shape for something whose whole point is a global self-serve launch.
--
-- So translations are a JSON bag keyed by language, and `tenants.languages` says which
-- ones a restaurant actually offers. Monday Greens is `{en,ka}`; nothing pretends `ru`
-- exists. The snapshot compiler FLATTENS this back to `name_ka` etc., so the ported
-- viewer's `t(item, 'name')` keeps working with no change at all.

alter table tenants add column if not exists languages text[] not null default '{en}';

comment on column tenants.languages is
    'Languages this restaurant publishes, first is primary. The platform hardcodes '
    'en/ka/ru columns; this is the same idea without a migration per country.';

-- Site settings that are not the palette: hero, logo, fonts, hours, address, socials,
-- delivery links, phone layout. The platform keeps these in the SAME theme_config bag as
-- the colours, which is why a tenant there has 104 keys of two different kinds. Split,
-- because "what colour is the card" and "what time do they close" are not the same thing
-- and the theme editor should not have to know that.
alter table tenants add column if not exists settings jsonb not null default '{}'::jsonb;

comment on column tenants.settings is
    'hero_image_url, hero_images, logo_url, font_body, font_heading, phone_layout, '
    'site_address, site_hours_range, site_map_url, instagram_url, delivery_label/url. '
    'NOT the palette - that is `theme`, filtered by theme.mjs to the platform varMap.';


-- ─────────────────────────────────────────────────────────────────────
-- Items: what 170 real dishes need
-- ─────────────────────────────────────────────────────────────────────

alter table items add column if not exists i18n jsonb not null default '{}'::jsonb;
comment on column items.i18n is
    'Translations: {"ka": {"name": "...", "description": "..."}}. The `name` and '
    '`description` columns stay the primary language, so a monolingual menu never '
    'touches this.';

-- The platform stores `price` as free text - "28 ₾", and "16 / 70 ₾" for a variant-priced
-- item. Integer minor units stay the truth, because 12.30 as a float is
-- 12.299999999999999 and a menu that disagrees with the till by a tetri is a menu nobody
-- trusts. But free text is doing real work in that variant case, which no integer can
-- express, so it is available as a DISPLAY OVERRIDE only - never as the number anything
-- computes with.
alter table items add column if not exists price_text text;
alter table items add column if not exists price_old_minor integer
      check (price_old_minor is null or price_old_minor >= 0);

comment on column items.price_text is
    'Display override for prices no single number can express - "16 / 70". Falls back to '
    'price_minor. Nothing ever totals this.';

-- Display flags, all three live and all three meaning different things. The platform
-- learned this the hard way: a dish with a model that should show as a plain photo is a
-- real case, and one flag could not express it.
--   text_only  no media at all, a compact row. 37 of 170 on Monday Greens
--   is_3d      has a model AND should offer 3D/AR. Off = the model stays attached but
--              the dish behaves like a photo dish
--   thumb_3d   the CARD thumbnail is a live model rather than a photo. Off saves
--              bandwidth and a WebGL context
alter table items add column if not exists text_only boolean not null default false;
alter table items add column if not exists is_3d     boolean not null default true;
alter table items add column if not exists thumb_3d  boolean not null default false;
alter table items add column if not exists featured  boolean not null default false;

-- Sizes and extras. JSON rather than tables because they are display data with no
-- referential life of their own - nothing joins to a variant - and because the shape is
-- the platform's, so live rows import unchanged. 30 of 170 items carry variants; ZERO
-- carry addons, so that column exists to accept an import and nothing more.
alter table items add column if not exists variants jsonb not null default '[]'::jsonb;
alter table items add column if not exists addons   jsonb not null default '[]'::jsonb;

-- Where an item came from, when it came from somewhere. Lets an import run twice without
-- duplicating a menu, and says plainly which rows are ours and which are a copy.
alter table items add column if not exists source_ref text;
create unique index if not exists items_source_ref_idx
    on items (tenant_id, source_ref) where source_ref is not null;

alter table categories add column if not exists i18n jsonb not null default '{}'::jsonb;
alter table categories add column if not exists source_ref text;
create unique index if not exists categories_source_ref_idx
    on categories (tenant_id, source_ref) where source_ref is not null;


-- ─────────────────────────────────────────────────────────────────────
-- Models: the one field the AR path needs and 0001 did not have
-- ─────────────────────────────────────────────────────────────────────
--
-- The platform bakes `ar_scale` into its Quick Look launcher because ITS files are not
-- sized. Ours are - optimize.py bakes real-world scale into the GLB and usdz.py builds
-- the USDZ from the optimised one - so this is 1 for anything we generate. It exists so
-- an IMPORTED model, made before that pipeline, still places at the right size.
alter table models add column if not exists ar_scale numeric(6,3) not null default 1;

comment on column models.ar_scale is
    'Multiplier for models we did not size ourselves. 1 for everything from our pipeline.';

-- An imported model has files but no dish in the engine, so `dish` cannot be its
-- identity. Allow a plain URL for one and record where it came from.
alter table models add column if not exists external_glb  text;
alter table models add column if not exists external_usdz text;
alter table models add column if not exists source_ref    text;
create unique index if not exists models_source_ref_idx
    on models (tenant_id, source_ref) where source_ref is not null;

grant select, insert, update, delete on categories to authenticated;
grant select, insert, update, delete on items      to authenticated;
grant select, insert, update, delete on models     to authenticated;
