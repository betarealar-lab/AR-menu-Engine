'use client'
// Analytics.
//
// 2026-09-28, twice. First the redesign (Temo: "make UI better, I don't like it"), then
// "add yesterday option, also more relevant stats like avg time spent".
//
//   * Windows, not "the last N minutes": Today, Yesterday, 7/30/90 days and any date range,
//     all on the owner's own clock. One call to `analytics()` (0032) per window - this one
//     and the one before it, for the deltas - so every number on the screen comes from the
//     same rows and no two cards can disagree.
//   * Time: a typical visit (median visible time on the menu) and time spent looking at a
//     dish in 3D. Median, not mean - one tab left open on a table from lunch to dinner
//     makes an average meaningless, which is exactly what the first run showed (52 min).
//   * Ordering: added to basket, shown to the waiter, and the one the company is a bet
//     on - of the dishes a diner opened in 3D, how many they then added to the basket.
//   * Who: busiest hours, iPhone vs Android, where they came from (table QR, restaurant
//     QR, Instagram, Google...), and the language THEIR PHONE is set to - the tourist
//     signal no other tool gives a restaurant.
//
// Unchanged on purpose: percentages are of PEOPLE (sessions), never taps, and the layout
// is always drawn, zeroes included, so an empty screen shows what will be counted.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlan } from '@/lib/usePlan'
import { createClient } from '@/lib/supabase/client'
import { useLang } from '@/lib/useLang'
import { text } from '@/lib/i18n'

type KV = { k: string; v: number }
type Item = { id: string; name: string; opens: number; ar: number; adds: number; avg_3d_s: number | null }
/** One dish, from `dish_stats` (0034). Counts are people, `adds` is basket additions. */
type DishStat = { id: string; name: string; has_3d: boolean; opens: number; ar: number; placed: number
                  adds: number; scans: number; avg_3d_s: number | null }
type Dishes = { visitors: number; items: DishStat[] }
type Report = {
  unit: 'minute' | 'hour' | 'day'
  funnel: Record<string, number>
  hits: Record<string, number>
  time: { sessions: number; measured: number; avg_s: number | null; median_s: number | null; under_10s: number; over_2m: number }
  time_3d: { closes: number; avg_s: number | null; median_s: number | null }
  basket: { sessions: number; adds: number; waiter: number; opened_pairs: number; opened_then_added: number }
  series: { b: string; v: number; o: number }[]
  hours: { h: number; v: number }[]
  devices: KV[]; sources: KV[]; langs: KV[]
  items: Item[]
  tables: { t: string; v: number; o: number; ar: number }[]
  lift: { with_3d: number; without_3d: number; dishes_3d: number; dishes_plain: number }
}

type Preset = 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'custom'
type Win = { from: Date; to: Date }

const DAY = 86_400_000
const midnight = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The window for a preset, on the browser's clock - which is the owner's. "Yesterday" is
 *  00:00 to 24:00 of the day before, not "24 to 48 hours ago". */
function windowFor(p: Preset, now: number, custom: { from: string; to: string }): Win {
  const n = new Date(now)
  switch (p) {
    case 'today': return { from: midnight(n), to: n }
    case 'yesterday': return { from: addDays(midnight(n), -1), to: midnight(n) }
    case '7d': return { from: new Date(now - 7 * DAY), to: n }
    case '90d': return { from: new Date(now - 90 * DAY), to: n }
    case 'custom': {
      const f = custom.from ? new Date(`${custom.from}T00:00:00`) : new Date(now - 30 * DAY)
      const t = custom.to ? addDays(new Date(`${custom.to}T00:00:00`), 1) : n
      return t > f ? { from: f, to: t < n ? t : n } : { from: new Date(now - 30 * DAY), to: n }
    }
    default: return { from: new Date(now - 30 * DAY), to: n }
  }
}

/** The same length of time, immediately before. Yesterday's "before" is the day before. */
const previous = (w: Win): Win => {
  const len = w.to.getTime() - w.from.getTime()
  return { from: new Date(w.from.getTime() - len), to: w.from }
}

export default function DashboardPage() {
  const [T, lang] = useLang()
  const plan = usePlan()
  const [preset, setPreset] = useState<Preset>('30d')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [customOpen, setCustomOpen] = useState(false)
  const [data, setData] = useState<{ cur: Report | null; prev: Report | null; dishes: Dishes | null
                                     key: string; win: Win } | null>(null)
  const tz = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tbilisi' } catch { return 'Asia/Tbilisi' }
  }, [])

  const want = `${plan.restaurantId}:${preset}:${custom.from}:${custom.to}`
  const refetching = !!data && data.key !== want

  const fetchAll = useCallback(async () => {
    if (plan.loading || !plan.restaurantId) return null
    const win = windowFor(preset, Date.now(), custom)
    const before = previous(win)
    const supabase = createClient()
    const call = (w: Win) => supabase.rpc('analytics', {
      p_tenant: plan.restaurantId, p_from: w.from.toISOString(), p_to: w.to.toISOString(), p_tz: tz,
    })
    const [a, b, d] = await Promise.all([call(win), call(before), supabase.rpc('dish_stats', {
      p_tenant: plan.restaurantId, p_from: win.from.toISOString(), p_to: win.to.toISOString(),
    })])
    return {
      cur: (a.data as Report | null) ?? null,
      prev: (b.data as Report | null) ?? null,
      dishes: (d.data as Dishes | null) ?? null,
      key: `${plan.restaurantId}:${preset}:${custom.from}:${custom.to}`,
      win,
    }
  }, [plan.loading, plan.restaurantId, preset, custom, tz])

  useEffect(() => {
    let dead = false
    fetchAll().then(d => { if (d && !dead) setData(d) })
    return () => { dead = true }
  }, [fetchAll])

  if (!plan.loading && !plan.restaurantId) {
    return <div className="card p-6 text-sm" style={{ color: 'var(--dim)' }}>{T.pickRestaurantFirst}</div>
  }

  const r = data?.cur ?? null
  const p = data?.prev ?? null
  const f = (rep: Report | null, name: string) => Number(rep?.funnel?.[name] ?? 0)
  const visits = f(r, 'view')
  const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0)

  const PRESETS: [Preset, string][] = [
    ['today', T.dashToday], ['yesterday', T.dashYesterday],
    ['7d', '7d'], ['30d', '30d'], ['90d', '90d'],
  ]
  const locale = lang === 'ka' ? 'ka-GE' : 'en-GB'
  const winLabel = data ? describeWindow(data.win, preset, T, locale) : ''
  const prevLabel = preset === 'today' ? T.dashVsYesterday
    : preset === 'yesterday' ? T.dashVsDayBefore : T.dashVsPrevPeriod
  const noPrev = !!p && f(p, 'view') === 0

  const secs = (s: number | null | undefined) => formatSecs(s, T)
  const basketPeople = r?.basket.sessions ?? 0

  return (
    <div className="page-content">
      {/* ── The one control row: it scopes everything below it ── */}
      <div className="flex items-end gap-3 flex-wrap mb-6">
        <div className="mr-auto min-w-0">
          <h1 className="page-title">{T.dashTitle}</h1>
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--dim)' }}>
            {plan.restaurantName}{winLabel && <> · {winLabel}</>}
            {noPrev && visits > 0 && <> · {T.dashNoPrev}</>}
          </p>
        </div>
        <div className="relative flex flex-wrap rounded-lg p-0.5" style={{ background: 'var(--card2)' }}
             role="group" aria-label={T.dashTime}>
          {PRESETS.map(([id, label]) => (
            <Seg key={id} on={preset === id} onClick={() => { setPreset(id); setCustomOpen(false) }}>{label}</Seg>
          ))}
          <Seg on={preset === 'custom'} onClick={() => setCustomOpen(o => !o)}>
            {preset === 'custom' && custom.from ? `${custom.from.slice(5)} – ${(custom.to || isoDate(new Date())).slice(5)}` : T.dashCustom} ▾
          </Seg>
          {customOpen && (
            <div className="absolute right-0 top-full mt-2 z-20 card p-3 grid gap-2 shadow-2xl" style={{ width: 260 }}>
              <label className="text-xs" style={{ color: 'var(--dim)' }}>{T.dashFrom}
                <input type="date" value={custom.from} max={custom.to || isoDate(new Date())}
                       onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} />
              </label>
              <label className="text-xs" style={{ color: 'var(--dim)' }}>{T.dashTo}
                <input type="date" value={custom.to} min={custom.from} max={isoDate(new Date())}
                       onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} />
              </label>
              <button className="btn btn-primary btn-sm" disabled={!custom.from}
                      onClick={() => { setPreset('custom'); setCustomOpen(false) }}>{T.dashApply}</button>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 transition-opacity" style={{ opacity: refetching || !data ? 0.55 : 1 }}>
        {data && visits === 0 && (
          <div className="card px-4 py-3 text-sm" style={{ color: 'var(--dim)' }}>{T.dashNothingRange}</div>
        )}

        {/* ── Reach: how far diners got ── */}
        <Section title={T.dashSecReach}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label={T.dashVisitors} value={visits} before={p ? f(p, 'view') : null} prevLabel={prevLabel} lang={lang} />
            <StatTile label={T.dashOpened3d} value={f(r, 'item_open')} before={p ? f(p, 'item_open') : null}
                      sub={text(T.dashOfVisitors, { pct: pct(f(r, 'item_open'), visits) })} prevLabel={prevLabel} lang={lang} />
            <StatTile label={T.dashReachedAr} value={f(r, 'ar_open')} before={p ? f(p, 'ar_open') : null}
                      sub={text(T.dashOfVisitors, { pct: pct(f(r, 'ar_open'), visits) })} prevLabel={prevLabel} lang={lang} />
            <StatTile label={T.dashPlaced} value={f(r, 'ar_placed')} before={p ? f(p, 'ar_placed') : null}
                      sub={text(T.dashOfVisitors, { pct: pct(f(r, 'ar_placed'), visits) })} prevLabel={prevLabel} lang={lang} />
          </div>
        </Section>

        {/* ── Attention and orders ── */}
        <Section title={T.dashSecEngage}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label={T.dashTypicalVisit} display={secs(r?.time.median_s)}
                      value={Number(r?.time.median_s ?? 0)} before={p?.time.median_s != null ? Number(p.time.median_s) : null}
                      sub={r?.time.sessions
                        ? text(T.dashVisitSub, { avg: secs(r.time.avg_s), quick: pct(r.time.under_10s, r.time.sessions) })
                        : null}
                      note={r && r.time.sessions > 0 && r.time.measured < r.time.sessions ? T.dashTimeFloor : null}
                      prevLabel={prevLabel} lang={lang} />
            <StatTile label={T.dashTime3d} display={secs(r?.time_3d.median_s)}
                      value={Number(r?.time_3d.median_s ?? 0)} before={p?.time_3d.median_s != null ? Number(p.time_3d.median_s) : null}
                      sub={r?.time_3d.closes ? text(T.dashTime3dSub, { n: r.time_3d.closes }) : T.dashRecordingFrom}
                      prevLabel={prevLabel} lang={lang} />
            <StatTile label={T.dashAddedBasket} value={basketPeople} before={p ? p.basket.sessions : null}
                      sub={r ? text(T.dashBasketSub, { pct: pct(basketPeople, visits), n: r.basket.adds }) : null}
                      prevLabel={prevLabel} lang={lang} />
            <StatTile label={T.dashShowedWaiter} value={r?.basket.waiter ?? 0} before={p ? p.basket.waiter : null}
                      sub={basketPeople ? text(T.dashWaiterSub, { pct: pct(r?.basket.waiter ?? 0, basketPeople) }) : null}
                      prevLabel={prevLabel} lang={lang} />
          </div>
        </Section>

        <div className="card p-5 min-w-0">
          <TrendChart report={r} win={data?.win ?? null} T={T} locale={locale} />
        </div>

        <div className="grid gap-4 lg:grid-cols-5">
          <div className="card p-5 lg:col-span-3 min-w-0">
            <h2 className="text-sm font-semibold mb-4">{T.dashFunnel}</h2>
            <FunnelBars visits={visits} T={T} steps={[
              { label: T.dashVisitors, value: visits },
              { label: T.dashPastHero, value: f(r, 'hero_pass') },
              { label: T.dashOpened3d, value: f(r, 'item_open') },
              { label: T.dashReachedAr, value: f(r, 'ar_open') },
              { label: T.dashPlaced, value: f(r, 'ar_placed') },
              { label: T.dashAddedBasket, value: basketPeople },
            ]} />
            <p className="text-xs mt-4 pt-3" style={{ color: 'var(--dim)', borderTop: '1px solid var(--border)' }}>
              {T.dashSessionsNote}
            </p>
          </div>
          <div className="lg:col-span-2 grid gap-4">
            <div className="card p-5 flex flex-col">
              <h2 className="text-sm font-semibold mb-3">{T.dashLiftTitle}</h2>
              <LiftCard lift={r?.lift ?? null} T={T} />
            </div>
            <div className="card p-5">
              <h2 className="text-sm font-semibold mb-2">{T.dash3dToBasket}</h2>
              {r && r.basket.opened_pairs > 0 && r.basket.adds > 0 ? (
                <>
                  <div className="text-4xl font-bold tracking-tight" style={{ fontVariantNumeric: 'normal' }}>
                    {pct(r.basket.opened_then_added, r.basket.opened_pairs)}%
                  </div>
                  <p className="text-sm mt-1">{text(T.dash3dToBasketX, {
                    a: r.basket.opened_then_added, b: r.basket.opened_pairs })}</p>
                </>
              ) : (
                <p className="text-sm" style={{ color: 'var(--dim)' }}>{T.dash3dToBasketNone}</p>
              )}
            </div>
          </div>
        </div>

        <div className="card p-5 min-w-0">
          <HoursChart hours={r?.hours ?? []} T={T} />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Breakdown title={T.dashDevices} rows={r?.devices ?? []} T={T}
                     label={k => ({ ios: 'iPhone', android: 'Android', desktop: T.dashComputer } as Record<string, string>)[k] ?? k} />
          <Breakdown title={T.dashSources} rows={r?.sources ?? []} T={T}
                     label={k => ({
                       table: T.dashSrcTable, qr: T.dashSrcQr, poster: T.dashSrcPoster, direct: T.dashSrcDirect, instagram: 'Instagram',
                       facebook: 'Facebook', google: 'Google', tiktok: 'TikTok', web: T.dashSrcWeb,
                     } as Record<string, string>)[k] ?? k} />
          <Breakdown title={T.dashPhoneLang} rows={r?.langs ?? []} T={T}
                     label={k => langName(k, lang)} />
        </div>

        {f(r, 'embed_view') > 0 && (
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
                    <div className="text-2xl font-bold mt-0.5" style={{ fontVariantNumeric: 'normal' }}>{fmt(f(r, name), lang)}</div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* ── Every dish (0034): people who opened it in 3D, took it to AR, placed it ── */}
        <div className="card p-5 min-w-0">
          <h2 className="text-sm font-semibold mb-1">{T.dashPerDish}</h2>
          <p className="text-xs mb-4" style={{ color: 'var(--dim)' }}>{T.dashPerDishNote}</p>
          <DishTable dishes={data?.dishes ?? null} T={T} secs={secs} />
          <p className="text-xs mt-4" style={{ color: 'var(--dim)' }}>{T.dashWorthBuilding}</p>
        </div>

        <div className="grid gap-4">
          <div className="card p-5 min-w-0">
            <div className="flex items-baseline gap-2 mb-4">
              <h2 className="text-sm font-semibold">{T.dashByTable}</h2>
              <span className="text-xs ml-auto" style={{ color: 'var(--dim)' }}>{T.dashDiners}</span>
            </div>
            <RankBars rows={(r?.tables ?? []).map(t => ({
              key: t.t, value: Number(t.v), extra: Number(t.ar), muted: t.t === '—',
              label: t.t === '—' ? T.dashNoTableRow : text(T.shareTableN, { n: t.t }),
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

function formatSecs(s: number | null | undefined, T: Dict) {
  if (s == null || !Number.isFinite(Number(s))) return '—'
  const v = Math.round(Number(s))
  if (v < 60) return `${v}${T.dashSecShort}`
  const m = Math.floor(v / 60), r = v % 60
  return r ? `${m}${T.dashMinShort} ${r}${T.dashSecShort}` : `${m}${T.dashMinShort}`
}

function langName(code: string, ui: string) {
  if (code === '?') return code
  try {
    return new Intl.DisplayNames([ui === 'ka' ? 'ka' : 'en'], { type: 'language' }).of(code) || code
  } catch { return code }
}

function describeWindow(w: Win, p: Preset, T: Dict, locale: string) {
  if (p === 'today') return T.dashToday
  if (p === 'yesterday') return `${T.dashYesterday}, ${w.from.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })}`
  const d = (x: Date) => x.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  return `${d(w.from)} – ${d(new Date(w.to.getTime() - 1))}`
}

function Seg({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on}
            className="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap"
            style={{ background: on ? 'var(--card)' : 'transparent', color: on ? 'var(--text)' : 'var(--dim)',
                     boxShadow: on ? 'var(--shadow)' : 'none' }}>
      {children}
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="eyebrow mb-2">{title}</h2>
      {children}
    </section>
  )
}

/** Label, value, and the change against the window before. Arrow and sign carry the
 *  direction, so it never rests on green-versus-red alone. */
function StatTile({ label, value, display, sub, note, before, prevLabel, lang }: {
  label: string; value: number; display?: string; sub?: string | null; note?: string | null
  before: number | null; prevLabel: string; lang: string
}) {
  let delta: { text: string; up: boolean; flat: boolean } | null = null
  if (before !== null && before > 0) {
    const d = Math.round(((value - before) / before) * 100)
    delta = { text: `${d > 0 ? '+' : ''}${d}%`, up: d > 0, flat: d === 0 }
  }
  return (
    <div className="card p-4 flex flex-col">
      <div className="text-xs" style={{ color: 'var(--dim)' }}>{label}</div>
      <div className="text-3xl font-bold mt-1 tracking-tight" style={{ fontVariantNumeric: 'normal' }}>
        {display ?? fmt(value, lang)}
      </div>
      <div className="text-xs mt-1 min-h-[1rem]" style={{ color: 'var(--dim)' }}>{sub}</div>
      {note && <div className="text-[11px] mt-1" style={{ color: 'var(--dim)', opacity: 0.8 }}>{note}</div>}
      <div className="text-xs mt-auto pt-2 flex items-center gap-1.5 flex-wrap">
        {delta ? (
          <>
            <span className="font-semibold"
                  style={{ color: delta.flat ? 'var(--dim)' : delta.up ? 'var(--success)' : 'var(--danger)' }}>
              {delta.flat ? '→' : delta.up ? '▲' : '▼'} {delta.text}
            </span>
            <span style={{ color: 'var(--dim)' }}>{prevLabel}</span>
          </>
        ) : <span>{' '}</span>}
      </div>
    </div>
  )
}

/** Visitors and 3D opens over the window. Buckets come back as wall-clock times in the
 *  owner's zone; every empty bucket is drawn as zero - skipping them drew a quiet week as
 *  a busy one. One scale, crosshair tooltip, and a table view. */
function TrendChart({ report, win, T, locale }: { report: Report | null; win: Win | null; T: Dict; locale: string }) {
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
  }, [asTable])

  const unit = report?.unit ?? 'day'
  const series = useMemo(() => {
    if (!win || !report) return []
    const trunc = (d: Date) => {
      const x = new Date(d)
      if (unit === 'day') x.setHours(0, 0, 0, 0)
      else if (unit === 'hour') x.setMinutes(0, 0, 0)
      else x.setSeconds(0, 0)
      return x
    }
    // "2026-09-18T00:00:00", no zone: parsed as local time, which is the zone it was
    // bucketed in (the browser's, passed to `analytics()`).
    const byT = new Map(report.series.map(pt => [new Date(pt.b).getTime(), { v: Number(pt.v), o: Number(pt.o) }]))
    const out: { t: number; v: number; o: number }[] = []
    for (let d = trunc(win.from); d < win.to; ) {
      out.push({ t: d.getTime(), ...(byT.get(d.getTime()) ?? { v: 0, o: 0 }) })
      d = new Date(d)
      if (unit === 'day') d.setDate(d.getDate() + 1)
      else if (unit === 'hour') d.setHours(d.getHours() + 1)
      else d.setMinutes(d.getMinutes() + 1)
      if (out.length > 1500) break
    }
    return out
  }, [report, win, unit])

  const H = 200, padL = 36, padR = 12, padT = 12, padB = 26
  const peak = Math.max(1, ...series.map(pt => Math.max(pt.v, pt.o)))
  const niceMax = (() => {
    const pow = 10 ** Math.floor(Math.log10(peak)); const n = peak / pow
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow
  })()
  const ticks = [0, niceMax / 2, niceMax]
  const x = (i: number) => padL + (series.length <= 1 ? 0 : (i / (series.length - 1)) * (w - padL - padR))
  const y = (v: number) => padT + (1 - v / niceMax) * (H - padT - padB)
  const path = (k: 'v' | 'o') => series.map((pt, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(pt[k]).toFixed(1)}`).join('')
  const area = series.length ? `${path('v')}L${x(series.length - 1)},${y(0)}L${x(0)},${y(0)}Z` : ''
  const label = (t: number) => {
    const d = new Date(t)
    return unit === 'day'
      ? d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
      : d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  }
  const xTicks = series.length ? [0, Math.floor((series.length - 1) / 2), series.length - 1] : []
  const hp = hover !== null ? series[hover] : null

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * w
    const i = Math.round(((px - padL) / (w - padL - padR)) * (series.length - 1))
    setHover(Math.max(0, Math.min(series.length - 1, i)))
  }

  return (
    <div>
      <div className="flex items-center gap-4 flex-wrap mb-3">
        <h2 className="text-sm font-semibold mr-auto">{T.dashVisitsOverTime}</h2>
        <Key color="var(--viz-1)" label={T.dashVisitors} />
        <Key color="var(--viz-2)" label={T.dashOpens3d} />
        <button className="text-xs underline" style={{ color: 'var(--dim)' }} onClick={() => setAsTable(t => !t)}>
          {asTable ? T.dashShowChart : T.dashShowTable}
        </button>
      </div>
      {asTable ? (
        <div className="table-scroll max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs" style={{ color: 'var(--dim)' }}>
              <th className="text-left py-1.5">{T.dashTime}</th>
              <th className="text-right py-1.5">{T.dashVisitors}</th>
              <th className="text-right py-1.5">{T.dashOpens3d}</th>
            </tr></thead>
            <tbody>
              {[...series].reverse().map(pt => (
                <tr key={pt.t} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="py-1.5">{label(pt.t)}</td>
                  <td className="py-1.5 text-right">{pt.v}</td>
                  <td className="py-1.5 text-right">{pt.o}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        // `width: 100%`, not `width={w}`: a fixed width before the first measurement
        // pushed a phone layout past the screen edge.
        <div ref={box} className="relative w-full min-w-0">
          <svg width="100%" height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={T.dashVisitsOverTime}
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
              <text key={`${i}-${k}`} x={x(i)} y={H - 6} fontSize={11} fill="var(--dim)"
                    textAnchor={k === 0 ? 'start' : k === xTicks.length - 1 ? 'end' : 'middle'}>
                {label(series[i].t)}
              </text>
            ))}
            {series.length > 1 && (
              <>
                <path d={area} fill="var(--viz-1)" opacity={0.1} />
                <path d={path('v')} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                <path d={path('o')} fill="none" stroke="var(--viz-2)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
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
            <Tip left={Math.min(Math.max(0, (x(hover!) / w) * 100), 80)}>
              <div style={{ color: 'var(--dim)' }}>{label(hp.t)}</div>
              <TipRow color="var(--viz-1)" value={hp.v} label={T.dashVisitors} />
              <TipRow color="var(--viz-2)" value={hp.o} label={T.dashOpens3d} />
            </Tip>
          )}
        </div>
      )}
    </div>
  )
}

/** Visitors by hour of the day, on the owner's clock. The question behind it is staffing
 *  and timing: when do diners actually open the menu, and when would a promotion land. */
function HoursChart({ hours, T }: { hours: { h: number; v: number }[]; T: Dict }) {
  const [hover, setHover] = useState<number | null>(null)
  const by = new Map(hours.map(h => [Number(h.h), Number(h.v)]))
  const vals = Array.from({ length: 24 }, (_, h) => by.get(h) ?? 0)
  const peak = Math.max(1, ...vals)
  const top = vals.indexOf(Math.max(...vals))
  const any = vals.some(v => v > 0)
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-4 flex-wrap">
        <h2 className="text-sm font-semibold mr-auto">{T.dashBusiestHours}</h2>
        {any && <span className="text-xs" style={{ color: 'var(--dim)' }}>
          {text(T.dashPeakHour, { h: `${hh(top)}–${hh((top + 1) % 24)}` })}
        </span>}
      </div>
      <div className="relative">
        <div className="flex items-end gap-[2px] h-28" onPointerLeave={() => setHover(null)}>
          {vals.map((v, h) => (
            // The whole column is the hit target, not the painted bar - a 2 px sliver
            // for a quiet hour is unhittable otherwise.
            <div key={h} className="flex-1 h-full flex items-end justify-center cursor-default"
                 onPointerEnter={() => setHover(h)} tabIndex={0} onFocus={() => setHover(h)} onBlur={() => setHover(null)}
                 aria-label={`${hh(h)} · ${v} ${T.dashVisitors}`}>
              <div className="w-full rounded-t transition-all"
                   style={{ maxWidth: 24, height: `${v ? Math.max(4, (v / peak) * 100) : 2}%`,
                            background: v ? 'var(--viz-1)' : 'var(--card2)',
                            opacity: hover === null || hover === h ? 1 : 0.55 }} />
            </div>
          ))}
        </div>
        {hover !== null && (
          <Tip left={Math.min((hover / 24) * 100, 82)} top={-8}>
            <div style={{ color: 'var(--dim)' }}>{hh(hover)}–{hh((hover + 1) % 24)}</div>
            <TipRow color="var(--viz-1)" value={vals[hover]} label={T.dashVisitors} />
          </Tip>
        )}
      </div>
      <div className="flex justify-between text-[11px] mt-1.5" style={{ color: 'var(--dim)' }}>
        {[0, 6, 12, 18, 23].map(t => <span key={t}>{hh(t)}</span>)}
      </div>
    </div>
  )
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--dim)' }}>
      <span className="inline-block w-4 h-[2px] rounded" style={{ background: color }} />{label}
    </span>
  )
}

function Tip({ left, top = 0, children }: { left: number; top?: number; children: React.ReactNode }) {
  return (
    <div className="absolute pointer-events-none card px-3 py-2 text-xs shadow-2xl"
         style={{ left: `${left}%`, top, minWidth: 138, zIndex: 5 }}>
      {children}
    </div>
  )
}

function TipRow({ color, value, label }: { color: string; value: number; label: string }) {
  return (
    <div className="flex items-center gap-2 mt-1">
      <span className="inline-block w-3 h-[2px]" style={{ background: color }} />
      <b className="text-sm">{value}</b><span style={{ color: 'var(--dim)' }}>{label}</span>
    </div>
  )
}

function FunnelBars({ steps, visits, T }: { steps: { label: string; value: number }[]; visits: number; T: Dict }) {
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
              <span className="text-xs w-10 text-right" style={{ color: 'var(--dim)' }}>{i === 0 ? '' : `${Math.round(ofAll)}%`}</span>
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

function LiftCard({ lift, T }: { lift: Report['lift'] | null; T: Dict }) {
  const a = Number(lift?.with_3d ?? 0)
  const b = Number(lift?.without_3d ?? 0)
  const ready = !!lift && Number(lift.dishes_3d) > 0 && Number(lift.dishes_plain) > 0 && a > 0 && b > 0
  const x = ready ? a / b : 0
  const peak = Math.max(a, b, 0.0001)
  return (
    <div className="flex-1 flex flex-col">
      {ready && (
        <div className="text-4xl font-bold tracking-tight" style={{ fontVariantNumeric: 'normal' }}>
          {`${x >= 10 ? Math.round(x) : x.toFixed(1)}×`}
        </div>
      )}
      <p className={ready ? 'text-sm mt-1' : 'text-sm'} style={{ color: ready ? 'var(--text)' : 'var(--dim)' }}>
        {ready ? text(T.dashLiftX, { x: x.toFixed(1) }) : T.dashLiftNone}
      </p>
      <div className="grid gap-2 mt-4">
        {[['3D', a, 'var(--viz-2)'], [T.dashPhotoDish, b, 'var(--viz-1)']].map(([k, v, c]) => (
          <div key={k as string} className="flex items-center gap-2 text-xs">
            <span className="w-12 shrink-0 truncate" style={{ color: 'var(--dim)' }}>{k}</span>
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--card2)' }}>
              <div className="h-full rounded-full" style={{ width: `${((v as number) / peak) * 100}%`, background: c as string }} />
            </div>
            <span className="w-10 text-right font-semibold">{(v as number).toFixed(1)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Share of visitors per kind. Old visits have no device/source/language and show as
 *  "not recorded" rather than being guessed or hidden. */
function Breakdown({ title, rows, label, T }: { title: string; rows: KV[]; label: (k: string) => string; T: Dict }) {
  // Shares are of the visits that HAVE this detail. Dividing by every visit read
  // "iPhone 3%" when the one recorded visit was an iPhone and 38 older ones had no device.
  const known = rows.filter(r => r.k !== '?')
  const total = known.reduce((s, r) => s + Number(r.v), 0)
  const unknown = rows.find(r => r.k === '?')
  return (
    <div className="card p-5 min-w-0">
      <h2 className="text-sm font-semibold mb-4">{title}</h2>
      {known.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--dim)' }}>{T.dashRecordingFrom}</p>
      ) : (
        <div className="grid gap-3">
          {known.slice(0, 6).map(r => {
            const share = total ? (Number(r.v) / total) * 100 : 0
            return (
              <div key={r.k}>
                <div className="flex items-baseline gap-2 text-sm mb-1">
                  <span className="flex-1 truncate">{label(r.k)}</span>
                  <b>{Math.round(share)}%</b>
                  <span className="text-xs w-8 text-right" style={{ color: 'var(--dim)' }}>{r.v}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--card2)' }}>
                  <div className="h-full rounded-full" style={{ width: `${share}%`, background: 'var(--viz-1)' }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
      {unknown && known.length > 0 && (
        <p className="text-[11px] mt-3" style={{ color: 'var(--dim)' }}>{text(T.dashNotRecorded, { n: unknown.v })}</p>
      )}
    </div>
  )
}

/** Every visible dish, with the two percentages that say whether its 3D earns its keep:
 *  of everyone who opened the menu, how many opened THIS dish in 3D; and of those, how
 *  many took it on to AR. Dishes nobody opened are listed too - that is information. */
function DishTable({ dishes, T, secs }: { dishes: Dishes | null; T: Dict; secs: (s: number | null) => string }) {
  const [all, setAll] = useState(false)
  const [only3d, setOnly3d] = useState(false)
  if (!dishes || !dishes.items.length) return <RankBars rows={[]} empty={['—', '—', '—']} />
  const visitors = Number(dishes.visitors) || 0
  const list = dishes.items.filter(d => !only3d || d.has_3d)
  const shown = all ? list : list.slice(0, 12)
  const top = Math.max(1, ...list.map(d => Number(d.opens)))
  const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '')
  const anyScans = list.some(d => Number(d.scans) > 0)
  return (
    <div>
      <div className="flex gap-1.5 mb-3">
        {([[false, T.dashAllDishes], [true, T.dash3dDishes]] as [boolean, string][]).map(([v, label]) => (
          <button key={String(v)} onClick={() => setOnly3d(v)} className="text-xs px-3 py-1 rounded-full"
                  style={{ background: only3d === v ? 'var(--gold-dim)' : 'var(--card2)',
                           color: only3d === v ? 'var(--gold)' : 'var(--dim)',
                           border: `1px solid ${only3d === v ? 'var(--gold)' : 'var(--border)'}` }}>
            {label}
          </button>
        ))}
      </div>
      <div className="table-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs align-bottom" style={{ color: 'var(--dim)' }}>
              <th className="text-left py-1.5 font-normal">{T.dashDish}</th>
              <th className="text-right py-1.5 pl-3 font-normal">{T.dashOpened3d}<br /><span className="opacity-70">{T.dashOfVisitorsShort}</span></th>
              <th className="text-right py-1.5 pl-3 font-normal">{T.dashReachedAr}<br /><span className="opacity-70">{T.dashOfOpenersShort}</span></th>
              <th className="text-right py-1.5 pl-3 font-normal hidden sm:table-cell">{T.dashPlaced}</th>
              <th className="text-right py-1.5 pl-3 font-normal hidden md:table-cell">{T.dashLooked}</th>
              <th className="text-right py-1.5 pl-3 font-normal hidden md:table-cell">{T.dashAdds}</th>
              {anyScans && <th className="text-right py-1.5 pl-3 font-normal hidden sm:table-cell">{T.dashScans}</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map(d => (
              <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td className="py-2 pr-3 min-w-[9rem]">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate max-w-[15rem]">{d.name}</span>
                    {d.has_3d && <span className="pill pill-wait" style={{ padding: '0 6px' }}>3D</span>}
                  </div>
                  <div className="h-1 mt-1 rounded-full overflow-hidden" style={{ background: 'var(--card2)', maxWidth: 220 }}>
                    <div className="h-full rounded-full" style={{ width: `${(Number(d.opens) / top) * 100}%`, background: 'var(--viz-2)' }} />
                  </div>
                </td>
                <td className="py-2 pl-3 text-right whitespace-nowrap">
                  <b>{d.opens}</b> <span className="text-xs" style={{ color: 'var(--dim)' }}>{d.opens ? pct(d.opens, visitors) : ''}</span>
                </td>
                <td className="py-2 pl-3 text-right whitespace-nowrap">
                  <b>{d.has_3d || d.ar ? d.ar : ''}</b> <span className="text-xs" style={{ color: 'var(--dim)' }}>{d.ar ? pct(d.ar, d.opens) : ''}</span>
                </td>
                <td className="py-2 pl-3 text-right hidden sm:table-cell">{d.placed || ''}</td>
                <td className="py-2 pl-3 text-right hidden md:table-cell">{d.avg_3d_s != null ? secs(d.avg_3d_s) : ''}</td>
                <td className="py-2 pl-3 text-right hidden md:table-cell">{d.adds || ''}</td>
                {anyScans && <td className="py-2 pl-3 text-right hidden sm:table-cell">{d.scans || ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length > 12 && (
        <button className="text-xs underline mt-3" style={{ color: 'var(--dim)' }} onClick={() => setAll(a => !a)}>
          {all ? T.dashShowFewer : text(T.dashShowAll, { n: list.length })}
        </button>
      )}
    </div>
  )
}

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
            <span className="text-xs w-12 text-right" style={{ color: 'var(--dim)' }}>{r.extra > 0 ? `${r.extra} AR` : ''}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden ml-7" style={{ background: 'var(--card2)' }}>
            <div className="h-full rounded-full" style={{ width: `${(r.value / top) * 100}%`, background: 'var(--viz-1)' }} />
          </div>
        </div>
      ))}
    </div>
  )
}
