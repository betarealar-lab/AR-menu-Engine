// A size in words. Nobody can picture 28 cm; everybody can picture a dinner plate.
//
// The anchors are things every owner has held. Used on the plate, on the model card and
// in the AR page's caption, so the same number is always the same object.

export function sizeInWords(widthCm: number | null | undefined, heightCm?: number | null): string {
  const w = widthCm ?? 0
  let what: string
  if (w <= 0) return 'no size set'
  else if (w < 9) what = 'a coffee cup'
  else if (w < 15) what = 'a phone'
  else if (w < 22) what = 'a side plate'
  else if (w < 31) what = 'a dinner plate'
  else if (w < 40) what = 'a sharing platter'
  else what = 'a tray'
  const tall = heightCm && heightCm >= 10 ? ', and tall' : ''
  return `about ${what}${tall} · ${Math.round(w)} cm`
}
