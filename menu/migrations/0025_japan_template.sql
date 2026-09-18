-- 0025: JAPAN — the first template that is ours.
--
-- monday_greens and elegant_black both came out of the platform's stylesheet: a row here
-- plus rules that already existed in `full.css`. This one has no rules in `full.css` at
-- all. `trim_css.py` emits the generic structural base for it, and the look lives in
-- `app/src/lib/css/japan.skin.css`, which is the only hand-written sheet in that
-- directory.
--
-- **A template must be a row here AND a sheet we ship.** 0005 wrote that rule down after
-- the picker offered a restaurant a design that did not exist; `create_tenant()` enforces
-- it by refusing any template that is not `listed`. So this row and `SHEETS` in
-- `[slug].astro` are two halves of one change and neither is any use alone.
--
-- `defaults` is the palette a restaurant on this template starts with, and here it is the
-- whole design: white paper, near-black ink, one seal red. A tenant's own `theme` is
-- merged over it at publish time (`compile_snapshot`), so a JAPAN restaurant that wants a
-- different accent changes one key and inherits the rest.

insert into templates (id, name, listed, defaults) values
    ('japan', 'Japan', true, jsonb_build_object(
        -- Paper. Not #fff for the surfaces: a card at pure white on a pure white page has
        -- no edge at all, and the hairline border in the skin would be doing the whole
        -- job on its own.
        'bg',          '#ffffff',
        'bg2',         '#fbfaf8',
        'card',        '#ffffff',
        'card2',       '#f7f5f2',
        'border',      '#e6e1da',
        -- Ink. Warm black rather than #000, which on a white screen reads as a hole.
        'text',        '#14110f',
        'dim',         '#7d746c',
        -- The seal red, and white on top of it.
        'accent',      '#c0392f',
        'accent2',     '#9c2b23',
        'accent_text', '#ffffff',
        'price_color', '#14110f',
        'badge_bg',    '#c0392f',
        'cta_bg',      '#c0392f',
        'pill_bg',        '#f2efea',
        'pill_active_bg', '#14110f',
        'cat_color',   '#7d746c',
        -- The background layer is flat, because the characters are the texture. The skin
        -- also sets `background-image: none`; this makes the row say so too, so a glance
        -- at the palette does not suggest a gradient nobody will ever see.
        'bg_image',    'none',
        'thumb_bg',    '#f7f5f2',
        'stage_bg',    '#ffffff',
        -- No glow and no drop shadow anywhere. "Clean" is mostly the absence of these.
        'glow',        'transparent',
        'glow2',       'transparent',
        'shadow',      'none',
        'item_shadow', 'none',
        'item_hover_shadow', '0 2px 10px rgba(20,17,15,.06)',
        'hero_color',  '#14110f',
        'divider_bg',  '#e6e1da',
        'modal_bg',    '#ffffff',
        'modal_ink',   '#14110f',
        'panel_ink',   '#14110f'
    ))
on conflict (id) do update
    set name = excluded.name,
        listed = excluded.listed,
        defaults = excluded.defaults;
