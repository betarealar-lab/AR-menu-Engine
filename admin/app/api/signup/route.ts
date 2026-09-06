// Signing up. The one route where an account comes into existence on its own.
//
// Four steps, and the order is the design:
//
//   1. Is the code any good?  asked as nobody, via invite_valid() - it says yes or no
//   2. Make the account       the service key, on auth.users, and nothing else
//   3. Sign them in           a password grant, so from here on every write is THEIRS
//   4. Redeem the code        as the new user: burns the code and creates the restaurant
//                             in one transaction, through the same create_tenant() every
//                             restaurant goes through
//
// The service key touches the auth schema and stops. Everything in OUR schema is written
// as the signed-in user with RLS on, the same rule as every other route here. If step 4
// fails the account exists with no restaurant - which is recoverable by trying again with
// a valid code, and is much better than a restaurant that exists with no owner.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient as createAnon } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status })
}

function slugify(name: string) {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return bad('Bad request')

  const code = String(body.code || '').trim().toUpperCase()
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  const name = String(body.name || '').trim()
  const country = String(body.country || 'GE').trim().toUpperCase()
  let slug = slugify(String(body.slug || name))

  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return bad('That invite code is not valid')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad('That is not an email address')
  if (password.length < 8) return bad('Use at least 8 characters')
  if (!name) return bad('What is the restaurant called?')
  if (!/^[A-Z]{2}$/.test(country)) return bad('Pick a country')
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) slug = `r-${Date.now().toString(36)}`

  // 1. As nobody. A wrong code fails before anything exists.
  const anon = createAnon(URL_, ANON, { auth: { persistSession: false } })
  const { data: valid } = await anon.rpc('invite_valid', { p_code: code })
  if (!valid) return bad('That invite code is not valid, or has been used')

  // 2. The account. Email confirmation is skipped during private testing (Temo,
  //    2026-09-06); the invite code is the gate for now. Turn it back on before public.
  const service = createAdminClient()
  if (!service) return bad('The server is missing its Supabase service key', 500)
  const { data: made, error: makeErr } = await service.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (makeErr) {
    return bad(/already/i.test(makeErr.message)
      ? 'There is already an account with that email. Sign in instead.'
      : makeErr.message, 400)
  }

  // 3. Sign in, into the cookie the rest of the admin reads. From here every write is
  //    the new user's own.
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
  const { error: signErr } = await supabase.auth.signInWithPassword({ email, password })
  if (signErr) return bad(signErr.message, 500)

  // 4. The restaurant, and the code burned, in one transaction. The slug may collide
  //    with a restaurant this user cannot see, so one retry with a suffix rather than an
  //    error about a name they never typed.
  let tenantId: string | null = null
  for (const candidate of [slug, `${slug}-${Math.random().toString(36).slice(2, 6)}`]) {
    const { data, error } = await supabase.rpc('redeem_invite', {
      p_code: code, p_name: name, p_slug: candidate,
      p_template_id: 'monday_greens', p_country: country,
    })
    if (!error) { tenantId = data; slug = candidate; break }
    if (error.code !== '23505') {
      // The account exists and is signed in; they can try again with a working code.
      return bad(error.message, 400)
    }
  }
  if (!tenantId) return bad('Could not find a free address for that name', 500)

  return NextResponse.json({ ok: true, slug, tenantId, userId: made.user?.id })
}
