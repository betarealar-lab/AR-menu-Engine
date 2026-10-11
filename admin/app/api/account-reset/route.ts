// A password-reset link for one restaurant login, made by BetaReal (super admins only).
//
// We never see or choose anyone's password: Supabase keeps only a hash. What we can do is
// mint a one-time link to our own /set-password page, which a super admin copies and sends
// to the owner, who picks their new password there. The same link `members` makes for a
// new account, for an account that already exists.

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
  // Asked of the database, as this user, before the service key is touched.
  const { data: isSuper } = await supabase.rpc('is_super_admin')
  if (isSuper !== true) return bad('Only BetaReal can reset a login', 403)

  const { userId } = await req.json()
  if (!userId) return bad('Which login?')

  const service = createAdminClient()
  if (!service) return bad('The server is missing its Supabase service key', 500)
  const { data: found, error: findError } = await service.auth.admin.getUserById(String(userId))
  const email = found?.user?.email
  if (findError || !email) return bad('No such login', 404)

  const { data, error } = await service.auth.admin.generateLink({ type: 'recovery', email })
  const otp = error ? null : data?.properties?.email_otp
  if (!otp) return bad(error?.message || 'Could not make a link', 500)
  const origin = process.env.NEXT_PUBLIC_ADMIN_ORIGIN || new URL(req.url).origin
  return NextResponse.json({
    email,
    link: `${origin}/set-password?token=${otp}&email=${encodeURIComponent(email)}`,
  })
}
