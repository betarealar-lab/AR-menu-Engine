'use client'
// Dish pages & QR codes. Ours, not an owner's.
//
// Temo, 2026-09-28: every dish gets its own page, "QRs auto generated, easily downloadable
// and constant", with an off switch and a reroll, "cause we plan to use that to make
// flyers and posters as products, so if some malicious people copy it we must be able to
// turn it off when they stop paying."
//
// Every dish already has a page (0033 creates one per dish, automatically). This screen is
// where a developer:
//   * copies the address or opens it,
//   * downloads the QR as print-resolution PNG (2048 px) or SVG, or prints them all,
//   * switches one dish's page off, or every page of the restaurant at once,
//   * rerolls an address: the old one - and every flyer printed with it - stops working.
//
// The switches are functions in the database that refuse anyone but a super admin; this
// page is not the lock, it is the handle.

import { useCallback, useEffect, useMemo, useState } from 'react'
import QR from 'qrcode'
import { usePlan } from '@/lib/usePlan'
import { downloadQrPng as downloadPng, downloadQrSvg as downloadSvg, safeName as safe } from '@/lib/qrDownload'
import { createClient } from '@/lib/supabase/client'
import {
  loadDishLinks, setDishLinkActive, rerollDishLink, setDishPagesActive, dishPageUrl,
  type DishLink,
} from '@/lib/data/dishLinks'

type Filter = 'all' | 'on' | 'off'
/** `dish_stats` (0034) for the last 30 days, per dish. People, not taps. */
type Stat = { id: string; opens: number; ar: number; placed: number; scans: number }
function Qr({ value, size }: { value: string; size: number }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let alive = true
    QR.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', width: size })
      .then(s => { if (alive) setSvg(s) }).catch(() => {})
    return () => { alive = false }
  }, [value, size])
  return <div className="bg-white rounded-md p-1 shrink-0" style={{ width: size + 8, height: size + 8 }}
              dangerouslySetInnerHTML={{ __html: svg }} />
}

/** "Last 30 days" for one dish: flyer scans, then how many people opened it in 3D (and
 *  what share of all visitors that is), then how many of those went on to AR. */
function DishNumbers({ s, visitors, has3d }: { s?: Stat; visitors: number; has3d: boolean }) {
  if (!s) return null
  const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '0%')
  const parts: React.ReactNode[] = [
    <span key="sc"><b>{s.scans}</b> flyer {s.scans === 1 ? 'scan' : 'scans'}</span>,
  ]
  if (has3d || s.opens) {
    parts.push(<span key="op"><b>{s.opens}</b> opened in 3D <span className="opacity-70">({pct(s.opens, visitors)} of visitors)</span></span>)
    parts.push(<span key="ar"><b>{s.ar}</b> in AR <span className="opacity-70">({pct(s.ar, s.opens)} of them)</span></span>)
  }
  return (
    <div className="text-[11px] mt-1 flex flex-wrap gap-x-3 gap-y-0.5" style={{ color: 'var(--dim)' }}>
      <span className="opacity-70">30 days:</span>{parts}
    </div>
  )
}

export default function DishPages() {
  const plan = usePlan()
  const [links, setLinks] = useState<DishLink[]>([])
  const [pagesActive, setPagesActive] = useState(true)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [confirmReroll, setConfirmReroll] = useState<string | null>(null)
  const [confirmAllOff, setConfirmAllOff] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [stats, setStats] = useState<{ visitors: number; by: Map<string, Stat> } | null>(null)

  const tenantId = plan.restaurantId
  const reload = useCallback(() => setVersion(v => v + 1), [])
  useEffect(() => {
    if (plan.loading || !tenantId || plan.role !== 'super_admin') return
    let dead = false
    loadDishLinks(tenantId).then(r => {
      if (dead) return
      setLinks(r.links); setPagesActive(r.pagesActive); setLoadedFor(tenantId)
      if (r.error) setMsg({ text: r.error, bad: true })
    })
    // The last 30 days per dish, beside each code: whether a flyer is being scanned is
    // the question that renews the flyer.
    const to = new Date(), from = new Date(to.getTime() - 30 * 86_400_000)
    createClient().rpc('dish_stats', { p_tenant: tenantId, p_from: from.toISOString(), p_to: to.toISOString() })
      .then(({ data }) => {
        if (dead || !data) return
        const d = data as { visitors: number; items: Stat[] }
        setStats({ visitors: Number(d.visitors) || 0, by: new Map(d.items.map(x => [x.id, x])) })
      })
    return () => { dead = true }
  }, [plan.loading, plan.role, tenantId, version])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return links.filter(l =>
      (filter === 'all' || (filter === 'on' && l.active) || (filter === 'off' && !l.active))
      && (!q || `${l.name} ${l.category} ${l.token}`.toLowerCase().includes(q)))
  }, [links, query, filter])

  if (!plan.loading && plan.role !== 'super_admin') {
    return <div className="p-6 text-sm" style={{ color: 'var(--dim)' }}>This page is for BetaReal.</div>
  }
  if (!plan.loading && !tenantId) {
    return <div className="p-6 text-sm" style={{ color: 'var(--dim)' }}>Pick a restaurant first.</div>
  }

  async function run(key: string, fn: () => Promise<string>, ok: string) {
    setBusy(key); setMsg(null)
    const err = await fn()
    setBusy(null)
    setMsg(err ? { text: err, bad: true } : { text: ok })
    reload()
  }

  async function copy(l: DishLink) {
    try { await navigator.clipboard.writeText(l.url); setCopied(l.itemId); setTimeout(() => setCopied(null), 1500) }
    catch { setMsg({ text: 'Could not copy - select the address and copy it by hand.', bad: true }) }
  }

  const live = links.filter(l => l.active && l.visible).length
  const loading = loadedFor !== tenantId
  const slug = plan.restaurantSlug || 'restaurant'

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="no-print">
        <p className="eyebrow">BetaReal</p>
        <div className="flex flex-wrap items-end justify-between gap-3 mb-1">
          <h1 className="text-2xl font-bold">Dish pages &amp; QR codes</h1>
          <button className="btn btn-sm btn-ghost" onClick={() => window.print()} disabled={!links.length}>
            Print all QR codes
          </button>
        </div>
        <p className="text-sm mb-5" style={{ color: 'var(--dim)' }}>
          Every 3D dish of {plan.restaurantName} has its own page: the same 3D and AR as the menu, one dish,
          opened straight into 3D. For flyers and posters. Addresses never change unless you reroll them.
          Photo-only dishes have no page; one appears the moment a dish gets an approved model.
        </p>

        {/* ── The restaurant-wide switch: the one to reach for when they stop paying ── */}
        <div className="card p-4 mb-4 flex flex-wrap items-center gap-3"
             style={{ borderColor: pagesActive ? undefined : 'var(--danger)' }}>
          <span className={`pill ${pagesActive ? 'pill-on' : 'pill-off'}`}>{pagesActive ? 'Dish pages on' : 'All dish pages OFF'}</span>
          <span className="text-sm flex-1 min-w-[12rem]" style={{ color: 'var(--dim)' }}>
            {pagesActive
              ? `${live} of ${links.length} pages are live. Switching off stops every printed code of this restaurant at once.`
              : 'Every page of this restaurant shows "no longer available". Nothing is deleted; switching on brings them all back.'}
          </span>
          {pagesActive ? (
            confirmAllOff ? (
              <span className="flex gap-2 items-center">
                <span className="text-xs" style={{ color: 'var(--danger)' }}>Every flyer stops working.</span>
                <button className="btn btn-sm btn-danger" disabled={busy === 'all'}
                        onClick={() => { setConfirmAllOff(false); void run('all', () => setDishPagesActive(tenantId!, false), 'All dish pages switched off.') }}>
                  Switch all off
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setConfirmAllOff(false)}>Cancel</button>
              </span>
            ) : (
              <button className="btn btn-sm btn-ghost" onClick={() => setConfirmAllOff(true)}>Switch all off…</button>
            )
          ) : (
            <button className="btn btn-sm btn-primary" disabled={busy === 'all'}
                    onClick={() => run('all', () => setDishPagesActive(tenantId!, true), 'Dish pages are live again.')}>
              Switch all on
            </button>
          )}
        </div>

        <div className="flex flex-col md:flex-row gap-2 mb-4">
          <div className="flex-1 min-w-0">
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search dishes, categories or codes" />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {([['all', 'All'], ['on', 'Live'], ['off', 'Off']] as [Filter, string][]).map(([id, label]) => (
              <button key={id} onClick={() => setFilter(id)} className="text-xs px-3 py-1.5 rounded-full"
                      style={{ background: filter === id ? 'var(--gold-dim)' : 'var(--card2)',
                               color: filter === id ? 'var(--gold)' : 'var(--dim)',
                               border: `1px solid ${filter === id ? 'var(--gold)' : 'var(--border)'}` }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {msg && <p className="text-sm mb-3" style={{ color: msg.bad ? 'var(--danger)' : 'var(--success)' }}>{msg.text}</p>}
        {loading && <div className="card p-6 text-sm" style={{ color: 'var(--dim)' }}>Loading…</div>}

        <div className="grid gap-2">
          {!loading && shown.map(l => {
            const name = `${slug}-${safe(l.name)}`
            const dead = !l.active || !pagesActive || !l.visible
            return (
              <div key={l.itemId} className="card p-3 md:p-4 flex flex-col md:flex-row gap-3 md:items-center"
                   style={{ opacity: dead ? 0.7 : 1 }}>
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Qr value={l.url} size={64} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold truncate">{l.name}</span>
                      {l.has3d && <span className="pill pill-wait">3D</span>}
                      {!l.visible && <span className="pill pill-mute">hidden on menu</span>}
                      <span className={`pill ${l.active ? 'pill-on' : 'pill-off'}`}>{l.active ? 'live' : 'off'}</span>
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--dim)' }}>{l.category}</div>
                    <button className="text-xs mt-1 font-mono truncate max-w-full text-left underline decoration-dotted"
                            style={{ color: 'var(--text)' }} onClick={() => copy(l)} title="Copy the address">
                      {copied === l.itemId ? 'Copied ✓' : l.url.replace(/^https?:\/\//, '')}
                    </button>
                    <DishNumbers s={stats?.by.get(l.itemId)} visitors={stats?.visitors ?? 0} has3d={l.has3d} />
                    {l.rotatedUtc && (
                      <div className="text-[11px]" style={{ color: 'var(--dim)' }}>
                        Rerolled {new Date(l.rotatedUtc).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 items-center">
                  <a className="btn btn-sm btn-ghost" href={l.url} target="_blank" rel="noreferrer">Open ↗</a>
                  <button className="btn btn-sm btn-ghost" onClick={() => downloadPng(l.url, name)}>PNG</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => downloadSvg(l.url, name)}>SVG</button>
                  <button className="btn btn-sm btn-ghost" disabled={busy === l.itemId}
                          onClick={() => run(l.itemId, () => setDishLinkActive(l.itemId, !l.active),
                            l.active ? `${l.name}: page switched off.` : `${l.name}: page is live.`)}>
                    {l.active ? 'Switch off' : 'Switch on'}
                  </button>
                  {confirmReroll === l.itemId ? (
                    <span className="flex gap-1.5 items-center w-full md:w-auto">
                      <span className="text-xs" style={{ color: 'var(--danger)' }}>Old code stops working.</span>
                      <button className="btn btn-sm btn-danger" disabled={busy === l.itemId}
                              onClick={() => { setConfirmReroll(null); void run(l.itemId, async () => (await rerollDishLink(l.itemId)).error,
                                `${l.name}: new address made. Download the new QR - the old one is dead.`) }}>
                        Reroll
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setConfirmReroll(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button className="btn btn-sm btn-ghost" onClick={() => setConfirmReroll(l.itemId)}>Reroll…</button>
                  )}
                </div>
              </div>
            )
          })}
          {!loading && !shown.length && (
            <div className="card p-6 text-sm text-center" style={{ color: 'var(--dim)' }}>No dishes match.</div>
          )}
        </div>
      </div>

      {/* ── What "Print all" prints: every live code, named, on a plain sheet ── */}
      <div className="print-only">
        <h1 style={{ fontSize: 18, marginBottom: 12 }}>{plan.restaurantName} · dish QR codes</h1>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {links.filter(l => l.active && l.visible).map(l => (
            <div key={l.itemId} style={{ textAlign: 'center', breakInside: 'avoid' }}>
              <Qr value={dishPageUrl(l.token)} size={140} />
              <div style={{ fontSize: 12, marginTop: 4 }}>{l.name}</div>
            </div>
          ))}
        </div>
      </div>
      <style>{`
        .print-only { display: none; }
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block; color: #000; }
          aside, nav, header { display: none !important; }
        }
      `}</style>
    </div>
  )
}
