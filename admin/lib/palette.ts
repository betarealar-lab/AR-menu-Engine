// What each colour actually does, and what to click to find it.
//
// ONE definition, used three ways: the editor groups its rows from it, every row's label
// and one-line purpose come from it, and the preview turns `pick` into "tapping this part
// of the menu opens that row". Three lists would be three chances for a label to describe
// a colour it no longer changes.
//
// The old editor listed thirteen rows of bare key names - "Card", "Card 2", "Dim",
// "Accent (gold)" - which say what the variable is called, not what moves when you change
// it. And "(gold)" is simply wrong for a restaurant whose accent is green.
//
// `pick` selectors are matched against the REAL menu markup (app/src/lib/markup.js and the
// ported stylesheet), most specific first, because a click lands on the innermost element
// and the first match wins.

export type PaletteField = {
  key: string
  label: string
  /** What visibly changes. One line, in the words an owner would use. */
  what: string
  /** Where it lives in the real page, for click-to-edit. Most specific first. */
  pick?: string[]
}

export type PaletteGroup = {
  id: string
  title: string
  hint?: string
  fields: PaletteField[]
}

export const PALETTE_GROUPS: PaletteGroup[] = [
  {
    id: 'page',
    title: 'The page',
    fields: [
      { key: 'bg', label: 'Page background', what: 'Behind everything, above and below the dishes.',
        pick: ['body', '.menu-list'] },
      { key: 'border', label: 'Lines and edges', what: 'The hairlines around cards and between sections.' },
    ],
  },
  {
    id: 'dish',
    title: 'Dish cards',
    hint: 'The rows a diner scrolls through.',
    fields: [
      { key: 'card', label: 'Card', what: 'The panel each dish sits on.',
        pick: ['.menu-item', '.item-left', '.item-right'] },
      { key: 'card2', label: 'Card, lower edge', what: 'The second colour of the card’s gradient. Same as the card above for a flat look.' },
      { key: 'thumb_bg', label: 'Behind the photo', what: 'Shows around a dish photo or 3D model that does not fill its square.',
        pick: ['.thumb-img', '.thumb-wrap', '.thumb-vignette'] },
    ],
  },
  {
    id: 'words',
    title: 'Words',
    fields: [
      { key: 'text', label: 'Dish names', what: 'The main text on every card.',
        pick: ['.item-name', '.variant-name', '.header'] },
      { key: 'dim', label: 'Descriptions', what: 'The quieter second line under a dish name.',
        pick: ['.ingredients', '.no-image-extra'] },
      { key: 'price_color', label: 'Prices', what: 'Every price on the menu.',
        pick: ['.price', '.price-was'] },
    ],
  },
  {
    id: 'actions',
    title: 'Buttons and highlights',
    hint: 'The parts that ask to be tapped.',
    fields: [
      { key: 'accent', label: 'Accent', what: 'Your one strong colour: the selected category, links, highlights.',
        pick: ['.cat-filter', '.cat-bar', '.cat-nav'] },
      { key: 'accent_text', label: 'Text on the accent', what: 'Sits on top of the accent colour, so it has to be readable against it.' },
      { key: 'add_btn_color', label: '3D button', what: 'The button that opens a dish in 3D.',
        pick: ['.ar-btn'] },
      { key: 'badge_bg', label: '3D badge', what: 'The small mark on a dish that has a 3D model.',
        pick: ['.badge-3d'] },
    ],
  },
  {
    id: 'modal',
    title: 'The 3D window',
    fields: [
      { key: 'modal_bg', label: 'Behind the model', what: 'The background a diner sees while turning a dish around.' },
    ],
  },
]

/** Flattened, in display order. */
export const PALETTE_FIELDS: PaletteField[] = PALETTE_GROUPS.flatMap(g => g.fields)

/** selector -> palette key, most specific first, for the preview's click-to-edit. */
export const PICK_MAP: [string, string][] = PALETTE_FIELDS
  .flatMap(f => (f.pick ?? []).map(sel => [sel, f.key] as [string, string]))
  // `body` last: it matches everything that bubbles that far, so anything more specific
  // has to get its chance first.
  .sort((a, b) => (a[0] === 'body' ? 1 : b[0] === 'body' ? -1 : 0))
