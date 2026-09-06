'use client'
// How big is the dish. Three boxes an owner can fill the way they would say it - "about
// 28 across, 3 tall" - and four presets that fill all three at once.
//
// One component for the plate and for resizing an existing model, so the two never
// disagree about what a bowl is.

import { SHAPES, type Dims } from '@/lib/data/studio'

export default function SizeInput({ value, onChange, compact }: {
  value: Dims
  onChange: (d: Dims) => void
  compact?: boolean
}) {
  const set = (k: keyof Dims, raw: string) => {
    const n = raw.trim() === '' ? null : Number(raw)
    onChange({ ...value, [k]: n !== null && Number.isFinite(n) ? n : null })
  }
  const same = (d: Dims) =>
    d.width === value.width && d.length === value.length && d.height === value.height

  return (
    <div className="grid gap-3">
      <div className={`grid gap-1.5 ${compact ? 'grid-cols-2' : 'grid-cols-2'}`}>
        {SHAPES.map(s => (
          <button key={s.id} type="button" onClick={() => onChange({ ...s.dims })}
                  className="text-left rounded-lg px-3 py-2 text-xs transition-colors"
                  style={{ border: `1px solid ${same(s.dims) ? 'var(--gold)' : 'var(--border)'}`,
                           background: same(s.dims) ? 'var(--gold-dim)' : 'var(--bg)' }}>
            <div className="font-semibold">{s.label}</div>
            <div style={{ color: 'var(--dim)' }}>
              {s.dims.width} × {s.dims.length} × {s.dims.height} cm
            </div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {([['width', 'Width'], ['length', 'Length'], ['height', 'Height']] as [keyof Dims, string][]).map(([k, label]) => (
          <label key={k} className="block">
            <span className="eyebrow block mb-1">{label}</span>
            <div className="relative">
              <input type="number" min={1} max={200} inputMode="decimal"
                     value={value[k] ?? ''} placeholder="—"
                     onChange={e => set(k, e.target.value)}
                     style={{ paddingRight: 30 }} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none"
                    style={{ color: 'var(--dim)' }}>cm</span>
            </div>
          </label>
        ))}
      </div>
      {!compact && (
        <p className="text-[11px] leading-4" style={{ color: 'var(--dim)' }}>
          Any one is enough; three is better. Width is what the model is built to, and the
          shape gives the rest. Wrong size is fixable later, for free.
        </p>
      )}
    </div>
  )
}
