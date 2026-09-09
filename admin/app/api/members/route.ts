// Inviting somebody into a restaurant.
//
// Two halves that need two different identities, which is the whole reason this is a
// server route and not a query from the browser:
//
//   Finding or creating the auth account needs the service key. It is the only thing that
//   can touch `auth.users`, and it is used HERE and only here.
//
//   Adding the membership is done as the SIGNED-IN USER, through `add_tenant_member`. The
//   function refuses unless the caller is already in that restaurant, so being an owner of
//   one restaurant is not a way to write yourself into another. The service key is never
//   used for that write, deliberately: it would bypass the check that makes the whole
//   thing safe.
//
// **No password is chosen, printed or stored by us.** The platform keeps client passwords
// in cleartext in a table its own debt file calls the worst thing in that codebase. What
// comes back from here is a one-time link where the person sets their own.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return bad('Not signed in', 401)

  const { tenantId, email, role } = await req.json()
  const clean = String(email || '').trim().toLowerCase()
  if (!tenantId) return bad('Which restaurant?')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return bad('That is not an email address')

  // **Before the service key touches anything.**
  //
  // `add_tenant_member` below is called as the signed-in user and refuses correctly, so
  // nobody was ever added to a restaurant they had no right to. But the refusal came
  // AFTER this route had already created a confirmed auth account with the service key,
  // and the account was left behind: any signed-in user could post a stranger's address
  // with any tenant id, collect a 403, and have made that account exist.
  //
  // That is not a takeover - no password is set, and the recovery link is generated only
  // on the success path - but it lets anybody pollute `auth.users` and, worse, take an
  // email address out of circulation: the real person can no longer sign up, because
  // `createUser` in the signup route fails with "already registered".
  //
  // The check asks the DATABASE the same question `add_tenant_member` will, as the same
  // user: `tenants_read` is `is_member_of(id)`, which is membership or super admin. One
  // authority, consulted twice, rather than a second rule written here that could drift
  // away from the first.
  const { data: allowed } = await supabase
    .from('tenants').select('id').eq('id', tenantId).maybeSingle()
  if (!allowed) return bad('You are not in that restaurant', 403)

  const service = createAdminClient()
  if (!service) return bad('The server is missing its Supabase service key', 500)

  // Find first. Creating an account that already exists is an error, and somebody being
  // added to their second restaurant is the normal case, not an edge one.
  const { data: list, error: listError } = await service.auth.admin.listUsers({
    page: 1, perPage: 1000,
  })
  if (listError) return bad(listError.message, 500)

  let account = list.users.find(u => u.email?.toLowerCase() === clean) ?? null
  let created = false
  if (!account) {
    const { data, error } = await service.auth.admin.createUser({
      email: clean, email_confirm: true,
    })
    if (error) return bad(error.message, 500)
    account = data.user
    created = true
  }
  if (!account) return bad('Could not create that account', 500)

  // As the signed-in user, on purpose. See the note at the top.
  const { error: rpcError } = await supabase.rpc('add_tenant_member', {
    p_tenant: tenantId,
    p_user: account.id,
    p_role: role === 'owner' ? 'owner' : 'staff',
  })
  if (rpcError) {
    return bad(rpcError.code === '42501'
      ? 'You are not in that restaurant'
      : rpcError.message, 403)
  }

  // A link only when the account is new. Sending a set-password link to somebody who
  // already has one is how a working login gets reset by accident.
  let link: string | null = null
  if (created) {
    const { data, error } = await service.auth.admin.generateLink({
      type: 'recovery', email: clean,
    })
    const otp = error ? null : data?.properties?.email_otp
    if (otp) {
      // Our own page, not Supabase's action_link. That one redirects to whatever Site URL
      // the dashboard holds - out of the box `http://localhost:3000`, which is somebody
      // else's project - and it is a setting nobody will remember exists. On THIS origin,
      // read off the request, so it is right in every environment without a setting.
      // Configured, because behind a proxy req.url is the internal address and Next
      // normalises the host either way - a link that says "localhost" is a link that
      // works on exactly one machine. Falls back to the request for a bare dev server.
      const origin = process.env.NEXT_PUBLIC_ADMIN_ORIGIN || new URL(req.url).origin
      link = `${origin}/set-password?token=${otp}&email=${encodeURIComponent(clean)}`
    }
  }

  return NextResponse.json({ userId: account.id, email: clean, created, link })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return bad('Not signed in', 401)

  const { searchParams } = new URL(req.url)
  const tenantId = searchParams.get('tenantId')
  const userId = searchParams.get('userId')
  if (!tenantId || !userId) return bad('Which member?')

  const { error } = await supabase.rpc('remove_tenant_member', {
    p_tenant: tenantId, p_user: userId,
  })
  if (error) {
    return bad(error.code === '23503'
      ? 'That is the only person with access to this restaurant'
      : error.message, 403)
  }
  return NextResponse.json({ ok: true })
}
