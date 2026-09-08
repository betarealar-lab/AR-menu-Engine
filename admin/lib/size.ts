// A size in words. Nobody can picture 28 cm; everybody can picture a dinner plate.
//
// The anchors are things every owner has held. Used on the plate, on the model card and
// in the AR page's caption, so the same number is always the same object.

export type DimsLike = {
  width: number | null | undefined
  length: number | null | undefined
  height: number | null | undefined
}

export type Axis = 'width' | 'length' | 'height'

/** The ONE dimension the engine will actually bake, out of the up-to-three an owner gave.
 *
 *  **This is a copy of a rule that lives in the database**, and it is deliberate that it is
 *  a small one. `model_request_gate()` (0013) does exactly this on insert:
 *
 *      width first  - it is what a photograph measures best
 *      then length
 *      then height  - it is what the generator invents most often
 *
 *  ...writing the winner into `scale_cm` / `scale_axis`, which `optimize.py` turns into a
 *  uniform scale factor: `(cm / 100) / the model's measured extent on that axis`. The
 *  model's own proportions supply the other two.
 *
 *  So one number is genuinely enough, and always was - the screen just used to open with a
 *  preset filled in and never said which of the three mattered. This function exists so it
 *  can say, and so what it says cannot drift from what the database decides.
 */
export function primaryDim(d: DimsLike): { cm: number; axis: Axis } | null {
  for (const axis of ['width', 'length', 'height'] as Axis[]) {
    const v = d[axis]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return { cm: v, axis }
  }
  return null
}

/** The anchors are WIDTHS - a dinner plate is 28 across, not 28 tall - so a size given only
 *  as a height is reported as a height rather than compared to a plate it is nothing like. */
export function sizeInWords(cm: number | null | undefined, heightCm?: number | null,
                            axis: Axis = 'width'): string {
  const w = cm ?? 0
  if (w <= 0) return 'no size set'
  if (axis === 'height') return `${Math.round(w)} cm tall`

  let what: string
  if (w < 9) what = 'a coffee cup'
  else if (w < 15) what = 'a phone'
  else if (w < 22) what = 'a side plate'
  else if (w < 31) what = 'a dinner plate'
  else if (w < 40) what = 'a sharing platter'
  else what = 'a tray'
  const tall = heightCm && heightCm >= 10 ? ', and tall' : ''
  return `about ${what}${tall} · ${Math.round(w)} cm`
}

/** The whole line under the boxes: what will be built, and which number decides it. */
export function sizeSummary(d: DimsLike): string {
  const p = primaryDim(d)
  if (!p) return 'Type any one measurement'
  const words = sizeInWords(p.cm, d.height, p.axis)
  return `${words} · sized by ${p.axis}`
}
