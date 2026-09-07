-- 0016: remember where a dish photo came from, so downscaling it is reversible.
--
-- Temo, on the deployed menu: "loading the photos takes forever."
--
-- Measured rather than guessed. Monday Greens' 170 dishes carry 135 photos: 99 from the
-- platform's public r2.dev bucket and 27 straight from Wolt's CDN. Every one of them is
-- **1200 x 675**, and the card draws it at 430 px wide - eight times the pixels a phone
-- can show, about 150 KB each, roughly 20 MB for one menu. The r2.dev objects also come
-- back with no `Cache-Control` header at all, so a diner who returns tomorrow downloads
-- the lot again.
--
-- `menu/photos.py` fixes that by re-encoding each one to 860 px WebP in OUR bucket - about
-- 25 KB, served same-origin, immutable - and repointing `items.photo_key` at the result.
--
-- **This column is what makes that safe to run.** The original URL is the only copy of the
-- source: once `photo_key` is overwritten there is nothing to re-derive a bigger size from
-- when a card layout changes, nothing to compare against when a re-encode looks wrong, and
-- no way to undo a bad batch. It is one text column and it removes the entire class of
-- "we optimised the photos and now we cannot get them back".
--
-- It is also the shape the self-serve product needs anyway: an owner uploads a photo from
-- their phone, we keep what they gave us and serve a derivative. Same two fields.

alter table items add column if not exists photo_source_url text;

comment on column items.photo_source_url is
  'Where photo_key was derived from. Set by menu/photos.py when it downscales an '
  'imported or uploaded photo; null when photo_key IS the original. Never served to a '
  'diner - the page only ever gets photo_key.';

-- Which dishes still carry a full-size photo. The job reads this, and it is the honest
-- answer to "is the menu still shipping 20 MB of pictures".
create or replace view items_photo_debt as
select t.slug           as tenant,
       count(*)         as photos,
       count(*) filter (where i.photo_source_url is null
                          and i.photo_key ~ '^https?://') as unoptimised
from items i
join tenants t on t.id = i.tenant_id
where i.photo_key is not null and i.visible
group by t.slug
order by 3 desc, 1;
