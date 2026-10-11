// BetaReal sets a restaurant login's password directly (super admins only).
//
// For logins whose email is not a real inbox (test accounts such as
// foodandmarket@test.com): the new password works at once, no email involved. The
// super admin sees it once, on screen, to pass on. It is NOT stored anywhere readable -
// Supabase keeps only its hash, as for every other password (MENU-PLATFORM §2.3).

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
  const { data: isSuper } = await supabase.rpc('is_super_admin')
  if (isSuper !== true) return bad('Only BetaReal can set a password', 403)

  const { userId, password } = await req.json()
  const pw = String(password || '')
  if (!userId) return bad('Which login?')
  if (pw.length < 6) return bad('At least 6 characters')
  if (pw.length > 72) return bad('At most 72 characters')

  const service = createAdminClient()
  if (!service) return bad('The server is missing its Supabase service key', 500)
  const { error } = await service.auth.admin.updateUserById(String(userId), {
    password: pw, email_confirm: true,
  })
  if (error) return bad(error.message, 500)
  return NextResponse.json({ ok: true })
}
