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

const MENU_ORIGIN = process.env.NEXT_PUBLIC_MENU_ORIGIN || ''

export default function SharePage() {
  const plan = usePlan()
  const [tables, setTables] = useState(0)
  const [copied, setCopied] = useState(false)

  if (plan.loading) return <p style={{ color: 'var(--dim)' }}>Loading…</p>
  if (!plan.restaurantId) return <p style={{ color: 'var(--dim)' }}>Pick a restaurant first.</p>

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
      <h1 className="page-title mb-6">QR &amp; share</h1>

      <div className="grid gap-5 md:grid-cols-[1fr_260px]">
        <div className="card p-5">
          <div className="eyebrow mb-1">Your menu&apos;s address</div>
          <a href={url} target="_blank" rel="noreferrer" className="font-semibold break-all"
             style={{ color: 'var(--gold)' }}>{url}</a>
          <div className="flex gap-2 mt-4">
            <button className="btn btn-sm" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
            <a className="btn btn-sm" href={url} target="_blank" rel="noreferrer">Open</a>
          </div>
          <p className="text-xs mt-4" style={{ color: 'var(--dim)' }}>
            Put the code on tables, at the door, on the bill. It goes straight to the menu —
            no app to install, nothing to type.
          </p>
        </div>

        <div className="card p-4 text-center">
          <QrCode value={url} size={200} label={plan.restaurantSlug} />
        </div>
      </div>

      <div className="card p-5 mt-5">
        <div className="flex items-baseline gap-3 flex-wrap mb-3">
          <div>
            <div className="font-semibold">One code per table</div>
            <p className="text-xs" style={{ color: 'var(--dim)' }}>
              Optional. Same menu; later you will see which tables scan most.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label className="eyebrow">Tables</label>
            <input type="number" min={0} max={60} value={tables || ''} placeholder="0"
                   onChange={e => setTables(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
                   style={{ width: 80 }} />
          </div>
        </div>
        {tables > 0 && (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>
            {Array.from({ length: tables }, (_, i) => i + 1).map(n => (
              <div key={n} className="text-center">
                <QrCode value={`${url}?t=${n}`} size={120} label={`${plan.restaurantSlug}-table-${n}`} />
                <div className="text-xs mt-1 font-semibold">Table {n}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
