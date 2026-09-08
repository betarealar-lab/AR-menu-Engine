'use client'
// How big is the dish. Three boxes an owner fills the way they would say it - "about 28
// across, 3 tall" - and ANY ONE of them is enough.
//
// **The four shape presets are gone.** Temo: "custom should be the default". They were
// four buttons that filled all three boxes at once, and the plate opened with Flat plate
// already selected - so the path of least resistance was to send 28 x 28 x 3 without
// reading it, and a burger built as a dinner plate is 30 credits and a remake. A preset
// that is pre-selected is not a shortcut, it is a default answer to a question only the
// owner can answer.
//
// What replaced them is the thing the presets were hiding: the engine bakes ONE dimension
// and lets the model's own proportions supply the other two (0013, optimize.py). So the
// screen now asks for one number, says which one it will use, and says what that number
// looks like in the real world.

import { type Dims } from '@/lib/data/studio'
import { primaryDim, sizeSummary } from '@/lib/size'

const BOXES: [keyof Dims, string, string][] = [
  // The hint is the part an owner can actually check without a ruler.
  ['width',  'Width',  'across'],
  ['length', 'Length', 'front to back'],
  ['height', 'Height', 'tall'],
]

export default function SizeInput({ value, onChange, compact }: {
  value: Dims
  onChange: (d: Dims) => void
  compact?: boolean
}) {
  const set = (k: keyof Dims, raw: string) => {
    const n = raw.trim() === '' ? null : Number(raw)
    onChange({ ...value, [k]: n !== null && Number.isFinite(n) ? n : null })
  }
  const primary = primaryDim(value)

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-3 gap-2">
        {BOXES.map(([k, label, hint]) => (
          <label key={k} className="block">
            <span className="eyebrow block mb-1">
              {label}
              {/* Which box is doing the work, marked on the box itself. An owner who fills
                  only Height should be able to see that Height is what gets built. */}
              {primary?.axis === k && (
                // A non-breaking space, not `ml-1`: the label is uppercased with letter
                // spacing, and a margin between two inline spans renders as "HEIGHT· used".
                <span className="normal-case tracking-normal font-semibold"
                      style={{ color: 'var(--gold)' }}>{' · used'}</span>
              )}
            </span>
            <div className="relative">
              <input type="number" min={1} max={200} inputMode="decimal"
                     value={value[k] ?? ''} placeholder="—"
                     aria-label={`${label} in centimetres`}
                     onChange={e => set(k, e.target.value)}
                     style={{ paddingRight: 30 }} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none"
                    style={{ color: 'var(--dim)' }}>cm</span>
            </div>
            {!compact && (
              <span className="block text-[10px] mt-1" style={{ color: 'var(--dim)' }}>{hint}</span>
            )}
          </label>
        ))}
      </div>

      {/* The number, as a thing. This line is the guardrail: an owner who reads "about a
          tray" for a side dish stops before the credits are spent. */}
      <p className="text-xs font-semibold"
         style={{ color: primary ? 'var(--gold)' : 'var(--dim)' }}>
        {sizeSummary(value)}
      </p>

      {!compact && (
        <p className="text-[11px] leading-4" style={{ color: 'var(--dim)' }}>
          One measurement is enough — the model keeps its own proportions for the rest.
          Width is the most reliable, and the easiest to check against a plate you own.
          Wrong size is fixable later, for free, and you can stand it on your real table
          before approving.
        </p>
      )}
    </div>
  )
}
