'use client'
// The developer console's own tabs. One row at the top of every /dev page, so the four
// things a developer does - find a restaurant, build for the library, push a file through
// the optimiser, see whether the engine is working - are one click apart and always
// visible, rather than buried under a restaurant's 3D Studio.

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS: [string, string][] = [
  ['/dev', 'Restaurants'],
  ['/dev/library', 'Library Studio'],
  ['/dev/upload', 'Upload model'],
  ['/dev/engines', 'Engines'],
  ['/dev-analytics', 'Queue & analytics'],
]

export default function DevNav() {
  const path = usePathname()
  return (
    <nav className="flex gap-1 mb-6 overflow-x-auto -mx-1 px-1 pb-1" aria-label="Developer">
      {TABS.map(([href, label]) => {
        const on = href === '/dev' ? path === '/dev' : path.startsWith(href)
        return (
          <Link key={href} href={href} aria-current={on ? 'page' : undefined}
                className="text-sm px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors"
                style={{ background: on ? 'var(--gold-dim)' : 'transparent',
                         color: on ? 'var(--gold)' : 'var(--dim)',
                         fontWeight: on ? 600 : 500 }}>
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
