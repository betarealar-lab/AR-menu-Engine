import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesAccept } from './acceptMatch.js';

const f = (name, type = '') => ({ name, type });

test('takes the file types each upload actually asks for', () => {
  assert.ok(matchesAccept(f('dish.jpg', 'image/jpeg'), 'image/*'));
  assert.ok(matchesAccept(f('dish.PNG', 'image/png'), 'image/*'));
  assert.ok(matchesAccept(f('hero.mp4', 'video/mp4'), 'video/mp4,.mp4'));
  assert.ok(matchesAccept(f('plate.glb'), '.glb,.usdz'));
  assert.ok(matchesAccept(f('plate.usdz'), '.glb,.usdz'));
});

test('refuses what they do not', () => {
  assert.ok(!matchesAccept(f('menu.pdf', 'application/pdf'), 'image/*'));
  assert.ok(!matchesAccept(f('notes.docx'), '.glb,.usdz'));
  assert.ok(!matchesAccept(f('clip.mov', 'video/quicktime'), 'video/mp4,.mp4'));
  // The case that matters most: an image is not a model, and the input's own `accept`
  // attribute does nothing about it once the file arrives by drag.
  assert.ok(!matchesAccept(f('dish.jpg', 'image/jpeg'), '.glb'));
});

test('matches a model by extension, because browsers give it no type', () => {
  // Chrome reports "" for .glb and .usdz. A MIME-only rule would reject every model file.
  assert.ok(matchesAccept(f('burger.glb', ''), '.glb'));
  assert.ok(matchesAccept(f('BURGER.GLB', ''), '.glb'));
});

test('is not fooled by an extension inside the name', () => {
  assert.ok(!matchesAccept(f('glb.notes.txt'), '.glb'));
  assert.ok(!matchesAccept(f('my.glb.zip'), '.glb'));
});

test('an image dragged from another tab has a type and no useful name', () => {
  assert.ok(matchesAccept(f('', 'image/webp'), 'image/*'));
  assert.ok(!matchesAccept(f('', 'image/webp'), '.glb'));
});

test('an empty accept takes anything, which is what the callers without one mean', () => {
  assert.ok(matchesAccept(f('anything.xyz'), ''));
  assert.ok(matchesAccept(f('anything.xyz'), '   '));
});

test('a file with neither name nor type is never a match for a real rule', () => {
  assert.ok(!matchesAccept(f('', ''), 'image/*'));
  assert.ok(!matchesAccept(f('', ''), '.glb'));
  assert.ok(!matchesAccept(f('', ''), 'video/mp4'));
});
