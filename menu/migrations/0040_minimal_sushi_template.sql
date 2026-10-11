-- 0040: MINIMAL_SUSHI — Food & Market's template, for its copy on the rebuild.
--
-- On the platform Food & Market runs `minimal_sushi` plus ~100 rules scoped to its own
-- tenant. The stylesheet half is generated from the live page
-- (`menu/render/extract_food_market.py` -> `minimal_sushi.css`, plus our
-- `minimal_sushi.skin.css` for the kitchen split); this is the row half.
--
-- Not `listed`: it is one restaurant's look, not something a new restaurant should pick.
-- The colours come from the restaurant's own imported theme, so `defaults` is empty.

insert into templates (id, name, listed, defaults)
values ('minimal_sushi', 'Food & Market', false, '{}'::jsonb)
on conflict (id) do nothing;
