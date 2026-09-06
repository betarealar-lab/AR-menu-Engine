'use client'
// Which restaurant am I working on.
//
// The platform had no picker: a tenant was chosen by editing `?tenant=` in the address bar,
// which is fine for the person who wrote it and no use to anybody else. With more than two
// restaurants it is the first thing you reach for and the last thing that existed.
//
// It writes to the SAME `?tenant=<slug>` the platform used, so every bookmark and every
// link in the sidebar keeps working, and `usePlan` needs no second way to be told.
//
// Shown only when there is a choice to make. One restaurant is a label, not a dropdown.

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import type { PlanAccess } from '@/lib/usePlan'

export default function TenantPicker({ plan }: { plan: PlanAccess }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const list = plan.tenants
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter(t => t.name.toLowerCase().includes(q) || t.slug.includes(q))
  }, [list, query])

  function pick(slug: string) {
    const next = new URLSearchParams(params.toString())
    next.set('tenant', slug)
    // Same page, different restaurant. Navigating home instead would throw away whatever
    // the person was in the middle of looking at, which is the opposite of what a picker
    // is for.
    router.push(`${pathname}?${next.toString()}`)
    setOpen(false)
    setQuery('')
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

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors"
        style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)' }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex-1 truncate font-semibold">
          {plan.restaurantName || 'Pick a restaurant'}
        </span>
        <span className="text-[10px] shrink-0" style={{ color: 'var(--dim)' }}>▼</span>
      </button>

      {open && (
        <>
          {/* Click-away. A dropdown you can only close by picking something is a trap. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 right-0 mt-1 z-50 rounded-xl overflow-hidden shadow-2xl"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
            role="listbox"
          >
            {list.length > 6 && (
              <div className="p-2" style={{ borderBottom: '1px solid var(--border)' }}>
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search"
                  className="text-sm"
                />
              </div>
            )}
            <div className="max-h-72 overflow-y-auto py-1">
              {shown.length === 0 && (
                <div className="px-3 py-3 text-xs" style={{ color: 'var(--dim)' }}>
                  Nothing matches that.
                </div>
              )}
              {shown.map(t => {
                const active = t.slug === plan.restaurantSlug
                return (
                  <button
                    key={t.id}
                    onClick={() => pick(t.slug)}
                    role="option"
                    aria-selected={active}
                    className="w-full text-left px-3 py-2 text-sm flex items-baseline gap-2 transition-colors"
                    style={{ background: active ? 'var(--gold-dim)' : 'transparent',
                             color: active ? 'var(--gold)' : 'var(--text)' }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--card2)' }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span className="flex-1 truncate">{t.name}</span>
                    <span className="text-[10px] shrink-0" style={{ color: 'var(--dim)' }}>
                      /{t.slug}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
