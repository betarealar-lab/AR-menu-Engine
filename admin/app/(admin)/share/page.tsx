'use client'
// QR & share. The physical delivery vehicle.
//
// The restaurant's code, and optionally one per table. Per-table codes carry `?t=<n>` so
// that when the analytics grow a "which table" dimension the codes already printed keep
// working - reprinting laminated cards because a URL changed is the kind of cost that
// makes a restaurant stop trusting the product.

import { useState } from 'react'
import { usePlan } from '@/lib/usePlan'
import QrCode from '@/components/QrCode'
import { useLang } from '@/lib/useLang'
import { text } from '@/lib/i18n'

const MENU_ORIGIN = process.env.NEXT_PUBLIC_MENU_ORIGIN || ''

export default function SharePage() {
  const [T] = useLang()
  const plan = usePlan()
  const [tables, setTables] = useState(0)
  const [copied, setCopied] = useState(false)

  if (plan.loading) return <p style={{ color: 'var(--dim)' }}>Loading…</p>
  if (!plan.restaurantId) return <p style={{ color: 'var(--dim)' }}>{T.pickRestaurantFirst}</p>

  const url = `${MENU_ORIGIN}/${plan.restaurantSlug}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* the address is on screen either way */ }
  }

  return (
    <div className="page-content max-w-3xl">
      <div className="flex items-center gap-3 flex-wrap mb-6 no-print">
        <h1 className="page-title mr-auto">{T.shareTitle}</h1>
        <button className="btn btn-sm" onClick={() => window.print()}>{T.sharePrint}</button>
      </div>

      <div className="grid gap-5 md:grid-cols-[1fr_260px] no-print">
        <div className="card p-5">
          <div className="eyebrow mb-1">{T.shareAddress}</div>
          <a href={url} target="_blank" rel="noreferrer" className="font-semibold break-all"
             style={{ color: 'var(--gold)' }}>{url}</a>
          <div className="flex gap-2 mt-4">
            <button className="btn btn-sm" onClick={copy}>{copied ? T.shareCopied : T.shareCopyLink}</button>
            <a className="btn btn-sm" href={url} target="_blank" rel="noreferrer">{T.shareOpen}</a>
          </div>
          <p className="text-xs mt-4" style={{ color: 'var(--dim)' }}>
            {T.shareHint}
          </p>
        </div>

        <div className="card p-4 text-center">
          <QrCode value={url} size={200} label={plan.restaurantSlug} />
        </div>
      </div>

      <div className="card p-5 mt-5">
        <div className="flex items-baseline gap-3 flex-wrap mb-3 no-print">
          <div>
            <div className="font-semibold">{T.sharePerTable}</div>
            <p className="text-xs" style={{ color: 'var(--dim)' }}>
              {T.sharePerTableHint}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label className="eyebrow">{T.shareTables}</label>
            <input type="number" min={0} max={60} value={tables || ''} placeholder="0"
                   onChange={e => setTables(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
                   style={{ width: 80 }} />
          </div>
        </div>
        {tables > 0 && (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>
            {Array.from({ length: tables }, (_, i) => i + 1).map(n => (
              <div key={n} className="text-center print-block">
                <QrCode value={`${url}?t=${n}`} size={120} label={`${plan.restaurantSlug}-table-${n}`} />
                {/* On screen the page says whose menu this is. On paper the card gets cut
                    out and carried to a table, where it is the only thing anybody sees -
                    so it has to name the restaurant itself. */}
                <div className="hidden print:block text-[10px] mt-1">{plan.restaurantName || plan.restaurantSlug}</div>
                <div className="text-xs mt-1 font-semibold">{text(T.shareTableN, { n })}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* The restaurant's own code, for the door and the bill. Hidden on screen because
          the card at the top already shows it; present here so that Print gives a sheet
          with something on it even when nobody has asked for table codes. */}
      <div className="hidden print:block text-center print-block" style={{ marginTop: 24 }}>
        <QrCode value={url} size={200} label={plan.restaurantSlug} />
        <div className="text-sm mt-2 font-semibold">{plan.restaurantName || plan.restaurantSlug}</div>
      </div>
    </div>
  )
}
