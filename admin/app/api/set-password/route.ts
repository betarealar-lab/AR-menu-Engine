// Turn a one-time token into an account with a password on it, and sign them in.
//
// Moved here from the Astro app when that admin was retired. Same design, same reasons:
//
// Deliberately NOT Supabase's own action_link. That link redirects to whatever Site URL
// the dashboard happens to hold - it shipped pointing at localhost:3000, somebody else's
// project - and it puts the session in a URL fragment, which means page JavaScript has to
// hold a live token to do anything with it.
//
// So the token comes to us and is exchanged HERE, server-side, for a session that goes
// straight into the cookie the rest of the admin reads. No dashboard setting decides
// whether it works, no token is readable by page script, and the person is signed in when
// it finishes rather than sent back to a form to retype what they just chose.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const MIN = 8

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const { token, email, password } = body || {}
  if (!token || !email) return bad('That link is not valid any more')
  if (typeof password !== 'string' || password.length < MIN) {
    return bad(`Use at least ${MIN} characters`)
  }

  // The one-time token, exchanged for a session. A used token is refused, which is the
  // property that makes it safe to hand somebody over any channel at all.
  const verify = await fetch(`${URL_}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'recovery', token, email }),
  })
  if (!verify.ok) return bad('That link has expired or has already been used. Ask for a new one.')
  const session = await verify.json()
  if (!session?.access_token) return bad('That link is not valid any more')

  // Set the password AS that user, with the session we just got. Called directly rather
  // than through supabase-js: its auth.updateUser reads the session the client holds,
  // and a client built here holds none, so it would fail with "Auth session missing".
  const set = await fetch(`${URL_}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: ANON, Authorization: `Bearer ${session.access_token}`,
               'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!set.ok) {
    const detail = await set.json().catch(() => ({}))
    return bad(detail.msg || detail.message || 'That password was not accepted')
  }

  // Into the cookie the rest of the admin reads. From here they are simply signed in.
  const cookieStore = await cookies()
  const supabase = createServerClient(URL_, ANON, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(list) {
        try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) }
        catch {}
      },
    },
  })
  const { error } = await supabase.auth.setSession({
    access_token: session.access_token, refresh_token: session.refresh_token,
  })
  if (error) return bad(error.message, 500)

  return NextResponse.json({ ok: true })
}
