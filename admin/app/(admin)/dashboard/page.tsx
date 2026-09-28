'use client'
// Analytics - redesigned 2026-09-28 (Temo: "make UI better, I don't like it").
//
// What changed, and why each thing is where it is:
//
//   * ONE row of range controls at the top, and it scopes everything below it, so every
//     number on the screen agrees with every other.
//   * Four stat tiles lead - the four numbers an owner actually asks about - each with its
//     change against the period before, so "is it going up" needs no arithmetic.
//   * The over-time chart is a real chart now: a continuous line (empty hours are ZERO,
//     not skipped - the old bars silently dropped them and made a quiet week look busy),
//     visitors and 3D opens on one scale, a crosshair tooltip, and a table view.
//   * "Does 3D sell the dish?" - `event_3d_lift` (0014) existed and nothing showed it. It
//     is the sentence that renews a ₾300 subscription.
//   * Dishes and tables are ranked bars, not lists of numbers.
//
// Unchanged, on purpose: percentages are of SESSIONS, never hits (one diner opening four
// dishes is one person who opened 3D), and the layout is always drawn, zeroes included,
// so an empty screen shows what will be counted rather than looking broken.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlan } from '@/lib/usePlan'
import { createClient } from '@/lib/supabase/client'
import { useLang } from '@/lib/useLang'
import { text } from '@/lib/i18n'

type Funnel = { name: string; sessions: number; hits: number }
type TopItem = { item_id: string; name: string; opens: number; ar: number }
type Point = { bucket: string; sessions: number; opens: number }
type TableRow = { table_no: string; sessions: number; opens: number; ar: number }
type Lift = { with_3d: number; without_3d: number; dishes_3d: number; dishes_plain: number }

const RANGES: [string, number][] = [
  ['24h', 1440], ['7d', 10080], ['30d', 43200], ['90d', 129600],
]

// The same buckets `event_series` uses (0014): minutes up to 3 h, hours up to 3 days,
// days beyond - so the gaps filled here line up exactly with the rows it returns.
const unitMs = (minutes: number) =>
  minutes <= 180 ? 60_000 : minutes <= 4320 ? 3_600_000 : 86_400_000

export default function DashboardPage() {
  const [T, lang] = useLang()
  const plan = usePlan()
  const [minutes, setMinutes] = useState(43200)
  const [customOpen, setCustomOpen] = useState(false)
  const [custom, setCustom] = useState({ n: '', unit: 'days' as 'minutes' | 'hours' | 'days' })
  const [data, setData] = useState<{
    funnel: Funnel[]; prev: Funnel[]; items: TopItem[]; series: Point[]
    tables: TableRow[]; lift: Lift | null; key: string; at: number
  } | null>(null)
  const want = `${plan.restaurantId}:${minutes}`
  const refetching = !!data && data.key !== want

  // Fetches and hands back; the effect below does the setting, in the promise's callback,
  // so no state is written synchronously inside an effect.
  const fetchAll = useCallback(async () => {
    if (plan.loading || !plan.restaurantId) return null
    const supabase = createClient()
    const args = { p_tenant: plan.restaurantId, p_minutes: minutes }
    // The period before, as "twice the range minus this range". Sessions rarely span the
    // boundary, so the subtraction is honest to within a visitor or two.
    const [f, f2, i, s, tb, l] = await Promise.all([
      supabase.rpc('event_funnel', args),
      supabase.rpc('event_funnel', { ...args, p_minutes: Math.min(minutes * 2, 1051200) }),
      supabase.rpc('event_top_items', { ...args, p_limit: 10 }),
      supabase.rpc('event_series', args),
      supabase.rpc('event_by_table', args),
      supabase.rpc('event_3d_lift', args),
    ])
    const cur = (f.data as Funnel[]) || []
    const both = (f2.data as Funnel[]) || []
    const prev = both.map(b => ({
      name: b.name,
      sessions: Math.max(0, Number(b.sessions) - Number(cur.find(c => c.name === b.name)?.sessions ?? 0)),
      hits: 0,
    }))
    return {
      funnel: cur, prev,
      items: (i.data as TopItem[]) || [],
      series: (s.data as Point[]) || [],
      tables: (tb.data as TableRow[]) || [],
      lift: ((l.data as Lift[]) || [])[0] ?? null,
      key: `${plan.restaurantId}:${minutes}`,
      // The clock the chart's empty buckets are laid out against. Captured here, once,
      // rather than read during render - a render must not depend on when it happens.
      at: Date.now(),
    }
  }, [plan.loading, plan.restaurantId, minutes])

  useEffect(() => {
    let dead = false
    fetchAll().then(d => { if (d && !dead) setData(d) })
    return () => { dead = true }
  }, [fetchAll])

  function applyCustom() {
    const n = Number(custom.n)
    if (!Number.isFinite(n) || n <= 0) return
    const mult = custom.unit === 'minutes' ? 1 : custom.unit === 'hours' ? 60 : 1440
    setMinutes(Math.min(Math.round(n * mult), 525600))
    setCustomOpen(false)
  }

  const rangeLabel = minutes < 120 ? `${minutes} ${T.dashUnitMin}`
    : minutes < 2880 ? `${Math.round(minutes / 60)} ${T.dashUnitHours}`
      : `${Math.round(minutes / 1440)} ${T.dashUnitDays}`
  const isPreset = RANGES.some(([, m]) => m === minutes)

  if (!plan.loading && !plan.restaurantId) {
    return <div className="card p-6 text-sm" style={{ color: 'var(--dim)' }}>{T.pickRestaurantFirst}</div>
  }

  const funnel = data?.funnel ?? []
  const prev = data?.prev ?? []
  const at = (list: Funnel[], name: string) => Number(list.find(f => f.name === name)?.sessions ?? 0)
  const visits = at(funnel, 'view')
  const pctOf = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0)

  const tiles = [
    { label: T.dashVisitors, name: 'view', sub: null as string | null },
    { label: T.dashOpened3d, name: 'item_open', sub: 'pct' },
    { label: T.dashReachedAr, name: 'ar_open', sub: 'pct' },
    { label: T.dashPlaced, name: 'ar_placed', sub: 'pct' },
  ]

  return (
    <div className="page-content">
      {/* ── The one control row ── */}
      <div className="flex items-end gap-3 flex-wrap mb-6">
        <div className="mr-auto min-w-0">
          <h1 className="page-title">{T.dashTitle}</h1>
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--dim)' }}>
            {plan.restaurantName} · {text(T.dashLastRange, { range: rangeLabel })}
            {data && at(prev, 'view') === 0 && visits > 0 && <> · {T.dashNoPrev}</>}
          </p>
        </div>
        <div className="relative flex rounded-lg p-0.5" style={{ background: 'var(--card2)' }}
             role="group" aria-label={T.dashTime}>
          {RANGES.map(([label, m]) => {
            const on = minutes === m
            return (
              <button key={label} onClick={() => setMinutes(m)} aria-pressed={on}
                      className="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors"
                      style={{ background: on ? 'var(--card)' : 'transparent',
                               color: on ? 'var(--text)' : 'var(--dim)',
                               boxShadow: on ? 'var(--shadow)' : 'none' }}>
                {label}
              </button>
            )
          })}
          <button onClick={() => setCustomOpen(o => !o)} aria-expanded={customOpen}
                  className="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors"
                  style={{ background: !isPreset ? 'var(--card)' : 'transparent',
                           color: !isPreset ? 'var(--text)' : 'var(--dim)',
                           boxShadow: !isPreset ? 'var(--shadow)' : 'none' }}>
            {isPreset ? T.dashCustom : rangeLabel}
          </button>
          {customOpen && (
            <div className="absolute right-0 top-full mt-2 z-20 card p-3 flex items-center gap-2 shadow-2xl">
              <div style={{ width: 72 }}>
                <input type="number" min={1} value={custom.n} placeholder="5" autoFocus
                       onChange={e => setCustom(c => ({ ...c, n: e.target.value }))}
                       onKeyDown={e => { if (e.key === 'Enter') applyCustom() }} />
              </div>
              <div style={{ width: 110 }}>
                <select value={custom.unit}
                        onChange={e => setCustom(c => ({ ...c, unit: e.target.value as typeof c.unit }))}>
                  <option value="minutes">{T.dashUnitMin}</option>
                  <option value="hours">{T.dashUnitHours}</option>
                  <option value="days">{T.dashUnitDays}</option>
                </select>
              </div>
              <button className="btn btn-primary btn-sm" onClick={applyCustom} disabled={!custom.n}>
                {T.dashApply}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Refetch keeps the frame: the old numbers stay, dimmed, instead of a flash. */}
      <div className="grid gap-4 transition-opacity" style={{ opacity: refetching || !data ? 0.55 : 1 }}>
        {data && visits === 0 && (
          <div className="card px-4 py-3 text-sm" style={{ color: 'var(--dim)' }}>{T.dashNothingRange}</div>
        )}

        {/* ── Stat tiles ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {tiles.map(t => {
            const now = at(funnel, t.name)
            const before = at(prev, t.name)
            return (
              <StatTile key={t.name} label={t.label} value={now}
                        sub={t.sub ? text(T.dashOfVisitors, { pct: pctOf(now, visits) }) : null}
                        before={data ? before : null} rangeLabel={rangeLabel} T={T} lang={lang} />
            )
          })}
        </div>

        {/* ── Over time ── */}
        <div className="card p-5 min-w-0">
          <TrendChart points={data?.series ?? []} minutes={minutes} now={data?.at ?? 0} T={T} lang={lang} />
        </div>

        <div className="grid gap-4 lg:grid-cols-5">
          {/* ── Funnel ── */}
          <div className="card p-5 lg:col-span-3">
            <h2 className="text-sm font-semibold mb-4">{T.dashFunnel}</h2>
            <FunnelBars visits={visits} T={T} steps={[
              { label: T.dashVisitors, value: visits },
              { label: T.dashPastHero, value: at(funnel, 'hero_pass') },
              { label: T.dashOpened3d, value: at(funnel, 'item_open') },
              { label: T.dashReachedAr, value: at(funnel, 'ar_open') },
              { label: T.dashPlaced, value: at(funnel, 'ar_placed') },
            ]} />
            <p className="text-xs mt-4 pt-3" style={{ color: 'var(--dim)', borderTop: '1px solid var(--border)' }}>
              {T.dashSessionsNote}
            </p>
          </div>

          {/* ── The number that renews ── */}
          <div className="card p-5 lg:col-span-2 flex flex-col">
            <h2 className="text-sm font-semibold mb-3">{T.dashLiftTitle}</h2>
            <LiftCard lift={data?.lift ?? null} T={T} />
          </div>
        </div>

        {/* The restaurant's own website (0028). Shown only once it has happened: most
            restaurants have no embed, and a card of zeroes would read as a feature they
            are failing at. */}
        {at(funnel, 'embed_view') > 0 && (
          <div className="card p-5">
            <div className="flex items-baseline gap-2 mb-4 flex-wrap">
              <h2 className="text-sm font-semibold">{T.dashWebsite}</h2>
              <span className="text-xs" style={{ color: 'var(--dim)' }}>{T.dashWebsiteNote}</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {([[T.dashWebsiteViews, 'embed_view'], [T.dashWebsite3d, 'embed_3d'], [T.dashWebsiteAr, 'embed_ar']] as const)
                .map(([label, name]) => (
                  <div key={name}>
                    <div className="text-xs" style={{ color: 'var(--dim)' }}>{label}</div>
                    <div className="text-2xl font-bold mt-0.5" style={{ fontVariantNumeric: 'normal' }}>
                      {fmt(at(funnel, name), lang)}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-5 min-w-0">
            <div className="flex items-baseline gap-2 mb-4">
              <h2 className="text-sm font-semibold">{T.dashMostOpened}</h2>
              <span className="text-xs ml-auto" style={{ color: 'var(--dim)' }}>{T.dashOpens3d} · AR</span>
            </div>
            <RankBars rows={(data?.items ?? []).map(r => ({
              key: r.item_id, label: r.name, value: Number(r.opens), extra: Number(r.ar),
            }))} empty={['—', '—', '—']} />
            <p className="text-xs mt-4" style={{ color: 'var(--dim)' }}>{T.dashWorthBuilding}</p>
          </div>

          <div className="card p-5">
            <div className="flex items-baseline gap-2 mb-4">
              <h2 className="text-sm font-semibold">{T.dashByTable}</h2>
              <span className="text-xs ml-auto" style={{ color: 'var(--dim)' }}>{T.dashDiners} · AR</span>
            </div>
            <RankBars rows={(data?.tables ?? []).map(r => ({
              key: r.table_no,
              label: r.table_no === '—' ? T.dashNoTableRow : text(T.shareTableN, { n: r.table_no }),
              value: Number(r.sessions), extra: Number(r.ar), muted: r.table_no === '—',
            }))} empty={[text(T.shareTableN, { n: 1 }), text(T.shareTableN, { n: 2 }), T.dashNoTableRow]} />
            <p className="text-xs mt-4" style={{ color: 'var(--dim)' }}>{T.dashFromTableCodes}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

type Dict = ReturnType<typeof useLang>[0]

const fmt = (n: number, lang: string) =>
  new Intl.NumberFormat(lang === 'ka' ? 'ka-GE' : 'en-US', { notation: n >= 10000 ? 'compact' : 'standard' }).format(n)

/** Label, value, and the change against the period before. The arrow and the sign carry
 *  the direction, so it never rests on green-versus-red alone. */
function StatTile({ label, value, sub, before, rangeLabel, T, lang }: {
  label: string; value: number; sub: string | null; before: number | null
  rangeLabel: string; T: Dict; lang: string
}) {
  let delta: { text: string; up: boolean; flat: boolean } | null = null
  if (before !== null && before > 0) {
    const d = Math.round(((value - before) / before) * 100)
    delta = { text: `${d > 0 ? '+' : ''}${d}%`, up: d > 0, flat: d === 0 }
  }
  return (
    <div className="card p-4">
      <div className="text-xs" style={{ color: 'var(--dim)' }}>{label}</div>
      <div className="text-3xl font-bold mt-1 tracking-tight" style={{ fontVariantNumeric: 'normal' }}>
        {fmt(value, lang)}
      </div>
      <div className="text-xs mt-1 min-h-[1rem]" style={{ color: 'var(--dim)' }}>{sub}</div>
      <div className="text-xs mt-2 flex items-center gap-1.5 flex-wrap">
        {delta ? (
          <>
            <span className="font-semibold"
                  style={{ color: delta.flat ? 'var(--dim)' : delta.up ? 'var(--success)' : 'var(--danger)' }}>
              {delta.flat ? '→' : delta.up ? '▲' : '▼'} {delta.text}
            </span>
            <span style={{ color: 'var(--dim)' }}>{text(T.dashVsPrev, { range: rangeLabel })}</span>
          </>
        ) : (
          // Said once, in the header, rather than four times here.
          <span>{' '}</span>
        )}
      </div>
    </div>
  )
}

/** Visitors and 3D opens over time. One scale (both are counts), a hairline grid, the
 *  visitors line with a 10% wash under it, a crosshair that snaps to the nearest bucket,
 *  and a table view for anyone who would rather read numbers. */
function TrendChart({ points, minutes, now, T, lang }: {
  points: Point[]; minutes: number; now: number; T: Dict; lang: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(640)
  const [hover, setHover] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Every bucket in the range, empty ones as zero. Skipping them drew a quiet week as a
  // busy one - five bars side by side with the empty days between them simply gone.
  const series = useMemo(() => {
    const step = unitMs(minutes)
    const byT = new Map(points.map(p => [Math.floor(Date.parse(p.bucket) / step) * step,
      { v: Number(p.sessions), o: Number(p.opens) }]))
    if (!now) return []
    const end = Math.floor(now / step) * step
    const start = Math.floor((now - minutes * 60_000) / step) * step
    const out: { t: number; v: number; o: number }[] = []
    for (let t = start; t <= end; t += step) out.push({ t, ...(byT.get(t) ?? { v: 0, o: 0 }) })
    return out
  }, [points, minutes, now])

  const H = 200, padL = 36, padR = 12, padT = 12, padB = 26
  const peak = Math.max(1, ...series.map(p => Math.max(p.v, p.o)))
  const niceMax = (() => {
    const pow = 10 ** Math.floor(Math.log10(peak))
    const n = peak / pow
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow
  })()
  const ticks = [0, niceMax / 2, niceMax]
  const x = (i: number) => padL + (series.length <= 1 ? 0 : (i / (series.length - 1)) * (w - padL - padR))
  const y = (v: number) => padT + (1 - v / niceMax) * (H - padT - padB)
  const path = (k: 'v' | 'o') => series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join('')
  const area = `${path('v')}L${x(series.length - 1)},${y(0)}L${x(0)},${y(0)}Z`

  const locale = lang === 'ka' ? 'ka-GE' : 'en-GB'
  const label = (t: number) => {
    const d = new Date(t)
    return minutes <= 4320
      ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  }
  const xTicks = series.length ? [0, Math.floor((series.length - 1) / 2), series.length - 1] : []
  const hp = hover !== null ? series[hover] : null
  const peakVisitors = Math.max(0, ...series.map(p => p.v))

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * w
    const i = Math.round(((px - padL) / (w - padL - padR)) * (series.length - 1))
    setHover(Math.max(0, Math.min(series.length - 1, i)))
  }

  return (
    <div>
      <div className="flex items-center gap-4 flex-wrap mb-3">
        <h2 className="text-sm font-semibold mr-auto">{T.dashVisitsOverTime}</h2>
        {/* Legend: line keys, text in text colour - identity is never colour alone. */}
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--dim)' }}>
          <span className="inline-block w-4 h-[2px] rounded" style={{ background: 'var(--viz-1)' }} />{T.dashVisitors}
        </span>
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--dim)' }}>
          <span className="inline-block w-4 h-[2px] rounded" style={{ background: 'var(--viz-2)' }} />{T.dashOpens3d}
        </span>
        <button className="text-xs underline" style={{ color: 'var(--dim)' }} onClick={() => setAsTable(t => !t)}>
          {asTable ? T.dashShowChart : T.dashShowTable}
        </button>
      </div>

      {asTable ? (
        <div className="table-scroll max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs" style={{ color: 'var(--dim)' }}>
                <th className="text-left py-1.5">{T.dashTime}</th>
                <th className="text-right py-1.5">{T.dashVisitors}</th>
                <th className="text-right py-1.5">{T.dashOpens3d}</th>
              </tr>
            </thead>
            <tbody>
              {[...series].reverse().map(p => (
                <tr key={p.t} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="py-1.5">{label(p.t)}</td>
                  <td className="py-1.5 text-right">{p.v}</td>
                  <td className="py-1.5 text-right">{p.o}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        // `width: 100%` on the svg, not `width={w}`: a fixed width set before the first
        // measurement pushed a phone layout 250px past the screen edge, and the observer
        // then measured the overflow it had caused.
        <div ref={box} className="relative w-full min-w-0">
          <svg width="100%" height={H} viewBox={`0 0 ${w} ${H}`} role="img"
               aria-label={`${T.dashVisitsOverTime}: ${text(T.dashPeak, { n: peakVisitors })}`}
               onPointerMove={onMove} onPointerLeave={() => setHover(null)}
               style={{ display: 'block', touchAction: 'pan-y' }}>
            {ticks.map(tv => (
              <g key={tv}>
                <line x1={padL} x2={w - padR} y1={y(tv)} y2={y(tv)} stroke="var(--viz-grid)" strokeWidth={1} />
                <text x={padL - 8} y={y(tv) + 4} textAnchor="end" fontSize={11} fill="var(--dim)">
                  {Number.isInteger(tv) ? tv.toLocaleString() : ''}
                </text>
              </g>
            ))}
            {xTicks.map((i, k) => (
              <text key={i} x={x(i)} y={H - 6} fontSize={11} fill="var(--dim)"
                    textAnchor={k === 0 ? 'start' : k === xTicks.length - 1 ? 'end' : 'middle'}>
                {label(series[i].t)}
              </text>
            ))}
            {series.length > 1 && (
              <>
                <path d={area} fill="var(--viz-1)" opacity={0.1} />
                <path d={path('v')} fill="none" stroke="var(--viz-1)" strokeWidth={2}
                      strokeLinejoin="round" strokeLinecap="round" />
                <path d={path('o')} fill="none" stroke="var(--viz-2)" strokeWidth={2}
                      strokeLinejoin="round" strokeLinecap="round" />
              </>
            )}
            {hp && (
              <g pointerEvents="none">
                <line x1={x(hover!)} x2={x(hover!)} y1={padT} y2={y(0)} stroke="var(--dim)" strokeWidth={1} opacity={0.6} />
                {(['v', 'o'] as const).map(k => (
                  <circle key={k} cx={x(hover!)} cy={y(hp[k])} r={4.5}
                          fill={k === 'v' ? 'var(--viz-1)' : 'var(--viz-2)'} stroke="var(--card)" strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>
          {hp && (
            <div className="absolute top-0 pointer-events-none card px-3 py-2 text-xs shadow-2xl"
                 style={{ left: Math.min(Math.max(0, x(hover!) + 12), w - 150), minWidth: 138 }}>
              <div style={{ color: 'var(--dim)' }}>{label(hp.t)}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="inline-block w-3 h-[2px]" style={{ background: 'var(--viz-1)' }} />
                <b className="text-sm">{hp.v}</b><span style={{ color: 'var(--dim)' }}>{T.dashVisitors}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-[2px]" style={{ background: 'var(--viz-2)' }} />
                <b className="text-sm">{hp.o}</b><span style={{ color: 'var(--dim)' }}>{T.dashOpens3d}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Each step as a bar of the visitors, with two percentages: of everyone, and of the step
 *  just before - the second is where the drop-off actually is. */
function FunnelBars({ steps, visits, T }: {
  steps: { label: string; value: number }[]; visits: number; T: Dict
}) {
  return (
    <div className="grid gap-3.5">
      {steps.map((s, i) => {
        const ofAll = visits ? (s.value / visits) * 100 : 0
        const prevV = i > 0 ? steps[i - 1].value : 0
        return (
          <div key={s.label}>
            <div className="flex items-baseline gap-2 mb-1.5 text-sm">
              <span className="flex-1 truncate">{s.label}</span>
              <b>{s.value.toLocaleString()}</b>
              <span className="text-xs w-10 text-right" style={{ color: 'var(--dim)' }}>
                {i === 0 ? '' : `${Math.round(ofAll)}%`}
              </span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--card2)' }}>
              <div className="h-full rounded-full transition-all"
                   style={{ width: `${i === 0 ? (visits ? 100 : 0) : Math.max(ofAll, s.value ? 1.5 : 0)}%`,
                            background: i >= 2 ? 'var(--viz-2)' : 'var(--viz-1)' }} />
            </div>
            {i > 0 && prevV > 0 && (
              <div className="text-[11px] mt-1" style={{ color: 'var(--dim)' }}>
                {text(T.dashStepOf, { pct: Math.round((s.value / prevV) * 100) })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function LiftCard({ lift, T }: { lift: Lift | null; T: Dict }) {
  const a = Number(lift?.with_3d ?? 0)
  const b = Number(lift?.without_3d ?? 0)
  const ready = !!lift && Number(lift.dishes_3d) > 0 && Number(lift.dishes_plain) > 0 && a > 0 && b > 0
  const x = ready ? a / b : 0
  const peak = Math.max(a, b, 0.0001)
  return (
    <div className="flex-1 flex flex-col">
      {ready && (
        <div className="text-5xl font-bold tracking-tight" style={{ fontVariantNumeric: 'normal' }}>
          {`${x >= 10 ? Math.round(x) : x.toFixed(1)}×`}
        </div>
      )}
      <p className={ready ? 'text-sm mt-2' : 'text-sm'} style={{ color: ready ? 'var(--text)' : 'var(--dim)' }}>
        {ready ? text(T.dashLiftX, { x: x.toFixed(1) }) : T.dashLiftNone}
      </p>
      <div className="grid gap-2 mt-auto pt-5">
        {[['3D', a, 'var(--viz-2)'], [T.dashPhotoDish, b, 'var(--viz-1)']].map(([k, v, c]) => (
          <div key={k as string} className="flex items-center gap-2 text-xs">
            <span className="w-12 shrink-0 truncate" style={{ color: 'var(--dim)' }}>{k}</span>
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--card2)' }}>
              <div className="h-full rounded-full" style={{ width: `${((v as number) / peak) * 100}%`, background: c as string }} />
            </div>
            <span className="w-10 text-right font-semibold">{(v as number).toFixed(1)}</span>
          </div>
        ))}
        {lift && (
          <p className="text-[11px]" style={{ color: 'var(--dim)' }}>
            {text(T.dashLiftDetail, { a: a.toFixed(1), b: b.toFixed(1) })}
          </p>
        )}
      </div>
    </div>
  )
}

/** Ranked horizontal bars: the name, a thin bar scaled to the leader, the value at its
 *  end. `extra` is the AR count, as text beside it - a second bar would be a second scale. */
function RankBars({ rows, empty }: {
  rows: { key: string; label: string; value: number; extra: number; muted?: boolean }[]
  empty: string[]
}) {
  if (!rows.length) {
    return (
      <div className="grid gap-3" aria-hidden="true" style={{ opacity: 0.35 }}>
        {empty.map((r, i) => (
          <div key={i}>
            <div className="flex text-sm mb-1"><span className="flex-1">{r}</span><b>0</b></div>
            <div className="h-1.5 rounded-full" style={{ background: 'var(--card2)' }} />
          </div>
        ))}
      </div>
    )
  }
  const top = Math.max(1, ...rows.map(r => r.value))
  return (
    <div className="grid gap-3">
      {rows.map((r, i) => (
        <div key={r.key}>
          <div className="flex items-baseline gap-2 text-sm mb-1">
            <span className="w-5 text-xs shrink-0" style={{ color: 'var(--dim)' }}>{i + 1}</span>
            <span className="flex-1 truncate" style={{ color: r.muted ? 'var(--dim)' : 'var(--text)' }}>{r.label}</span>
            <b>{r.value.toLocaleString()}</b>
            <span className="text-xs w-12 text-right" style={{ color: 'var(--dim)' }}>
              {r.extra > 0 ? `${r.extra} AR` : ''}
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden ml-7" style={{ background: 'var(--card2)' }}>
            <div className="h-full rounded-full" style={{ width: `${(r.value / top) * 100}%`, background: 'var(--viz-1)' }} />
          </div>
        </div>
      ))}
    </div>
  )
}
