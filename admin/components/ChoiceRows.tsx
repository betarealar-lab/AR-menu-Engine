'use client'
// Sizes and extras, on the dish that has them.
//
// Two things the menu has always been able to SHOW and the admin could never edit:
//
//   variants   pick one, and the chosen price REPLACES the dish price.
//              Glass / Bottle, Small / Large, Cup / Teapot. Thirty of Monday Greens'
//              170 dishes have them, they arrived through an import, and until now an
//              owner could not change their own bottle price.
//   addons     pick any, and each price ADDS. Extra bacon, spicy. The renderer has
//              always drawn them; the admin did not even read the column, so no
//              restaurant has ever had one.
//
// They are genuinely different things and not one thing with a flag, which is why they
// are two lists: a variant is a radio group and changes what the dish costs, an add-on is
// a checkbox and every combination of them is its own basket line.
//
// **One label box per language the restaurant actually has.** `tenants.languages` decides,
// not a constant, so a restaurant that adds Russian gets a third box and nobody edits this
// file. The stored shape is flat - a label under its language code beside a reserved
// `price` - which is what makes that free.

import { useCallback } from 'react'
import { useLang } from '@/lib/useLang'
import { text } from '@/lib/i18n'
import type { Choice } from '@/lib/data/menu'
import { finishPrice } from '@/lib/choices'

/** Pairs worth one tap, taken from what Monday Greens actually sells. */
const PRESETS: { key: string; labels: Record<string, string>[] }[] = [
  { key: 'presetGlassBottle', labels: [{ en: 'Glass', ka: 'ჭიქა' }, { en: 'Bottle', ka: 'ბოთლი' }] },
  { key: 'presetSmallLarge', labels: [{ en: 'Small', ka: 'პატარა' }, { en: 'Large', ka: 'დიდი' }] },
  { key: 'presetCupTeapot', labels: [{ en: 'Cup', ka: 'ჭიქა' }, { en: 'Teapot', ka: 'ჩაიდანი' }] },
]

export default function ChoiceRows({ kind, rows, languages, currency, onChange }: {
  kind: 'variant' | 'addon'
  rows: Choice[]
  languages: string[]
  /** Appended to a bare number, so "24" becomes "24 ₾" rather than a naked integer. */
  currency: string
  onChange: (rows: Choice[]) => void
}) {
  const [T] = useLang()
  const isVariant = kind === 'variant'

  // Every edit rebuilds the list from the existing objects by SPREADING them. `platform.js`
  // reads `image_url` off a variant, and there is no reason to believe that is the last
  // key anything will ever put there - an editor that constructed fresh objects from the
  // fields it knows about would silently delete the rest.
  const patch = useCallback((i: number, change: Partial<Choice>) => {
    onChange(rows.map((r, n) => (n === i ? { ...r, ...change } : r)))
  }, [rows, onChange])

  const move = (i: number, by: number) => {
    const to = i + by
    if (to < 0 || to >= rows.length) return
    const next = [...rows]
    ;[next[i], next[to]] = [next[to], next[i]]
    onChange(next)
  }

  const add = (labels?: Record<string, string>) => onChange([...rows, { ...(labels || {}), price: '' }])

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="eyebrow">{isVariant ? T.sizesTitle : T.extrasTitle}</span>
        <span className="text-[11px]" style={{ color: 'var(--dim)' }}>
          {isVariant ? T.sizesHint : T.extrasHint}
        </span>
      </div>

      {rows.map((row, i) => (
        <div key={i} className="rounded-lg p-2 grid gap-2"
             style={{ background: 'var(--card2)', border: '1px solid var(--border)' }}>
          <div className="flex gap-2 flex-wrap items-end">
            {languages.map(lang => (
              <label key={lang} className="grid gap-1 flex-1" style={{ minWidth: 120 }}>
                <span className="eyebrow">{lang.toUpperCase()}</span>
                <input value={row[lang] ?? ''} spellCheck={false}
                       onChange={e => patch(i, { [lang]: e.target.value })}
                       placeholder={isVariant ? T.sizePlaceholder : T.extraPlaceholder} />
              </label>
            ))}
            <label className="grid gap-1" style={{ width: 110 }}>
              <span className="eyebrow">{isVariant ? T.priceWord : T.extraPrice}</span>
              <input value={row.price ?? ''} inputMode="decimal"
                     onChange={e => patch(i, { price: e.target.value })}
                     // Typing 24 and leaving means 24 of something. The currency is the
                     // restaurant's own, so it can be added rather than asked for.
                     onBlur={e => patch(i, { price: finishPrice(e.target.value, currency) })}
                     placeholder={`24 ${currency}`} />
            </label>
          </div>

          <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--dim)' }}>
            {/* Order is meaning here, not tidiness: the first variant is the one selected
                when a diner opens the card, and its price becomes the dish's price. */}
            {isVariant && i === 0 && <span className="pill pill-on">{T.sizeDefault}</span>}
            <button type="button" className="underline" onClick={() => move(i, -1)}
                    disabled={i === 0} style={{ opacity: i === 0 ? 0.4 : 1 }}>{T.moveUp}</button>
            <button type="button" className="underline" onClick={() => move(i, 1)}
                    disabled={i === rows.length - 1}
                    style={{ opacity: i === rows.length - 1 ? 0.4 : 1 }}>{T.moveDown}</button>
            <button type="button" className="underline ml-auto" style={{ color: 'var(--danger)' }}
                    onClick={() => onChange(rows.filter((_, n) => n !== i))}>{T.remove}</button>
          </div>
        </div>
      ))}

      <div className="flex gap-2 flex-wrap items-center">
        <button type="button" className="btn btn-sm" onClick={() => add()}>
          {isVariant ? T.addSize : T.addExtra}
        </button>
        {/* Only for sizes, and only on an empty list: they are a starting point, not a
            menu of choices, and offering them next to three rows somebody already typed
            is clutter. */}
        {isVariant && rows.length === 0 && PRESETS.map(p => (
          <button key={p.key} type="button" className="btn btn-sm btn-ghost"
                  onClick={() => onChange(p.labels.map(l => ({ ...l, price: '' })))}>
            {(T as Record<string, string>)[p.key]}
          </button>
        ))}
      </div>

      {isVariant && rows.length > 0 && (
        <p className="text-[11px]" style={{ color: 'var(--dim)' }}>
          {text(T.sizesPriceNote, { price: rows[0]?.price || '—' })}
        </p>
      )}
    </div>
  )
}
