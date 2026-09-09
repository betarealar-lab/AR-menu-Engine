import test from 'node:test';
import assert from 'node:assert/strict';
import { isFilled, cleanChoices, choiceLabel, finishPrice } from './choices.js';

// The three shapes that are actually in the database today, copied from Monday Greens.
const MG = [
  { en: 'Glass', ka: 'ჭიქა', price: '24 ₾' },
  { en: 'Bottle', ka: 'ბოთლი', price: '270 ₾' },
];

test('a live variant survives a round trip unchanged', () => {
  assert.deepEqual(cleanChoices(MG), MG);
});

test('keys the editor knows nothing about are preserved', () => {
  // `platform.js` reads image_url off a variant. An editor that rebuilt these objects
  // from its own field list would delete it, and nothing would say so.
  const withImage = [{ en: 'Bottle', ka: 'ბოთლი', price: '270 ₾', image_url: '/a/x.webp' }];
  assert.deepEqual(cleanChoices(withImage), withImage);
  assert.equal(cleanChoices(withImage)[0].image_url, '/a/x.webp');
});

test('a row labelled only in Georgian is kept', () => {
  // The wrong test here would be "has an English label". On a Georgian menu it does not.
  assert.ok(isFilled({ ka: 'ჩაიდანი', price: '19 ₾' }));
  assert.equal(cleanChoices([{ ka: 'ჩაიდანი', price: '19 ₾' }]).length, 1);
});

test('a row with a price and no label is dropped', () => {
  // It would be a blank button on the menu.
  assert.ok(!isFilled({ price: '19 ₾' }));
  assert.equal(cleanChoices([MG[0], { price: '9 ₾' }]).length, 1);
});

test('whitespace is not a label', () => {
  assert.ok(!isFilled({ en: '   ', ka: '', price: '5 ₾' }));
});

test('an empty or missing list is an empty list, not a crash', () => {
  assert.deepEqual(cleanChoices([]), []);
  assert.deepEqual(cleanChoices(null), []);
  assert.deepEqual(cleanChoices(undefined), []);
});

test('the label follows the language, then falls back the way the renderer does', () => {
  const v = { en: 'Glass', ka: 'ჭიქა', ru: 'Бокал', price: '24 ₾' };
  assert.equal(choiceLabel(v, 'ka'), 'ჭიქა');
  assert.equal(choiceLabel(v, 'ru'), 'Бокал');
  assert.equal(choiceLabel(v, 'en'), 'Glass');
  // A language the row has no label for falls back to English, NOT to Georgian - which
  // is the bug this replaced: a Russian menu showed Georgian size labels.
  assert.equal(choiceLabel({ en: 'Glass', ka: 'ჭიქა' }, 'ru'), 'Glass');
  // ...and Georgian is still the last resort when there is no English.
  assert.equal(choiceLabel({ ka: 'ჭიქა' }, 'ru'), 'ჭიქა');
  assert.equal(choiceLabel(null, 'en'), '');
});

test('a bare number gets the restaurant currency', () => {
  assert.equal(finishPrice('24', '₾'), '24 ₾');
  assert.equal(finishPrice('24.50', '₾'), '24.50 ₾');
  assert.equal(finishPrice('24,50', '₾'), '24,50 ₾');
  assert.equal(finishPrice(' 8 ', '$'), '8 $');
});

test('a price that already says something is left alone', () => {
  assert.equal(finishPrice('24 ₾', '₾'), '24 ₾');
  assert.equal(finishPrice('16 / 70 ₾', '₾'), '16 / 70 ₾');
  assert.equal(finishPrice('from 12', '₾'), 'from 12');
  assert.equal(finishPrice('', '₾'), '');
  assert.equal(finishPrice(null, '₾'), '');
});
