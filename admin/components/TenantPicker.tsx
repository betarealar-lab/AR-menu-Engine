'use client'
// Which restaurant am I working on.
//
// It writes to the SAME `?tenant=<slug>` the platform used, so every bookmark and every
// link in the sidebar keeps working, and `usePlan` needs no second way to be told.
//
// **Was a dropdown, is a switcher (Temo, 2026-09-28: "dropdown list is shit").** A
// 260-pixel list that truncated names to "Corner by ele…" and could only be searched by
// the part of the name you already remembered. Now: the sidebar shows which restaurant
// you are in, and clicking it - or Ctrl/Cmd+K from anywhere - opens a full switcher that
// searches name, slug and template, is driven entirely from the keyboard, and, for one of
// us, shows each restaurant's numbers so the one that needs attention is findable
// without opening them one by one. The full directory lives at /dev.
//
// One restaurant is a label, not a switcher.

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import type { PlanAccess } from '@/lib/usePlan'
import { useLang } from '@/lib/useLang'
import { loadDirectory, needsAttention, type DirectoryRow } from '@/lib/data/dev'

type Entry = { id: string; slug: string; name: string; stats?: DirectoryRow }

/** Match on every word, anywhere in name, slug or template. "cor tab" finds Corner at
 *  Tabidze; "japan" finds the template as well as the restaurant. */
function matches(e: Entry, q: string) {
  if (!q) return true
  const hay = `${e.name} ${e.slug} ${e.stats?.template_id || ''}`.toLowerCase()
  return q.split(/\s+/).every(w => hay.includes(w))
}

export default function TenantPicker({ plan }: { plan: PlanAccess }) {
  const [T] = useLang()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [stats, setStats] = useState<Map<string, DirectoryRow>>(new Map())
  const listRef = useRef<HTMLDivElement>(null)

  const isSuper = plan.role === 'super_admin'
  const list = plan.tenants

  const entries: Entry[] = useMemo(
    () => list.map(t => ({ id: t.id, slug: t.slug, name: t.name, stats: stats.get(t.id) })),
    [list, stats])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter(e => matches(e, q))
  }, [entries, query])

  const close = useCallback(() => { setOpen(false); setQuery(''); setCursor(0) }, [])

  // Ctrl/Cmd+K from anywhere. Registered once there is more than one place to go.
  useEffect(() => {
    if (list.length < 2) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [list.length])

  // The numbers only for us, and only when the switcher is actually opened - the sidebar
  // renders on every page and has no business running a query on each one.
  useEffect(() => {
    if (!open || !isSuper || stats.size) return
    let dead = false
    loadDirectory().then(({ rows }) => {
      if (!dead) setStats(new Map(rows.map(r => [r.tenant_id, r])))
    })
    return () => { dead = true }
  }, [open, isSuper, stats.size])

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  function pick(slug: string) {
    const next = new URLSearchParams(params.toString())
    next.set('tenant', slug)
    // Same page, different restaurant - except the developer pages, which are not about
    // one restaurant, so switching from there goes to that restaurant's home.
    const target = pathname.startsWith('/dev') || pathname === '/tenants' || pathname === '/templates'
      ? '/home' : pathname
    router.push(`${target}?${next.toString()}`)
    close()
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(shown.length - 1, c + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[cursor]) pick(shown[cursor].slug) }
    else if (e.key === 'Escape') { e.preventDefault(); close() }
  }

  if (plan.loading) {
    return <div className="h-9 rounded-lg animate-pulse" style={{ background: 'var(--card2)' }} />
  }
  if (list.length === 0) return null
  if (list.length === 1) {
    return (
      <div className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
        {list[0].name}
      </div>
    )
  }

  const current = list.find(t => t.slug === plan.restaurantSlug)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors"
        style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)' }}
        aria-haspopup="dialog"
        title={`${T.switchRestaurant} (Ctrl+K)`}
      >
        <span className="flex-1 min-w-0">
          <span className="block truncate font-semibold">{plan.restaurantName || T.pickRestaurant}</span>
          {current && (
            <span className="block truncate text-[11px]" style={{ color: 'var(--dim)' }}>/{current.slug}</span>
          )}
        </span>
        <kbd className="hidden md:inline text-[10px] px-1.5 py-0.5 rounded shrink-0"
             style={{ border: '1px solid var(--border)', color: 'var(--dim)' }}>{'Ctrl K'}</kbd>
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-start justify-center p-3 md:pt-[10vh]"
             style={{ background: 'rgba(0,0,0,0.55)' }}
             onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
          <div role="dialog" aria-label={T.switchRestaurant}
               className="w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl flex flex-col"
               style={{ background: 'var(--card)', border: '1px solid var(--border)', maxHeight: '80vh' }}>
            <div className="flex items-center gap-2 p-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <input
                autoFocus
                value={query}
                onChange={e => { setQuery(e.target.value); setCursor(0) }}
                onKeyDown={onKey}
                placeholder={T.switchSearch}
                className="text-base flex-1"
                aria-controls="tenant-switch-list"
              />
              <span className="text-xs shrink-0" style={{ color: 'var(--dim)' }}>
                {shown.length}/{list.length}
              </span>
            </div>

            <div ref={listRef} id="tenant-switch-list" role="listbox" className="overflow-y-auto py-1">
              {shown.length === 0 && (
                <div className="px-4 py-6 text-sm text-center" style={{ color: 'var(--dim)' }}>
                  {T.nothingMatches}
                </div>
              )}
              {shown.map((e, i) => {
                const active = e.slug === plan.restaurantSlug
                const hot = i === cursor
                const s = e.stats
                return (
                  <button
                    key={e.id}
                    data-i={i}
                    role="option"
                    aria-selected={active}
                    onClick={() => pick(e.slug)}
                    onMouseMove={() => setCursor(i)}
                    className="w-full text-left px-4 py-2.5 flex items-center gap-3"
                    style={{ background: hot ? 'var(--card2)' : 'transparent' }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: s && needsAttention(s) ? 'var(--gold)' : 'transparent' }}
                          title={s && needsAttention(s) ? 'Needs attention' : undefined} />
                    <span className="flex-1 min-w-0">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate font-medium" style={{ color: active ? 'var(--gold)' : 'var(--text)' }}>
                          {e.name}
                        </span>
                        <span className="text-xs shrink-0" style={{ color: 'var(--dim)' }}>/{e.slug}</span>
                      </span>
                      {s && (
                        <span className="block text-[11px] mt-0.5 truncate" style={{ color: 'var(--dim)' }}>
                          {s.template_id || 'no template'} · {s.dishes} dishes · {s.dishes_3d} in 3D
                          {s.models_draft > 0 && ` · ${s.models_draft} to review`}
                          {s.requests_failed > 0 && ` · ${s.requests_failed} failed`}
                          {!s.studio && ' · Premium'}
                        </span>
                      )}
                    </span>
                    {s && (
                      <span className="text-[11px] shrink-0 text-right" style={{ color: 'var(--dim)' }}>
                        {s.sessions_7d} visits<br />7 days
                      </span>
                    )}
                    {active && <span className="text-[11px] shrink-0" style={{ color: 'var(--gold)' }}>{T.switchCurrent}</span>}
                  </button>
                )
              })}
            </div>

            <div className="flex items-center justify-between gap-2 px-4 py-2 text-[11px]"
                 style={{ borderTop: '1px solid var(--border)', color: 'var(--dim)' }}>
              <span>{T.switchKeys}</span>
              {isSuper && (
                <Link href="/dev" onClick={close} className="font-semibold" style={{ color: 'var(--gold)' }}>
                  All restaurants →
                </Link>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
