'use client'
// The frame every screen sits in.
//
// Rewritten for the look, not the logic: the nav, the restaurant picker, the footer and
// the two toggles do exactly what they did. What changed is that a row no longer says
// itself twice - the "icon" used to be the word "Menu" in 10px uppercase beside the word
// "Menu" - and that the two preference toggles stopped being full-width buttons competing
// with the navigation for attention.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { translations, type Lang } from '@/lib/i18n'
import { usePlan } from '@/lib/usePlan'
import TenantPicker from '@/components/TenantPicker'
import Icon, { type IconName } from '@/components/Icon'
import { adminIdentityLabel } from '@/lib/adminUx'

/** Light mode is a class on <html>, not a second palette written in JavaScript.
 *
 *  It used to be both: globals.css had an `html.light` block AND this file set the same
 *  ten variables inline on the root element. Inline wins, so the stylesheet's light theme
 *  was dead code and every colour had to be changed in two places to change at all. */
function applyThemeVars(isDark: boolean) {
  document.documentElement.classList.toggle('light', !isDark)
}

type Row = { href: string; match?: string; label: string; icon: IconName }

/** One row of navigation. Defined at module scope: inside the component it would be a
 *  new function identity on every render, and React would remount every item. */
function NavLink({ row, active, onClose }: {
row: Row; active: boolean; onClose: () => void
}) {
  return (
    <Link href={row.href} onClick={onClose} aria-current={active ? 'page' : undefined}
          className="relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
          style={{ background: active ? 'var(--gold-dim)' : 'transparent',
                   color: active ? 'var(--gold)' : 'var(--dim)',
                   fontWeight: active ? 600 : 500 }}
          onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'var(--card2)'; e.currentTarget.style.color = 'var(--text)' } }}
          onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--dim)' } }}>
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r"
              style={{ background: 'var(--gold)' }} />
      )}
      <Icon name={row.icon} />
      <span className="truncate">{row.label}</span>
    </Link>
  )
}


interface Props {
  open: boolean
  onClose: () => void
}

export default function Sidebar({ open, onClose }: Props) {
  const pathname = usePathname()
  const plan = usePlan()

  const [lang, setLang] = useState<Lang>('en')
  const [dark, setDark] = useState(true)

  useEffect(() => {
    const savedLang = localStorage.getItem('bl-admin-lang')
    const savedTheme = localStorage.getItem('bl-admin-theme')
    const resolvedLang = (savedLang === 'en' || savedLang === 'ka') ? savedLang : 'en'
    const resolvedDark = savedTheme !== 'light'
    queueMicrotask(() => {
      setLang(resolvedLang)
      setDark(resolvedDark)
      applyThemeVars(resolvedDark)
    })
  }, [])

  const T = translations[lang]
  const identityLabel = adminIdentityLabel(plan)

  const tenantQuery = plan.restaurantSlug ? `?tenant=${encodeURIComponent(plan.restaurantSlug)}` : ''
  const tenantHref = (href: string) => tenantQuery && href !== '/tenants' ? `${href}${tenantQuery}` : href

  // "View menu" opens THIS restaurant's real page - the one a diner gets. In development
  // that is the menu app; in production the wildcard subdomain, or a custom domain.
  const menuOrigin = (process.env.NEXT_PUBLIC_MENU_ORIGIN || '').replace(/\/$/, '')
  const viewMenuHref = plan.restaurantDomain
    ? `https://${plan.restaurantDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}/`
    : plan.restaurantSlug
      ? (menuOrigin ? `${menuOrigin}/${plan.restaurantSlug}` : `https://${plan.restaurantSlug}.betareal.ge/`)
      : (menuOrigin || 'https://betareal.ge')

  const NAV: Row[] = ([
    { href: tenantHref('/home'), match: '/home', label: 'Home', icon: 'home' },
    plan.canUseMenu ? { href: tenantHref('/menu'), match: '/menu', label: T.navMenu, icon: 'menu' } : null,
    // Not gated on canUploadModels: an owner does not upload models, they ask for one and
    // approve it, and this is where they see what they have.
    { href: tenantHref('/models'), match: '/models', label: '3D Studio', icon: 'cube' },
    plan.canUseTheme ? { href: tenantHref('/theme'), match: '/theme', label: T.navTheme, icon: 'palette' } : null,
    plan.canUseAnalytics ? { href: tenantHref('/dashboard'), match: '/dashboard', label: T.navAnalytics, icon: 'chart' } : null,
    { href: tenantHref('/share'), match: '/share', label: 'QR & share', icon: 'qr' },
  ].filter(Boolean) as Row[])

  // Ours, not an owner's. Kept in their own group so the two are never confused.
  const STAFF: Row[] = ([
    plan.canManageTenants ? { href: '/tenants', label: T.navTenants, icon: 'grid' } : null,
    plan.role === 'super_admin' ? { href: '/dev-analytics', label: T.navDeveloperAnalytics, icon: 'pulse' } : null,
    // History reads a change log that does not exist yet. Hidden rather than shown empty:
    // a screen that is always empty teaches people not to look at it.
    plan.role === 'super_admin' ? { href: tenantHref('/history'), match: '/history', label: T.navHistory, icon: 'history' } : null,
  ].filter(Boolean) as Row[])

  function broadcast(newLang: Lang, newDark: boolean) {
    window.dispatchEvent(new CustomEvent('bl-pref', { detail: { lang: newLang, dark: newDark } }))
  }
  function toggleLang() {
    const next: Lang = lang === 'en' ? 'ka' : 'en'
    setLang(next)
    localStorage.setItem('bl-admin-lang', next)
    broadcast(next, dark)
  }
  function toggleTheme() {
    const next = !dark
    setDark(next)
    localStorage.setItem('bl-admin-theme', next ? 'dark' : 'light')
    applyThemeVars(next)
    broadcast(lang, next)
  }
  return (
    <aside
      className={[
        'flex flex-col w-60 shrink-0 h-screen max-h-screen',
        'fixed inset-y-0 left-0 z-50 md:sticky md:top-0 md:z-auto',
        'transition-transform duration-300 ease-in-out',
        open ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
      ].join(' ')}
      style={{ background: 'var(--card)', borderRight: '1px solid var(--border)' }}
    >
      <div className="flex items-start justify-between px-4 pt-5 pb-3 shrink-0">
        <div className="min-w-0">
          <div className="font-bold text-[15px] leading-none tracking-tight" style={{ color: 'var(--gold)' }}>
            BetaReal
          </div>
          {identityLabel && (
            <div className="text-[11px] mt-1 truncate" style={{ color: 'var(--dim)' }}>{identityLabel}</div>
          )}
        </div>
        <button onClick={onClose} aria-label={T.closeSidebar}
                className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg text-xl leading-none"
                style={{ color: 'var(--dim)' }}>×</button>
      </div>

      {/* Which restaurant. Above the nav because it decides what every link below shows. */}
      <div className="px-3 pb-1 shrink-0">
        <TenantPicker plan={plan} />
      </div>

      <nav className="flex-1 min-h-0 px-3 py-3 overflow-y-auto">
        <div className="grid gap-0.5">
          {NAV.map(row => <NavLink key={row.href} row={row} onClose={onClose}
                                 active={pathname.startsWith(row.match ?? row.href.split('?')[0])} />)}
        </div>

        {STAFF.length > 0 && (
          <>
            <div className="eyebrow px-3 pt-5 pb-2">BetaReal</div>
            <div className="grid gap-0.5">
              {STAFF.map(row => <NavLink key={row.href} row={row} onClose={onClose}
                                 active={pathname.startsWith(row.match ?? row.href.split('?')[0])} />)}
            </div>
          </>
        )}
      </nav>

      <div className="px-3 pb-4 pt-3 shrink-0 grid gap-0.5" style={{ borderTop: '1px solid var(--border)' }}>
        <a href={viewMenuHref} target="_blank" rel="noreferrer"
           className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
           style={{ color: 'var(--dim)' }}
           onMouseEnter={e => { e.currentTarget.style.background = 'var(--card2)'; e.currentTarget.style.color = 'var(--text)' }}
           onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--dim)' }}>
          <Icon name="external" />
          <span>{T.viewMenu}</span>
        </a>

        <NavLink row={{ href: '/account', label: 'Account', icon: 'user' }}
                 onClose={onClose} active={pathname.startsWith('/account')} />

        {/* Preferences, not navigation. Small and quiet, so they stop competing with the
            links above for attention. */}
        <div className="flex gap-1 mt-2 px-1">
          <button onClick={toggleLang} title={T.switchLanguage}
                  className="w-9 h-8 rounded-lg text-[11px] font-bold transition-colors"
                  style={{ background: 'var(--card2)', color: 'var(--dim)', border: '1px solid var(--border)' }}>
            {lang === 'en' ? 'KA' : 'EN'}
          </button>
          <button onClick={toggleTheme} title={T.switchTheme}
                  className="w-9 h-8 rounded-lg flex items-center justify-center transition-colors"
                  style={{ background: 'var(--card2)', color: 'var(--dim)', border: '1px solid var(--border)' }}>
            <Icon name={dark ? 'sun' : 'moon'} size={15} />
          </button>
        </div>
      </div>
    </aside>
  )
}
