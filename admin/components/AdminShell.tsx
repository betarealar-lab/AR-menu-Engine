'use client'
// The frame. Sidebar on a wide screen, tab bar on a narrow one.
//
// The sidebar was the ONLY navigation, and on a phone it lives behind a hamburger - so
// every move between screens was two taps and a slide-out, and there was no way back to
// Home without opening it. That is most of what made the panel feel like work.
//
// So: four tabs at the bottom on a phone, for the four things an owner does often, with
// the sidebar still one tap away for everything else. Which four is a frequency argument -
// Home carries what needs you (models waiting, what is building), the menu is edited
// weekly, 3D is the product, and everything rarer lives under More.
//
// The bar is `fixed` and the page reserves room for it, rather than the bar being sticky
// inside a scrolling column: an owner scrolled to the bottom of a long menu should still
// be able to leave.

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Sidebar from './Sidebar'
import Icon, { type IconName } from './Icon'
import { useLang } from '@/lib/useLang'
import { usePlan, PlanProvider } from '@/lib/usePlan'

export default function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    // Resolved once, here, rather than three round trips inside every screen on every
    // navigation. See lib/usePlan.ts.
    <PlanProvider>
      <Shell>{children}</Shell>
    </PlanProvider>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [T] = useLang()
  const plan = usePlan()
  const pathname = usePathname()

  const q = plan.restaurantSlug ? `?tenant=${encodeURIComponent(plan.restaurantSlug)}` : ''
  type Tab = { href: string; match: string; label: string; icon: IconName; badge?: number }
  const TABS: Tab[] = [
    { href: `/home${q}`, match: '/home', label: 'Home', icon: 'home' },
    { href: `/menu${q}`, match: '/menu', label: T.navMenu, icon: 'menu' },
    { href: `/models${q}`, match: '/models', label: '3D', icon: 'cube' },
    { href: `/dashboard${q}`, match: '/dashboard', label: T.navAnalytics, icon: 'chart' },
  ]

  return (
    <div className="flex min-h-screen md:h-screen md:overflow-hidden">
      {open && (
        <div className="fixed inset-0 z-40 md:hidden"
             style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
             onClick={() => setOpen(false)} />
      )}

      <Sidebar open={open} onClose={() => setOpen(false)} />

      <div className="flex flex-col flex-1 min-w-0 md:h-screen">
        {/* Phone header: everything else, the restaurant being edited, and its live menu.
            The name matters here because there is no sidebar on screen to tell you which
            restaurant you are changing. */}
        <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-2.5 shrink-0"
                style={{ background: 'var(--card)', borderBottom: '1px solid var(--border)' }}>
          <button onClick={() => setOpen(true)} aria-label={T.openMenu}
                  className="flex flex-col justify-center gap-[5px] w-7 h-7 shrink-0">
            <span className="block h-[2px] w-full rounded-full" style={{ background: 'var(--gold)' }} />
            <span className="block h-[2px] w-4 rounded-full" style={{ background: 'var(--gold)' }} />
            <span className="block h-[2px] w-full rounded-full" style={{ background: 'var(--gold)' }} />
          </button>
          <span className="font-semibold text-sm truncate flex-1">
            {plan.restaurantName || 'BetaReal'}
          </span>
        </header>

        <main className="flex-1 min-h-0 overflow-auto p-4 md:p-8 pb-24 md:pb-8 page-content"
              style={{ background: 'var(--bg)' }}>
          {children}
        </main>

        {/* The four things done often. Everything else is behind the hamburger, which is
            where "leave the detailed version one tap away" lands. */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 flex"
             style={{ background: 'var(--card)', borderTop: '1px solid var(--border)',
                      paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
             aria-label="Sections">
          {TABS.map(t => {
            const active = pathname.startsWith(t.match)
            return (
              <Link key={t.match} href={t.href}
                    aria-current={active ? 'page' : undefined}
                    className="flex-1 flex flex-col items-center gap-0.5 py-2 relative"
                    style={{ color: active ? 'var(--gold)' : 'var(--dim)' }}>
                <Icon name={t.icon} size={21} />
                <span className="text-[10px] font-semibold">{t.label}</span>
                {active && (
                  <span className="absolute top-0 inset-x-6 h-[2px] rounded-b"
                        style={{ background: 'var(--gold)' }} />
                )}
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
