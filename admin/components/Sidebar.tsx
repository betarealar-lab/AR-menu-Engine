'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { translations, type Lang } from '@/lib/i18n'
import { usePlan } from '@/lib/usePlan'
import TenantPicker from '@/components/TenantPicker'
import { adminIdentityLabel } from '@/lib/adminUx'


/** Light mode is a class on <html>, not a second palette written in JavaScript.
 *
 *  It used to be both: globals.css had an `html.light` block AND this file set the same
 *  ten variables inline on the root element. Inline wins, so the stylesheet's light theme
 *  was dead code and every colour had to be changed in two places to change at all - which
 *  is exactly how one of them ends up stale. */
function applyThemeVars(isDark: boolean) {
  document.documentElement.classList.toggle('light', !isDark)
}

interface Props {
  open: boolean
  onClose: () => void
}

export default function Sidebar({ open, onClose }: Props) {
  const pathname = usePathname()
  const router   = useRouter()
  const plan = usePlan()

  const [lang, setLang] = useState<Lang>('en')
  const [dark, setDark] = useState(true)

  useEffect(() => {
    const savedLang  = localStorage.getItem('bl-admin-lang')
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

  // "View Menu" must open THIS tenant's real live URL. Preference order:
  //   1. its custom_domain (e.g. monday-greens.betareal.ge), if set;
  //   2. otherwise <slug>.betareal.ge — the wildcard subdomain the customer app
  //      resolves via _tenantSlugFromHost;
  //   3. bare base URL only if there's no tenant at all.
  const customerBase = (process.env.NEXT_PUBLIC_CUSTOMER_APP_URL || 'https://restaurant-ar.pages.dev').replace(/\/$/, '')
  const viewMenuHref = plan.restaurantDomain
    ? `https://${plan.restaurantDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}/`
    : plan.restaurantSlug
      ? `https://${plan.restaurantSlug}.betareal.ge/`
      : customerBase

  const NAV = [
    plan.canManageTenants ? { href: '/tenants', label: T.navTenants, icon: '▦' } : null,
    !plan.canManageTenants && plan.canManageBranches ? { href: '/tenants', label: T.navBranches, icon: '▦' } : null,
    { href: tenantHref('/home'), match: '/home', label: 'Home', icon: 'Home' },
    plan.canUseMenu ? { href: tenantHref('/menu'), match: '/menu', label: T.navMenu, icon: 'Menu' } : null,
    plan.canUseAnalytics ? { href: tenantHref('/dashboard'), match: '/dashboard', label: T.navAnalytics, icon: 'Data' } : null,
    plan.canUseTheme ? { href: tenantHref('/theme'), match: '/theme', label: T.navTheme, icon: 'Theme' } : null,
    // The 3D library. Not gated on canUploadModels: an owner does not upload models, they
    // ask for one and then approve it, and the screen is where they see what they have.
    { href: tenantHref('/models'), match: '/models', label: '3D Studio', icon: '3D' },
    // History covers both theme and menu edits, so show it to anyone who can edit either.
    { href: tenantHref('/share'), match: '/share', label: 'QR & share', icon: 'QR' },
    // History reads a change log that does not exist yet. Hidden rather than shown empty:
    // a screen that is always empty teaches people not to look at it.
    plan.role === 'super_admin' ? { href: tenantHref('/history'), match: '/history', label: T.navHistory, icon: 'Undo' } : null,
  ].filter((item): item is { href: string; match?: string; label: string; icon: string } => Boolean(item))

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

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside
      className={[
        'flex flex-col w-56 shrink-0 h-screen max-h-screen',
        // Mobile: fixed overlay; desktop: sticky while the main pane scrolls
        'fixed inset-y-0 left-0 z-50 md:sticky md:top-0 md:z-auto',
        // Slide in/out on mobile; always visible on desktop
        'transition-transform duration-300 ease-in-out',
        open ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
      ].join(' ')}
      style={{ background: 'var(--card)', borderRight: '1px solid var(--border)' }}
    >
      {/* Brand + mobile close */}
      <div
        className="flex items-center justify-between px-5 py-5 border-b shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <div>
          <div className="font-bold text-base leading-tight" style={{ color: 'var(--gold)' }}>
            {T.brandTitle}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--dim)' }}>{T.brandSub}</div>
          {identityLabel && (
            <div className="text-xs mt-1 font-medium" style={{ color: 'var(--text)' }}>
              {identityLabel}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg text-xl leading-none"
          style={{ color: 'var(--dim)' }}
          aria-label={T.closeSidebar}
        >
          ×
        </button>
      </div>

      {/* Which restaurant. Above the nav because it decides what every link below shows. */}
      <div className="px-3 pt-3 shrink-0">
        <TenantPicker plan={plan} />
      </div>

      {/* Nav links */}
      <nav className="flex-1 min-h-0 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV.map(({ href, match, label, icon }) => {
          const active = pathname.startsWith(match ?? href.split('?')[0])
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150"
              style={{
                background: active ? 'var(--gold-dim, rgba(242,181,53,0.12))' : 'transparent',
                color:      active ? 'var(--gold)' : 'var(--dim)',
                fontWeight: active ? '600' : '400',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--card2)' }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
            >
              <span className="text-[10px] uppercase tracking-wide w-11 shrink-0" style={{ color: active ? 'var(--gold)' : 'var(--dim)' }}>{icon}</span>
              <span>{label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Language & theme toggles */}
      <div className="px-3 pb-2 flex gap-2 shrink-0">
        <button
          onClick={toggleLang}
          className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors duration-150"
          style={{ background: 'var(--card2)', color: 'var(--gold)', border: '1px solid var(--border)' }}
          title={T.switchLanguage}
        >
          {lang === 'en' ? 'KA' : 'EN'}
        </button>
        <button
          onClick={toggleTheme}
          className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors duration-150"
          style={{ background: 'var(--card2)', color: 'var(--gold)', border: '1px solid var(--border)' }}
          title={T.switchTheme}
        >
          {dark ? T.themeLight : T.themeDark}
        </button>
      </div>

      {/* Footer links */}
      <div className="px-3 pb-4 shrink-0">
        <a
          href={viewMenuHref}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm mb-1 transition-colors duration-150"
          style={{ color: 'var(--dim)' }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--card2)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <span className="text-[10px] uppercase tracking-wide w-11 shrink-0">{T.sidebarSiteLabel}</span> {T.viewMenu}
        </a>
        <button
          onClick={signOut}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm w-full text-left transition-all duration-150"
          style={{ color: 'var(--dim)' }}
          onMouseEnter={e => {
            e.currentTarget.style.color = 'var(--danger)'
            e.currentTarget.style.background = 'rgba(224,82,82,0.08)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = 'var(--dim)'
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <span className="text-[10px] uppercase tracking-wide w-11 shrink-0">{T.sidebarExitLabel}</span> {T.signOut}
        </button>
      </div>
    </aside>
  )
}
