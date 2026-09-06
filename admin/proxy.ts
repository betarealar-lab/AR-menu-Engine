import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isAuthPage = pathname === '/login'

  // Deny by default. This used to be a list of the five paths that existed when it was
  // written, so adding a screen quietly shipped it unauthenticated - /models did exactly
  // that, and it was only ever RLS stopping an anonymous visitor seeing anything. A
  // guard you have to remember to extend is a guard that is one commit from being wrong.
  //
  // Everything is protected except the handful of things that must work signed out, and
  // Next's own paths, which the matcher below already skips but which are named here so
  // the rule reads completely on its own.
  // /start is the front door and /api/signup is what it knocks on; both happen before
  // an account exists. /e never exists here (it is the menu app's) but is named so nobody
  // adds a beacon route to the admin and wonders why diners are being redirected.
  const PUBLIC = ['/login', '/reset-password', '/set-password', '/api/set-password',
                  '/auth', '/start', '/api/signup', '/e']
  const isProtected = !PUBLIC.some(
    open => pathname === open || pathname.startsWith(`${open}/`),
  )

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // If env vars are missing, send protected routes to login and let the rest through
  if (!supabaseUrl || !supabaseKey) {
    if (isProtected) return NextResponse.redirect(new URL('/login', request.url))
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  try {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    })

    const { data: { user } } = await supabase.auth.getUser()

    if (!user && isProtected) {
      // An API call gets a 401 it can read, not a login page it cannot. Redirecting a
      // fetch() to HTML is how a signed-out DELETE once came back as "200 OK".
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
      }
      return NextResponse.redirect(new URL('/login', request.url))
    }
    if (user && isAuthPage) return NextResponse.redirect(new URL('/home', request.url))
  } catch {
    // Supabase unreachable — send protected routes to login, never return 500
    if (isProtected) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
      }
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
