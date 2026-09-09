'use client'
// Analytics.
//
// The layout is ALWAYS drawn, even with nothing in it. An empty screen that says "no
// visits yet" teaches an owner nothing about what is being counted; a full one with
// zeroes in it shows them exactly what will appear, and is the difference between "this
// does not work" and "this has not started".
//
// Ranges are minutes, which is the only unit that can say "the last hour" - the question
// you ask on the evening the QR codes go on the tables (0014).
//
// **Percentages are of SESSIONS, never of hits.** One diner opening four dishes is one
// person who opened 3D, not four, and a funnel counted in hits flatters itself at exactly
// the point where it should be honest.

import { useCallback, useEffect, useState } from 'react'
import { usePlan } from '@/lib/usePlan'
import { createClient } from '@/lib/supabase/client'
import { useLang } from '@/lib/useLang'
import { text } from '@/lib/i18n'

type Funnel = { name: string; sessions: number; hits: number }
type TopItem = { item_id: string; name: string; opens: number; ar: number }
type Point = { bucket: string; sessions: number; opens: number }
type TableRow = { table_no: string; sessions: number; opens: number; ar: number }

const RANGES: [string, number][] = [
  ['1h', 60],
  ['24h', 1440],
  ['7d', 10080],
  ['30d', 43200],
  ['90d', 129600],
]

export default function DashboardPage() {
  const [T] = useLang()
  const plan = usePlan()
  const [minutes, setMinutes] = useState(43200)
  const [custom, setCustom] = useState({ n: '', unit: 'days' as 'minutes' | 'hours' | 'days' })
  const [funnel, setFunnel] = useState<Funnel[]>([])
  const [items, setItems] = useState<TopItem[]>([])
  const [series, setSeries] = useState<Point[]>([])
  const [tables, setTables] = useState<TableRow[]>([])
  // `loading` is DERIVED, not set inside the effect. Every one of these screens used to
  // open with `setLoading(plan.loading)` in the effect body, which is a synchronous state
  // write during an effect and so a second render before the first has painted - on every
  // screen, on every navigation. Tracking which restaurant the data belongs to says the
  // same thing without the extra render, and correctly shows loading again when somebody
  // switches restaurant.
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const loading = plan.loading || (!!plan.restaurantId && loadedFor !== plan.restaurantId)

  const load = useCallback(async () => {
    if (plan.loading || !plan.restaurantId) return
    const supabase = createClient()
    const args = { p_tenant: plan.restaurantId, p_minutes: minutes }
    const [f, i, s, tb] = await Promise.all([
      supabase.rpc('event_funnel', args),
      supabase.rpc('event_top_items', { ...args, p_limit: 15 }),
      supabase.rpc('event_series', args),
      supabase.rpc('event_by_table', args),
    ])
    setFunnel((f.data as Funnel[]) || [])
    setItems((i.data as TopItem[]) || [])
    setSeries((s.data as Point[]) || [])
    setTables((tb.data as TableRow[]) || [])
    setLoadedFor(plan.restaurantId)
  }, [plan.loading, plan.restaurantId, minutes])

  useEffect(() => { void load() }, [load])

  function applyCustom() {
    const n = Number(custom.n)
    if (!Number.isFinite(n) || n <= 0) return
    const mult = custom.unit === 'minutes' ? 1 : custom.unit === 'hours' ? 60 : 1440
    setMinutes(Math.min(Math.round(n * mult), 525600))   // a year is plenty
  }

  const at = (name: string) => funnel.find(f => f.name === name)?.sessions ?? 0
  const visits = at('view')
  const pct = (n: number) => (visits ? Math.round((n / visits) * 100) : 0)

  const steps = [
    { label: 'Opened the menu', value: visits, note: 'Sessions. One diner, one tab.' },
    { label: 'Got past the hero', value: at('hero_pass'), note: 'Scrolled far enough to see a dish.' },
    { label: 'Opened a dish in 3D', value: at('item_open'), note: 'The thing nobody else has.' },
    { label: 'Reached AR', value: at('ar_open'), note: 'Tapped to put it on their table.' },
    { label: 'Placed it on a table', value: at('ar_placed'), note: 'Got all the way through AR.' },
  ]

  const rangeLabel = minutes < 120 ? `${minutes} min`
    : minutes < 2880 ? `${Math.round(minutes / 60)} hours`
    : `${Math.round(minutes / 1440)} days`

  if (!plan.loading && !plan.restaurantId) {
    return <div className="card p-6 text-sm" style={{ color: 'var(--dim)' }}>{T.pickRestaurantFirst}</div>
  }

  return (
    <div className="page-content">
      <div className="flex items-center gap-3 flex-wrap mb-5">
        <div className="mr-auto">
          <h1 className="page-title">{T.dashTitle}</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--dim)' }}>
            {text(T.dashLastRange, { range: rangeLabel })}
            {visits === 0 && <> · {T.dashNothingYet}</>}
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

        {/* Anything the presets do not cover. "Last 5 days" is a real question and a
            fixed row of buttons cannot answer it. */}
        <div className="flex items-center gap-1">
          <input type="number" min={1} value={custom.n} placeholder="5" style={{ width: 64 }}
                 className="text-xs"
                 onChange={e => setCustom(c => ({ ...c, n: e.target.value }))}
                 onKeyDown={e => { if (e.key === 'Enter') applyCustom() }} />
          <select value={custom.unit} className="text-xs" style={{ width: 'auto' }}
                  onChange={e => setCustom(c => ({ ...c, unit: e.target.value as typeof c.unit }))}>
            <option value="minutes">min</option>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
          <button className="btn btn-sm" onClick={applyCustom} disabled={!custom.n}>Go</button>
        </div>
      </div>

      {visits === 0 && !loading && (
        <div className="card px-4 py-3 mb-4 text-sm" style={{ color: 'var(--dim)' }}>
          Nothing counted in this range yet. Everything below is what will appear — counting
          starts the moment a diner opens the menu, and nothing is backfilled.
        </div>
      )}

      <div className="grid gap-4">
        {/* the funnel */}
        <div className="card p-5">
          <div className="eyebrow mb-4">{T.dashFunnel}</div>
          <div className="grid gap-3">
            {steps.map((s, i) => {
              const share = pct(s.value)
              return (
                <div key={s.label}>
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-sm font-semibold flex-1">{s.label}</span>
                    <span className="text-sm font-semibold"
                          style={{ color: i === 0 ? 'var(--text)' : 'var(--gold)' }}>
                      {s.value.toLocaleString()}
                    </span>
                    {i > 0 && (
                      <span className="text-xs w-10 text-right" style={{ color: 'var(--dim)' }}>
                        {share}%
                      </span>
                    )}
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--card2)' }}>
                    <div className="h-full rounded-full transition-all"
                         style={{ width: `${i === 0 ? (visits ? 100 : 0) : share}%`,
                                  background: i === 0 ? 'var(--dim)' : 'var(--gold)' }} />
                  </div>
                  <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>{s.note}</p>
                </div>
              )
            })}
          </div>
          <p className="text-xs mt-4 pt-4" style={{ color: 'var(--dim)', borderTop: '1px solid var(--border)' }}>
            Every percentage is of sessions, not taps. One diner opening four dishes is one
            person who opened 3D, not four.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-5">
            <div className="eyebrow mb-4">{T.dashVisitsOverTime}</div>
            <Chart points={series} minutes={minutes} />
          </div>

          <div className="card p-5">
            <div className="eyebrow mb-4">{T.dashMostOpened}</div>
            {items.length === 0 ? (
              <Placeholder rows={['Your busiest dish', 'The next one', '…']} />
            ) : (
              <div className="grid gap-2">
                {items.map(it => (
                  <div key={it.item_id} className="flex items-baseline gap-3 text-sm">
                    <span className="flex-1 truncate">{it.name}</span>
                    <span className="font-semibold">{it.opens}</span>
                    {it.ar > 0 && <span className="pill pill-wait">{it.ar} AR</span>}
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs mt-4" style={{ color: 'var(--dim)' }}>
              {T.dashWorthBuilding}
            </p>
          </div>
        </div>

        {/* per table */}
        <div className="card p-5">
          <div className="flex items-baseline gap-3 mb-4">
            <div className="eyebrow">{T.dashByTable}</div>
            <span className="text-xs ml-auto" style={{ color: 'var(--dim)' }}>
              {T.dashFromTableCodes}
            </span>
          </div>
          {tables.length === 0 ? (
            <Placeholder rows={[text(T.shareTableN, { n: 1 }), text(T.shareTableN, { n: 2 }),
                                 T.dashNoTableRow]} />
          ) : (
            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th className="text-left eyebrow py-2">{T.dashTable}</th>
                    <th className="text-right eyebrow py-2">{T.dashDiners}</th>
                    <th className="text-right eyebrow py-2">{T.dashOpens3d}</th>
                    <th className="text-right eyebrow py-2">AR</th>
                  </tr>
                </thead>
                <tbody>
                  {tables.map(r => (
                    <tr key={r.table_no} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="py-2 font-semibold">
                        {r.table_no === '—'
                          ? <span style={{ color: 'var(--dim)' }}>{T.dashNoTable}</span>
                          : text(T.shareTableN, { n: r.table_no })}
                      </td>
                      <td className="py-2 text-right">{r.sessions}</td>
                      <td className="py-2 text-right">{r.opens}</td>
                      <td className="py-2 text-right">{r.ar}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs mt-4" style={{ color: 'var(--dim)' }}>
            A scan with no table number came from the door, the bill, or the single
            restaurant code.
          </p>
        </div>
      </div>
    </div>
  )
}

/** What a section will look like once there is something in it. Greyed rows rather than a
 *  sentence, because the shape is the information: it says which numbers exist. */
function Placeholder({ rows }: { rows: string[] }) {
  return (
    <div className="grid gap-2" aria-hidden="true">
      {rows.map((r, i) => (
        <div key={i} className="flex items-baseline gap-3 text-sm" style={{ opacity: .35 }}>
          <span className="flex-1 truncate">{r}</span>
          <span className="font-semibold">0</span>
        </div>
      ))}
    </div>
  )
}

/** Bars, not a chart library. Thirty numbers do not need 60 KB of JavaScript, and a chart
 *  dependency on an admin screen has to be kept current forever to draw a shape a div
 *  makes. The bucket size comes from the range (0014), so an hour reads in minutes and a
 *  month in days. */
function Chart({ points, minutes }: { points: Point[]; minutes: number }) {
  if (points.length === 0) {
    return (
      <div>
        <div className="flex items-end gap-[3px] h-28" aria-hidden="true">
          {Array.from({ length: 24 }, (_, i) => (
            <div key={i} className="flex-1 rounded-t"
                 style={{ height: `${8 + ((i * 37) % 40)}%`, background: 'var(--card2)' }} />
          ))}
        </div>
        <p className="text-xs mt-2 text-center" style={{ color: 'var(--dim)' }}>
          Diners per {minutes <= 180 ? 'minute' : minutes <= 4320 ? 'hour' : 'day'}
        </p>
      </div>
    )
  }
  const peak = Math.max(...points.map(p => p.sessions), 1)
  const fmt = (iso: string) => {
    const d = new Date(iso)
    return minutes <= 4320
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
  return (
    <div>
      <div className="flex items-end gap-[3px] h-28">
        {points.map(p => (
          <div key={p.bucket} className="flex-1 rounded-t transition-all"
               style={{ height: `${Math.max(3, (p.sessions / peak) * 100)}%`,
                        background: 'var(--gold)', opacity: .85 }}
               title={`${fmt(p.bucket)} · ${p.sessions} diners, ${p.opens} opened in 3D`} />
        ))}
      </div>
      <div className="flex justify-between mt-2 text-xs" style={{ color: 'var(--dim)' }}>
        <span>{fmt(points[0].bucket)}</span>
        <span>peak {peak}</span>
        <span>{fmt(points[points.length - 1].bucket)}</span>
      </div>
    </div>
  )
}
