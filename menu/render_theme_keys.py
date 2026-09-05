"""The palette key names, shared by the Python importer and the JS renderer.

`theme.mjs` owns the authoritative map (it is the platform's own `varMap`, key for key).
This is the same key SET, in Python, so `import_tenant.py` can tell a colour from a
closing time when it splits a live `theme_config` bag - the platform keeps both in one
place and a real tenant has 104 keys of the two kinds mixed together.

Kept as a plain list rather than parsed out of the .mjs at runtime: an importer that
silently mis-sorts a key is worse than one that fails a check, and `check_render.py`
asserts the two stay in step.
"""

PALETTE_KEYS = {
    "bg", "bg2", "card", "card2", "border", "text", "dim", "accent", "accent2",
    "accent_text", "thumb_bg", "modal_bg", "glow", "glow2", "shadow",
    "bg_image", "bg_size", "bg_repeat", "card_bg", "card_blur", "card_radius",
    "item_shadow", "item_hover_shadow", "accent_edge", "stage_bg", "thumb_vignette",
    "pill_bg", "pill_active_bg", "cta_bg", "cta_shadow", "hero_color", "hero_shadow",
    "divider_bg", "hero_bg", "cat_color", "panel_ink", "modal_ink", "modal_bg_image",
    "badge_bg", "price_color", "add_btn_color",
}
