// fields.js — the vocabulary the admin is allowed to write.
//
// One list, imported by both the page that draws the form and the endpoint that saves it,
// so a field cannot exist in the UI without the server accepting it or the other way
// round. The endpoint whitelists against this: a restaurant's settings bag is `jsonb` and
// without a list, a hand-rolled POST could put anything in it.
//
// The names are not invented. They are the keys the live restaurants already use, read
// out of their imported settings, because the renderer and the ported CSS look for
// exactly these (`markup.js`, `full.css`). Renaming one here silently blanks that piece
// of a real menu.

import { VAR_MAP } from "./theme.js";

/** The palette, split day/night. 34 keys per mode; these six are the ones an owner
 *  actually reaches for, and the rest sit behind "More colours" rather than being
 *  hidden - somebody eventually needs the badge colour. */
export const PALETTE_MAIN = [
  ["bg", "Page background"],
  ["text", "Text"],
  ["accent", "Accent"],
  ["card", "Dish card"],
  ["pill_active_bg", "Selected category"],
  ["cta_bg", "Buttons"],
];

export const PALETTE_REST = Object.keys(VAR_MAP)
  .filter((k) => !PALETTE_MAIN.some(([m]) => m === k))
  .map((k) => [k, k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())]);

export const PALETTE_KEYS = new Set(Object.keys(VAR_MAP));

/** Everything in `settings` that is not a colour, grouped the way an owner thinks about
 *  it rather than the way it is stored. `kind` decides the input; `hint` only appears
 *  where the field is genuinely unobvious. */
export const SETTINGS_GROUPS = [
  {
    id: "venue", title: "The restaurant", fields: [
      ["site_name", "Name", "text"],
      ["site_name_ka", "Name in Georgian", "text"],
      ["site_address", "Address", "text"],
      ["site_map_url", "Map link", "url"],
    ],
  },
  {
    id: "hours", title: "Hours", fields: [
      ["site_hours_note", "Days", "text", "Everyday, or Mon-Sun"],
      ["site_hours_range", "Times", "text", "9:00 am - 11:00 pm"],
    ],
  },
  {
    id: "phone", title: "Phone", fields: [
      ["site_phone", "Number to dial", "tel", "With the country code, so tapping it works"],
      ["site_phone_display", "Number as written", "text"],
      ["site_phone_label", "Label", "text", "Phone, or Table Reservations"],
    ],
  },
  {
    id: "links", title: "Links", fields: [
      ["instagram_url", "Instagram", "url"],
      ["google_review_url", "Google reviews", "url"],
      ["google_review_label", "Review button text", "text"],
    ],
  },
  {
    id: "delivery", title: "Delivery", fields: [
      ["delivery_label", "Button text", "text", "Order on Wolt"],
      ["delivery_url", "Link", "url"],
      ["delivery_icon", "Icon", "text", "img/brands/wolt.webp"],
      ["delivery2_label", "Second button text", "text"],
      ["delivery2_url", "Second link", "url"],
      ["delivery2_icon", "Second icon", "text"],
    ],
  },
  {
    id: "announcement", title: "Announcement", fields: [
      ["announcement_enabled", "Show it", "bool"],
      ["announcement_text", "Message", "textarea"],
      ["announcement_text_ka", "Message in Georgian", "textarea"],
      ["announcement_date", "Date", "text", "Saturday, September 5"],
      ["announcement_time", "Time", "text", "20:00"],
    ],
  },
];

/** The look: what the restaurant is made of rather than what it says. */
export const LOOK_FIELDS = [
  ["logo_url", "Logo", "image"],
  ["hero_logo_url", "Logo over the hero", "image"],
  ["hero_image_url", "Hero image", "image"],
  ["hero_video_url", "Hero video", "url"],
  ["hero_video_mobile_url", "Hero video for phones", "url"],
  ["hero_video_poster_url", "Video poster", "image"],
  ["font_heading", "Heading font", "font"],
  ["font_body", "Body font", "font"],
];

const LOOK_CHOICE = [
  ["default_theme", "Opens in", [["night", "Night"], ["day", "Day"]]],
  ["theme_lock", "Diners may switch", [["", "Yes, both"], ["night", "Night only"],
                                       ["day", "Day only"]]],
  ["phone_layout", "Dishes on a phone", [["", "Cards"], ["list", "A list"]]],
];
export { LOOK_CHOICE };

/** Every settings key the admin may write. Anything else in a POST is dropped. */
export const SETTINGS_KEYS = new Set([
  ...SETTINGS_GROUPS.flatMap((g) => g.fields.map(([k]) => k)),
  ...LOOK_FIELDS.map(([k]) => k),
  ...LOOK_CHOICE.map(([k]) => k),
  // Written by the hero picker and the drinks rule rather than by a single input, but
  // still the owner's to set.
  "hero_images", "hero_min_h", "drink_categories", "spin_enabled", "template_key",
]);
