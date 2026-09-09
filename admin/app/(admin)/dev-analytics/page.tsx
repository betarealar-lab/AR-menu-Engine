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

/** Is this request late, and how late - or null when it is fine.
 *
 *  **The old rule was backwards.** It warned only on `pending`, which is the one state
 *  that is legitimately waiting on a HUMAN: over quota, sitting there until one of us
 *  approves it. Nothing was ever said about `approved` or `running`, and those are the
 *  two states that mean the ENGINE is broken - approved and unclaimed means no worker is
 *  running at all (it launches from the Startup folder, so a machine that rebooted and
 *  was never logged into has none), and running and silent means a wedged job or a
 *  callback that never came. A request could sit in `approved` for six hours and this
 *  screen, whose whole purpose is making stuck work impossible to miss, showed nothing.
 *
 *  Two thresholds because the two clocks mean different things: an hour is a fair nudge
 *  for a decision a person owes, twenty minutes is already wrong for a machine.
 */
function lateness(q: { state: string; minutes_waiting: number }): string | null {
  const limit = q.state === 'pending' ? 60
    : q.state === 'approved' || q.state === 'running' ? 20
      : null
  if (limit === null || q.minutes_waiting <= limit) return null
  const m = q.minutes_waiting
  const how = m < 120 ? `${Math.round(m)}m`
    : m < 2880 ? `${Math.round(m / 60)}h`
      : `${Math.round(m / 1440)}d`
  // Named, because "3h waiting" on an approved request and on a pending one are two
  // different problems and only one of them is ours to click.
  return q.state === 'pending' ? `${how} waiting on us` : `${how} — no engine?`
}

export default function DevAnalyticsPage() {
  const plan = usePlan()
  const [minutes, setMinutes] = useState(43200)
  const [rows, setRows] = useState<Row[]>([])
  const [queue, setQueue] = useState<QueueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const say = useCallback((m: string) => {
    setMsg(m)
    setTimeout(() => setMsg(''), 4000)
  }, [])

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
                {lateness(q) && (
                  <span className="text-xs whitespace-nowrap"
                        style={{ color: 'var(--danger)' }}>
                    {lateness(q)}
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

      {msg && <div className="card px-4 py-3 mb-4 text-sm">{msg}</div>}

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
                    <div className="text-xs flex items-center gap-2" style={{ color: 'var(--dim)' }}>
                      <span>/{r.slug}</span>
                      <CopyRestaurant row={r} onSaved={load} onSay={say} />
                    </div>
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
                  <td className="px-3 py-2.5 text-right">
                    <QuotaCell row={r} onSaved={load} onSay={say} />
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


/** The free-model limit, editable in place.
 *
 *  **The button is not the rule.** `model_quota` is not writable by `authenticated` at all
 *  (0018 revokes the column grant), and `set_model_quota` is SECURITY DEFINER with
 *  `is_super_admin()` inside it. So an owner who reaches this URL sees an empty table, and
 *  an owner who reconstructs this call by hand gets 42501 from the database. Hiding a
 *  control is a courtesy; the database is the boundary.
 *
 *  Reads back through `load()` rather than trusting the local value: the number that
 *  matters is the one `model_request_gate()` will read on the next request, and the only
 *  honest way to show it is to ask.
 */
function QuotaCell({ row, onSaved, onSay }: {
  row: Row; onSaved: () => void; onSay: (m: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(row.quota))
  const [saving, setSaving] = useState(false)

  async function save() {
    const n = Number(value)
    if (!Number.isInteger(n) || n < 0 || n > 1000) {
      onSay('A limit is a whole number between 0 and 1000.')
      return
    }
    if (n === row.quota) { setEditing(false); return }
    setSaving(true)
    const { error } = await createClient().rpc('set_model_quota',
      { p_tenant: row.tenant_id, p_quota: n })
    setSaving(false)
    setEditing(false)
    if (error) { onSay(`Could not change it: ${error.message}`); return }
    // Said in dishes, not in numbers: "3" means nothing until you know 3 of what.
    onSay(`${row.name}: ${n} free model${n === 1 ? '' : 's'}, ${row.quota_used} used.`)
    onSaved()
  }

  if (!editing) {
    return (
      <button type="button" onClick={() => { setValue(String(row.quota)); setEditing(true) }}
              title="Change the free-model limit"
              className="tabular-nums hover:underline"
              style={{ color: row.quota_used >= row.quota ? 'var(--gold)' : 'var(--dim)' }}>
        {row.quota_used}/{row.quota}
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 justify-end">
      <span className="tabular-nums" style={{ color: 'var(--dim)' }}>{row.quota_used}/</span>
      <input type="number" min={0} max={1000} value={value} autoFocus disabled={saving}
             onChange={e => setValue(e.target.value)}
             onKeyDown={e => {
               if (e.key === 'Enter') void save()
               if (e.key === 'Escape') setEditing(false)
             }}
             onBlur={() => void save()}
             aria-label={`Free model limit for ${row.name}`}
             className="w-16 text-right" style={{ padding: '2px 6px' }} />
    </span>
  )
}


/** Duplicate a restaurant into a sandbox.
 *
 *  What it is for: there are two live restaurants and a two-dish demo, so every experiment
 *  - reordering 170 dishes, a template change, the language switch - has had to be run
 *  against a paying client or against something that exercises nothing. This makes a copy
 *  with real, awkward data in it that costs nothing to break.
 *
 *  Confirmed before it runs, because it makes a whole restaurant and a list of five that
 *  quietly becomes a list of nine is its own kind of mess.
 *
 *  The copy carries the menu, the look and the model ROWS (pointing at the same R2 files,
 *  so nothing is duplicated and no credit is spent). It does not carry the free-model
 *  quota, the diners, or anything in flight - see copy_tenant in 0020, where those choices
 *  are the reasoning rather than the code.
 */
function CopyRestaurant({ row, onSaved, onSay }: {
  row: Row; onSaved: () => void; onSay: (m: string) => void
}) {
  const [busy, setBusy] = useState(false)

  async function copy() {
    if (!confirm(`Make a copy of ${row.name} to test on?

`
      + `It gets the menu, the look and the 3D — but no free models, no diners, and `
      + `nothing that is currently building.`)) return
    setBusy(true)
    const { data, error } = await createClient().rpc('copy_tenant', { p_source: row.tenant_id })
    setBusy(false)
    if (error) { onSay(`Could not copy it: ${error.message}`); return }
    const made = Array.isArray(data) ? data[0] : data
    onSay(`Copied to /${made?.slug} — ${made?.items} dishes, ${made?.models} models.`)
    onSaved()
  }

  return (
    <button type="button" onClick={() => void copy()} disabled={busy}
            className="underline" title="Duplicate this restaurant to test on">
      {busy ? 'copying…' : 'copy'}
    </button>
  )
}
