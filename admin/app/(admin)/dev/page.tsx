'use client'
// The developer console: every restaurant, searchable, with the numbers that say which
// one needs us. Ours, not an owner's.
//
// Temo, 2026-09-28: "for devs there should be open menu with tenants and good search
// functions and overall menu." The sidebar switcher answers "take me to X"; this answers
// "which of them should I be looking at" - so it filters on state (needs attention,
// Premium, inactive, unfinished setup), sorts on activity and 3D, and every row carries
// the four places a developer goes next.
//
// The data is one call (`admin_directory()`, 0030). Search and sort run in the browser
// on that, so typing never waits on the network. The security boundary is in that
// function: anyone who is not a super admin gets zero rows.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePlan } from '@/lib/usePlan'
import {
  loadDirectory, removeRestaurant, needsAttention, liveMenuUrl, type DirectoryRow,
} from '@/lib/data/dev'
import DevNav from '@/components/DevNav'

type Filter = 'all' | 'attention' | 'with3d' | 'premium' | 'selfserve' | 'inactive' | 'setup'
type Sort = 'name' | 'newest' | 'active' | 'dishes' | '3d' | 'attention'

const FILTERS: [Filter, string, (r: DirectoryRow) => boolean][] = [
  ['all', 'All', () => true],
  ['attention', 'Needs attention', needsAttention],
  ['with3d', 'Has 3D', r => r.dishes_3d > 0],
  ['premium', 'Premium', r => !r.studio],
  ['selfserve', 'Self-serve', r => r.studio],
  ['inactive', 'No visits 7d', r => r.sessions_7d === 0],
  ['setup', 'Setup unfinished', r => !r.setup_done],
]

const SORTS: [Sort, string][] = [
  ['name', 'Name'], ['active', 'Most visited (7d)'], ['newest', 'Newest'],
  ['dishes', 'Most dishes'], ['3d', 'Most 3D'], ['attention', 'Needs attention first'],
]

function ago(iso: string | null) {
  if (!iso) return 'never'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return `${Math.max(1, m)}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function sortRows(rows: DirectoryRow[], by: Sort) {
  const r = [...rows]
  const name = (a: DirectoryRow, b: DirectoryRow) => a.name.localeCompare(b.name)
  switch (by) {
    case 'newest': return r.sort((a, b) => b.created_utc.localeCompare(a.created_utc))
    case 'active': return r.sort((a, b) => b.sessions_7d - a.sessions_7d || name(a, b))
    case 'dishes': return r.sort((a, b) => b.dishes - a.dishes || name(a, b))
    case '3d': return r.sort((a, b) => b.dishes_3d - a.dishes_3d || name(a, b))
    case 'attention': return r.sort((a, b) =>
      Number(needsAttention(b)) - Number(needsAttention(a))
      || (b.requests_failed + b.models_draft) - (a.requests_failed + a.models_draft) || name(a, b))
    default: return r.sort(name)
  }
}

export default function DevConsole() {
  const plan = usePlan()
  const [rows, setRows] = useState<DirectoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('name')
  const search = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const removeLock = useRef(false)
  const [removing, setRemoving] = useState<DirectoryRow | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [removeError, setRemoveError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (removing) dialog.current?.showModal()
    else dialog.current?.close()
  }, [removing])

  async function confirmRemoval() {
    if (!removing || removeLock.current || confirmation !== removing.slug) return
    removeLock.current = true; setBusy(true); setRemoveError('')
    try {
      await removeRestaurant(removing, confirmation)
      setRows(current => current.filter(r => r.tenant_id !== removing.tenant_id))
      setNotice(`${removing.name} was removed. Stored photos and 3D files were kept.`)
      setRemoving(null)
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : 'Removal failed. Refresh before retrying.')
    } finally { removeLock.current = false; setBusy(false) }
  }

  useEffect(() => {
    if (plan.loading || plan.role !== 'super_admin') return
    let dead = false
    loadDirectory().then(({ rows, error }) => {
      if (dead) return
      setRows(rows); setError(error); setLoading(false)
    })
    return () => { dead = true }
  }, [plan.loading, plan.role])

  // "/" focuses search from anywhere on the page, the way every directory does it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) {
        e.preventDefault(); search.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const counts = useMemo(
    () => new Map(FILTERS.map(([id, , fn]) => [id, rows.filter(fn).length])), [rows])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const fn = FILTERS.find(f => f[0] === filter)![2]
    const hit = rows.filter(r => {
      if (!fn(r)) return false
      if (!q) return true
      const hay = `${r.name} ${r.slug} ${r.template_id || ''} ${r.tenant_id}`.toLowerCase()
      return q.split(/\s+/).every(w => hay.includes(w))
    })
    return sortRows(hit, sort)
  }, [rows, query, filter, sort])

  const totals = useMemo(() => rows.reduce((t, r) => ({
    dishes: t.dishes + r.dishes, d3: t.d3 + r.dishes_3d, visits: t.visits + r.sessions_7d,
    attention: t.attention + Number(needsAttention(r)),
  }), { dishes: 0, d3: 0, visits: 0, attention: 0 }), [rows])

  if (!plan.loading && plan.role !== 'super_admin') {
    return <div className="p-6 text-sm" style={{ color: 'var(--dim)' }}>This page is for BetaReal.</div>
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <DevNav />

      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <p className="eyebrow">Developer</p>
          <h1 className="text-2xl font-bold">Restaurants</h1>
        </div>
        <Link href="/tenants" className="btn btn-ghost btn-sm">+ New restaurant</Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          ['Restaurants', rows.length],
          ['Dishes', totals.dishes],
          ['In 3D', totals.d3],
          ['Visits, 7 days', totals.visits],
        ].map(([label, n]) => (
          <div key={label as string} className="card p-4">
            <div className="text-xs" style={{ color: 'var(--dim)' }}>{label}</div>
            <div className="text-2xl font-bold mt-1">{loading ? '–' : n}</div>
          </div>
        ))}
      </div>

      <div className="card p-3 mb-4 grid gap-3">
        <div className="flex flex-col md:flex-row gap-2">
          {/* Sized by wrapper divs, not classes on the controls: globals.css styles
              input/select outside any cascade layer, and unlayered CSS beats Tailwind's
              layered utilities - the first version drew the search box as a 30-pixel
              square, and an inline flex-basis made the select 15rem TALL on a phone. */}
          <div className="flex-1 min-w-0">
            <input ref={search} value={query} onChange={e => setQuery(e.target.value)}
                   placeholder="Search name, /slug, template or id   ( / )"
                   aria-label="Search restaurants" />
          </div>
          <div className="md:w-60 shrink-0">
            <select value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="Sort">
              {SORTS.map(([id, label]) => <option key={id} value={id}>Sort: {label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(([id, label]) => {
            const on = filter === id
            return (
              <button key={id} onClick={() => setFilter(id)}
                      className="text-xs px-3 py-1.5 rounded-full transition-colors"
                      style={{ background: on ? 'var(--gold-dim)' : 'var(--card2)',
                               color: on ? 'var(--gold)' : 'var(--dim)',
                               border: `1px solid ${on ? 'var(--gold)' : 'var(--border)'}` }}>
                {label} <span className="opacity-70">{counts.get(id) ?? 0}</span>
              </button>
            )
          })}
        </div>
      </div>

      {notice && <div role="status" className="card p-4 mb-4 text-sm">{notice}</div>}
      {error && <div role="alert" className="card p-4 mb-4 text-sm" style={{ color: 'var(--danger)' }}>{error}</div>}
      {loading && <div className="card p-6 text-sm" style={{ color: 'var(--dim)' }}>Loading restaurants…</div>}
      {!loading && shown.length === 0 && (
        <div className="card p-6 text-sm text-center" style={{ color: 'var(--dim)' }}>
          Nothing matches. <button className="underline" onClick={() => { setQuery(''); setFilter('all') }}>Clear</button>
        </div>
      )}

      <div className="grid gap-2">
        {shown.map(r => {
          const q = `?tenant=${encodeURIComponent(r.slug)}`
          const flag = needsAttention(r)
          return (
            <div key={r.tenant_id} className="card p-4">
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {flag && <span className="w-2 h-2 rounded-full" style={{ background: 'var(--gold)' }} />}
                    <Link href={`/home${q}`} className="font-semibold truncate hover:underline">{r.name}</Link>
                    <span className="text-xs" style={{ color: 'var(--dim)' }}>/{r.slug}</span>
                    <span className={`pill ${r.studio ? 'pill-mute' : 'pill-wait'}`}>{r.studio ? 'Self-serve' : 'Premium'}</span>
                    {r.template_id && <span className="pill pill-mute">{r.template_id}</span>}
                    {!r.setup_done && <span className="pill pill-wait">setup unfinished</span>}
                    {!r.embed_on && <span className="pill pill-off">embed off</span>}
                  </div>
                  <div className="text-xs mt-1.5 flex flex-wrap gap-x-4 gap-y-1" style={{ color: 'var(--dim)' }}>
                    <span>{r.dishes} dishes · {r.categories} categories</span>
                    <span>{r.dishes_3d} in 3D · {r.models} models</span>
                    {r.models_draft > 0 && <span style={{ color: 'var(--gold)' }}>{r.models_draft} to review</span>}
                    {r.requests_open > 0 && <span>{r.requests_open} in the engine</span>}
                    {r.requests_failed > 0 && <span style={{ color: 'var(--danger)' }}>{r.requests_failed} failed</span>}
                    <span>{r.sessions_7d} visits (7d) · last {ago(r.last_event_utc)}</span>
                    <span>{r.members} {r.members === 1 ? 'login' : 'logins'}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 shrink-0">
                  <Link href={`/menu${q}`} className="btn btn-ghost btn-sm">Menu</Link>
                  <Link href={`/models${q}`} className="btn btn-ghost btn-sm">3D</Link>
                  <Link href={`/theme${q}`} className="btn btn-ghost btn-sm">Theme</Link>
                  <Link href={`/dashboard${q}`} className="btn btn-ghost btn-sm">Stats</Link>
                  <button type="button" className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--danger)' }} aria-label={`Remove ${r.name} /${r.slug}`}
                    onClick={() => { setConfirmation(''); setRemoveError(''); setRemoving(r) }}>Remove</button>
                  <a href={liveMenuUrl(r.slug)} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">Live ↗</a>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <dialog ref={dialog} aria-labelledby="remove-title" aria-describedby="remove-description"
        className="card p-6 w-full max-w-lg backdrop:bg-black/70"
        style={{ color: 'var(--text)', background: 'var(--card)', margin: 'auto' }}
        onCancel={e => { if (busy) e.preventDefault(); else setRemoving(null) }}>
        <h2 id="remove-title" className="text-xl font-bold">Remove {removing?.name}?</h2>
        <p id="remove-description" className="text-sm my-4">
          Permanently deletes this restaurant, its menu, model records, history and access memberships.
          Its live menu and QR links will stop working. This cannot be undone here.
          Stored photos, 3D files and user accounts are not deleted.
        </p>
        <label htmlFor="remove-confirm" className="text-sm">Type <strong>{removing?.slug}</strong> to confirm</label>
        <input id="remove-confirm" autoFocus autoComplete="off" spellCheck={false}
          value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} />
        {removeError && <p role="alert" className="text-sm mt-3" style={{ color: 'var(--danger)' }}>{removeError}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setRemoving(null)}>Cancel</button>
          <button type="button" className="btn btn-ghost" style={{ color: 'var(--danger)' }}
            disabled={busy || !removing || confirmation !== removing.slug} onClick={confirmRemoval}>
            {busy ? 'Removing…' : 'Permanently remove'}
          </button>
        </div>
      </dialog>
    </div>
  )
}
