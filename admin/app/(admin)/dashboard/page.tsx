'use client'
// Analytics.
//
// This screen was an <iframe> pointing at `restaurant-ar.pages.dev/admin.html` - the
// production analytics page, with the old numeric ids, on somebody else's deploy. It could
// never have shown a number about any restaurant in this system.
//
// What it shows now comes from `events` (0009). The three numbers at the top are the ones
// that decide what we build next, and they are the ones we have only ever had for one
// restaurant, read by hand: how many diners get past the hero, how many open a dish in 3D,
// how many reach AR. On the live menu those were about 74%, 13% and 5%.
//
// **Percentages are of SESSIONS, never of hits.** One diner opening four dishes is one
// person who opened 3D, not four, and a funnel counted in hits flatters itself at exactly
// the point where it should be honest.

import { useCallback, useEffect, useState } from 'react'
import { usePlan } from '@/lib/usePlan'
import { createClient } from '@/lib/supabase/client'

type Funnel = { name: string; sessions: number; hits: number }
type TopItem = { item_id: string; name: string; opens: number; ar: number }
type Day = { day: string; sessions: number; opens: number }

const RANGES = [7, 30, 90] as const

export default function DashboardPage() {
  const plan = usePlan()
  const [days, setDays] = useState<number>(30)
  const [funnel, setFunnel] = useState<Funnel[]>([])
  const [items, setItems] = useState<TopItem[]>([])
  const [daily, setDaily] = useState<Day[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (plan.loading || !plan.restaurantId) { setLoading(plan.loading); return }
    setLoading(true)
    const supabase = createClient()
    const [f, i, d] = await Promise.all([
      supabase.rpc('event_funnel', { p_tenant: plan.restaurantId, p_days: days }),
      supabase.rpc('event_top_items', { p_tenant: plan.restaurantId, p_days: days, p_limit: 15 }),
      supabase.rpc('event_daily', { p_tenant: plan.restaurantId, p_days: days }),
    ])
    setFunnel((f.data as Funnel[]) || [])
    setItems((i.data as TopItem[]) || [])
    setDaily((d.data as Day[]) || [])
    setLoading(false)
  }, [plan.loading, plan.restaurantId, days])

  useEffect(() => { void load() }, [load])

  const at = (name: string) => funnel.find(f => f.name === name)?.sessions ?? 0
  const visits = at('view')
  const pct = (n: number) => (visits ? Math.round((n / visits) * 100) : 0)

  const steps = [
    { label: 'Opened the menu', value: visits, of: visits,
      note: 'Sessions. One diner, one tab.' },
    { label: 'Got past the hero', value: at('hero_pass'), of: visits,
      note: 'Scrolled far enough to see a dish.' },
    { label: 'Opened a dish in 3D', value: at('item_open'), of: visits,
      note: 'The thing nobody else has.' },
    { label: 'Reached AR', value: at('ar_open'), of: visits,
      note: 'Tapped to put it on their table.' },
  ]

  if (!plan.loading && !plan.restaurantId) {
    return <div className="card p-6"><p style={{ color: 'var(--dim)' }}>
      Pick a restaurant first.</p></div>
  }

  return (
    <div className="page-content">
      <div className="flex items-center gap-3 flex-wrap mb-6">
        <h1 className="page-title mr-auto" style={{ color: 'var(--gold)' }}>Analytics</h1>
        <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {RANGES.map(r => (
            <button key={r} onClick={() => setDays(r)} className="px-3 py-2 text-xs font-semibold"
                    style={{ background: days === r ? 'var(--gold)' : 'transparent',
                             color: days === r ? 'var(--gold-ink)' : 'var(--dim)' }}>
              {r}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--dim)' }}>Loading…</p>
      ) : visits === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-semibold mb-1">No visits counted yet.</p>
          <p className="text-sm" style={{ color: 'var(--dim)' }}>
            Counting starts the moment a diner opens the menu. Nothing here is backfilled —
            these numbers begin the day the menu goes live.
          </p>
        </div>
      ) : (
        <div className="grid gap-5">
          <div className="card p-5">
            <div className="eyebrow mb-4">The funnel</div>
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
                           style={{ width: `${i === 0 ? 100 : share}%`,
                                    background: i === 0 ? 'var(--dim)' : 'var(--gold)' }} />
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>{s.note}</p>
                  </div>
                )
              })}
            </div>
            <p className="text-xs mt-4 pt-4" style={{ color: 'var(--dim)', borderTop: '1px solid var(--border)' }}>
              Every percentage is of sessions, not taps. One diner opening four dishes is
              one person who opened 3D, not four.
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="card p-5">
              <div className="eyebrow mb-4">Visits per day</div>
              <Sparkline days={daily} />
            </div>

            <div className="card p-5">
              <div className="eyebrow mb-4">Most opened dishes</div>
              {items.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--dim)' }}>
                  Nobody has opened a dish in 3D yet.
                </p>
              ) : (
                <div className="grid gap-2">
                  {items.map(it => (
                    <div key={it.item_id} className="flex items-baseline gap-3 text-sm">
                      <span className="flex-1 truncate">{it.name}</span>
                      <span className="font-semibold">{it.opens}</span>
                      {it.ar > 0 && (
                        <span className="pill pill-wait">{it.ar} AR</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs mt-4" style={{ color: 'var(--dim)' }}>
                This is the list that decides which dish is worth building next.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Bars, not a chart library.
 *
 *  Thirty numbers do not need 60 KB of JavaScript, and a chart library on an admin screen
 *  is a dependency that has to be kept current forever to draw a shape a div can make. */
function Sparkline({ days }: { days: Day[] }) {
  if (days.length === 0) {
    return <p className="text-sm" style={{ color: 'var(--dim)' }}>Nothing yet.</p>
  }
  const peak = Math.max(...days.map(d => d.sessions), 1)
  return (
    <div>
      <div className="flex items-end gap-[3px] h-28">
        {days.map(d => (
          <div key={d.day} className="flex-1 rounded-t transition-all relative group"
               style={{ height: `${Math.max(3, (d.sessions / peak) * 100)}%`,
                        background: 'var(--gold)', opacity: .85 }}
               title={`${d.day}: ${d.sessions} visits, ${d.opens} opened in 3D`} />
        ))}
      </div>
      <div className="flex justify-between mt-2 text-xs" style={{ color: 'var(--dim)' }}>
        <span>{days[0]?.day}</span>
        <span>peak {peak}</span>
        <span>{days[days.length - 1]?.day}</span>
      </div>
    </div>
  )
}
