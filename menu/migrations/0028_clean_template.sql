-- 0028: CLEAN — the generic restaurant catalogue.
--
-- Temo wanted a demo "like japan but for a normal restaurant ... simple catalog with good
-- colors white background". JAPAN's look is two things, the shape and the wallpaper, and
-- only the wallpaper is Japanese. CLEAN is the shape on its own: white paper, dark ink, one
-- warm accent, so the dishes and their 3D models are the design.
--
-- Same two halves as every template (0005): this row, and a stylesheet the menu app ships
-- (`clean.css` generated + `clean.skin.css` hand-written, both in `[slug].astro` SHEETS).
-- `create_tenant()` refuses any template that is not `listed`, so neither half is any use
-- without the other.
--
-- The accent is a burnt orange rather than JAPAN's seal red, so the two demos do not read
-- as one template in two colours. Warm tones are what makes food look like food; a cool
-- accent beside a plate of khachapuri makes the plate look cold.
--
-- `public_menu` merges these under the restaurant's own theme (0026), so a restaurant on
-- CLEAN changes its accent in the theme editor and keeps the rest.

insert into templates (id, name, listed, defaults) values
    ('clean', 'Clean', true, jsonb_build_object(
        'bg',          '#ffffff',
        'bg2',         '#fafaf9',
        'card',        '#ffffff',
        'card2',       '#f5f5f4',
        'border',      '#e7e5e4',
        'text',        '#1c1917',
        'dim',         '#78716c',
        'accent',      '#c2410c',
        'accent2',     '#9a3412',
        'accent_text', '#ffffff',
        'price_color', '#1c1917',
        'badge_bg',    '#c2410c',
        'cta_bg',      '#c2410c',
        'add_btn_color', '#c2410c',
        'pill_bg',        '#f5f5f4',
        'pill_active_bg', '#1c1917',
        'cat_color',   '#1c1917',
        'bg_image',    'none',
        'thumb_bg',    '#f5f5f4',
        'stage_bg',    '#fafaf9',
        'glow',        'transparent',
        'glow2',       'transparent',
        'shadow',      'none',
        'item_shadow', 'none',
        'item_hover_shadow', '0 6px 20px rgba(28,25,23,0.08)',
        'hero_color',  '#1c1917',
        'divider_bg',  '#e7e5e4',
        'modal_bg',    '#ffffff',
        'modal_ink',   '#1c1917',
        'panel_ink',   '#1c1917'
    ))
on conflict (id) do update
    set name = excluded.name,
        listed = excluded.listed,
        defaults = excluded.defaults;
