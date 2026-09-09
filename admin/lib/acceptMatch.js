// Does a dropped file match an `accept` string?
//
// Plain JS, beside its own test, because a DROP BYPASSES the input's `accept` attribute
// entirely: an `<input accept=".glb">` will hand you a .docx without complaint if the file
// arrived by drag. So the same rule the browser applies to the picker has to be applied
// here by hand, and the interesting cases are all off-centre - a .glb has no MIME type in
// most browsers, a .usdz has several, and an image dragged out of another tab can arrive
// with a type and no filename at all.

/**
 * @param {{ name?: string, type?: string }} file
 * @param {string} accept  e.g. "image/*", ".glb,.usdz", "video/mp4,.mp4"
 * @returns {boolean}
 */
export function matchesAccept(file, accept) {
  const rules = String(accept || '')
    .split(',')
    .map(r => r.trim().toLowerCase())
    .filter(Boolean);
  // No rules means the caller did not care.
  if (!rules.length) return true;

  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();

  return rules.some(rule => {
    // ".glb" - by extension. The only thing that works for model files, which browsers
    // give an empty type.
    if (rule.startsWith('.')) return !!name && name.endsWith(rule);
    // "image/*" - by MIME family.
    if (rule.endsWith('/*')) return !!type && type.startsWith(rule.slice(0, -1));
    // "video/mp4" - exact.
    return !!type && type === rule;
  });
}
