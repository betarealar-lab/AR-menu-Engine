'use client'
// Developer analytics. Ours, not an owner's.
//
// The screen this replaced was an <iframe> pointing at the platform's production
// analytics page - the old numeric ids, somebody else's deploy - and it could never have
// shown a number about any restaurant in this system. This one is every restaurant at
// once, and the queue behind them.
//
// Two questions it exists to answer, both of which are operational rather than
// commercial: which restaurants are actually being used, and what is stuck.
//
// The security boundary is inside `admin_overview()` and `admin_queue()`, not here: an
// owner who reaches this URL gets empty tables rather than an error that would tell them
// the functions exist (0014).

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePlan } from '@/lib/usePlan'
import { createClient } from '@/lib/supabase/client'

type Row = {
  tenant_id: string; slug: string; name: string
  dishes: number; dishes_3d: number
  models: number; models_draft: number
  requests_open: number; requests_failed: number
  sessions: number; item_opens: number; ar_opens: number
  quota: number; quota_used: number
}

type QueueRow = {
  id: string; tenant_name: string; title: string; kind: string
  state: string; note: string; requested_utc: string; minutes_waiting: number
}

const RANGES: [string, number][] = [['24h', 1440], ['7d', 10080], ['30d', 43200], ['90d', 129600]]

export default function DevAnalyticsPage() {
  const plan = usePlan()
  const [minutes, setMinutes] = useState(43200)
  const [rows, setRows] = useState<Row[]>([])
  const [queue, setQueue] = useState<QueueRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (plan.loading) return
    setLoading(true)
    const supabase = createClient()
    const [o, q] = await Promise.all([
      supabase.rpc('admin_overview', { p_minutes: minutes }),
      supabase.rpc('admin_queue'),
    ])
    setRows((o.data as Row[]) || [])
    setQueue((q.data as QueueRow[]) || [])
    setLoading(false)
  }, [plan.loading, minutes])

  useEffect(() => { void load() }, [load])

  // Anything in flight changes without anyone touching it.
  useEffect(() => {
    if (!queue.some(q => ['pending', 'approved', 'running'].includes(q.state))) return
    const id = setInterval(() => { void load() }, 30_000)
    return () => clearInterval(id)
  }, [queue, load])

  const total = rows.reduce((acc, r) => ({
    sessions: acc.sessions + Number(r.sessions),
    opens: acc.opens + Number(r.item_opens),
    ar: acc.ar + Number(r.ar_opens),
    models: acc.models + Number(r.models),
    draft: acc.draft + Number(r.models_draft),
  }), { sessions: 0, opens: 0, ar: 0, models: 0, draft: 0 })

  const waiting = queue.filter(q => q.state === 'pending')
  const failed = queue.filter(q => q.state === 'failed')

  if (!plan.loading && plan.role !== 'super_admin') {
    return <div className="card p-6 text-sm" style={{ color: 'var(--dim)' }}>Not for this account.</div>
  }

  return (
    <div className="page-content">
      <div className="flex items-center gap-3 flex-wrap mb-5">
        <div className="mr-auto">
          <h1 className="page-title">Developer analytics</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--dim)' }}>
            {rows.length} restaurant{rows.length === 1 ? '' : 's'} · {total.sessions.toLocaleString()} diners
            {waiting.length > 0 && <> · <span style={{ color: 'var(--gold)' }}>{waiting.length} waiting for approval</span></>}
          </p>
        </div>
        <div className="flex rounded-lg p-0.5" style={{ background: 'var(--card2)' }}>
          {RANGES.map(([label, m]) => (
            <button key={label} onClick={() => setMinutes(m)}
                    className="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors"
                    style={{ background: minutes === m ? 'var(--card)' : 'transparent',
                             color: minutes === m ? 'var(--text)' : 'var(--dim)',
                             boxShadow: minutes === m ? 'var(--shadow)' : 'none' }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4 mb-4">
        {[['Diners', total.sessions], ['3D opens', total.opens], ['AR opens', total.ar],
          ['Models', total.models]].map(([label, n]) => (
          <div key={label as string} className="card p-4">
            <div className="eyebrow mb-1">{label}</div>
            <div className="text-2xl font-bold" style={{ color: 'var(--gold)' }}>
              {Number(n).toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {/* The queue. What is stuck, oldest first - a request waiting on us for two days is
          the thing this screen exists to make impossible to miss. */}
      {(waiting.length > 0 || failed.length > 0 || queue.length > 0) && (
        <div className="card p-5 mb-4">
          <div className="eyebrow mb-3">The queue · {queue.length}</div>
          <div className="grid gap-2">
            {queue.map(q => (
              <div key={q.id} className="flex items-center gap-3 text-sm flex-wrap">
                <span className="font-semibold">{q.tenant_name}</span>
                <span className="flex-1 truncate" style={{ color: 'var(--dim)' }}>
                  {q.title || 'untitled'}{q.kind === 'rescale' ? ' · resize' : ''}
                </span>
                {q.state === 'pending' && q.minutes_waiting > 60 && (
                  <span className="text-xs" style={{ color: 'var(--danger)' }}>
                    {Math.round(q.minutes_waiting / 60)}h waiting
                  </span>
                )}
                <span className={`pill ${q.state === 'failed' ? 'pill-off'
                  : q.state === 'pending' ? 'pill-wait' : 'pill-mute'}`}>
                  {q.state}
                </span>
              </div>
            ))}
          </div>
          {failed.length > 0 && (
            <p className="text-xs mt-3 pt-3" style={{ color: 'var(--dim)', borderTop: '1px solid var(--border)' }}>
              A failed request spent its credits. {failed.length} of them here.
            </p>
          )}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="table-scroll">
          <table className="w-full text-sm" style={{ minWidth: 780 }}>
            <thead>
              <tr style={{ background: 'var(--card2)', borderBottom: '1px solid var(--border)' }}>
                <th className="px-4 py-2.5 text-left eyebrow">Restaurant</th>
                {['Dishes', '3D', 'Models', 'Waiting', 'Diners', 'Opens', 'AR', 'Quota'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-right eyebrow">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.tenant_id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="px-4 py-2.5">
                    <Link href={`/home?tenant=${r.slug}`} className="font-semibold hover:underline">
                      {r.name}
                    </Link>
                    <div className="text-xs" style={{ color: 'var(--dim)' }}>/{r.slug}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right">{r.dishes}</td>
                  <td className="px-3 py-2.5 text-right"
                      style={{ color: r.dishes_3d ? 'var(--gold)' : 'var(--dim)' }}>{r.dishes_3d}</td>
                  <td className="px-3 py-2.5 text-right">{r.models}</td>
                  <td className="px-3 py-2.5 text-right"
                      style={{ color: r.models_draft ? 'var(--gold)' : 'var(--dim)' }}>{r.models_draft}</td>
                  <td className="px-3 py-2.5 text-right">{Number(r.sessions).toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right">{Number(r.item_opens).toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right">{Number(r.ar_opens).toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right" style={{ color: 'var(--dim)' }}>
                    {r.quota_used}/{r.quota}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && rows.length === 0 && (
          <p className="p-8 text-center text-sm" style={{ color: 'var(--dim)' }}>
            No restaurants yet.
          </p>
        )}
      </div>
    </div>
  )
}
