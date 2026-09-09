// Cleaning a list of sizes or extras before it is saved.
//
// Plain JS beside its own test because this is the part that can quietly damage a live
// menu. Thirty of Monday Greens' dishes carry variants that arrived through an import, in
// a shape with more keys than this editor knows about - `platform.js` reads `image_url`
// off a variant - and the first rule here is that a round trip through the editor gives
// back what it was given.

/** Is this row worth saving? True when SOME language has a label.
 *
 *  A row labelled only in Georgian is a real row on a Georgian menu, so "has an English
 *  label" would be the wrong test. A row with a price and no label at all is a blank
 *  button on the menu, so it is dropped.
 */
export function isFilled(row) {
  if (!row) return false;
  return Object.keys(row).some(
    k => k !== 'price' && k !== 'image_url' && String(row[k] || '').trim());
}

/** Drop the empty rows, keep everything else exactly as it came in. */
export function cleanChoices(rows) {
  return (rows || []).filter(isFilled);
}

/** The label a diner sees, with the same fallbacks both renderers use. */
export function choiceLabel(row, lang) {
  return (row && (row[lang] || row.en || row.ka)) || '';
}

/** Finish a price somebody typed as a bare number.
 *
 *  `24` on its own is 24 of something, and the something is the restaurant's own
 *  currency. Anything that already carries a symbol, a range, or words is left alone -
 *  "16 / 70 ₾" is a real price on a Georgian menu and reformatting it would be wrong.
 */
export function finishPrice(raw, currency) {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  return /^[\d.,]+$/.test(v) ? `${v} ${currency}` : v;
}
