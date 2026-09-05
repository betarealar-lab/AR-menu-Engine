-- 0003_model_view.sql — the starting camera angle for a model.
--
-- The live platform already has this and it is not cosmetic: a dish generated from one
-- photograph has an arbitrary default orientation, and a bowl framed from its own rim
-- shows an empty ellipse. Somebody sets the angle once and every diner sees the dish.
--
-- Same convention as production so the number a person already learned still means the
-- same thing: `"h v zoom"` - horizontal degrees, vertical degrees, zoom percent - handed
-- to model-viewer as a `camera-orbit`. Clamped by the renderer, not here, because a
-- constraint that rejects a save is worse than one that renders sensibly.
--
-- **It lives on `models`, not on `items`, and that is a deliberate difference from the
-- platform**, which stores it in `theme_config` as `item_view_<itemId>`. The angle
-- describes how to frame a MESH. Attach the same model to a second item - which is the
-- whole point of the library being pointers rather than copies (MENU-PLATFORM §3) - and
-- the framing should travel with it rather than have to be typed again.

alter table models add column if not exists view_orbit text;

comment on column models.view_orbit is
    '"h v zoom" - degrees, degrees, percent. Empty or null means model-viewer''s default '
    'framing. Same format as the platform''s item_view_<id> theme_config entries.';
