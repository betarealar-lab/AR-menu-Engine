'use client'
// The account. Who is signed in, their password, their language, and the way out.
//
// This did not exist. An owner could not change their own password, could not see which
// restaurants their account reaches, and could only sign out from a link at the bottom of
// a sidebar that is behind a hamburger on a phone. Every product has this screen because
// every person eventually needs it, usually in a hurry.
//
// Changing a password goes through Supabase as the signed-in user - we never see it, and
// there is still no table of them anywhere in this system.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { usePlan } from '@/lib/usePlan'
import { createClient } from '@/lib/supabase/client'
import { useLang } from '@/lib/useLang'

export default function AccountPage() {
  const plan = usePlan()
  const router = useRouter()
  const [T] = useLang()
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)

  const say = (text: string, bad = false) => {
    setMsg({ text, bad })
    setTimeout(() => setMsg(null), bad ? 6000 : 4000)
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    if (pw.length < 8) return say('Use at least 8 characters', true)
    if (pw !== again) return say('Those do not match', true)
    setBusy(true)
    // As the signed-in user. Supabase holds the credential; we hold a session.
    const { error } = await createClient().auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return say(error.message, true)
    setPw(''); setAgain('')
    say('Password changed')
  }

  async function signOut() {
    await createClient().auth.signOut()
    router.push('/login')
    router.refresh()
  }

  if (plan.loading) return <p style={{ color: 'var(--dim)' }}>Loading…</p>

  return (
    <div className="page-content max-w-2xl">
      <h1 className="page-title mb-5">{T.accountTitle}</h1>

      {msg && (
        <div className="card px-4 py-3 mb-4 text-sm"
             style={{ color: msg.bad ? 'var(--danger)' : 'var(--success)' }}>{msg.text}</div>
      )}

      <div className="grid gap-4">
        <div className="card p-5">
          <div className="eyebrow mb-1">{T.accountSignedInAs}</div>
          <div className="font-semibold">{plan.email || '—'}</div>
          <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>
            Changing the email address is a support job for now — it is the address every
            invite and reset link goes to.
          </p>
        </div>

        <form onSubmit={changePassword} className="card p-5">
          <div className="eyebrow mb-1">{T.passwordWord}</div>
          <p className="text-xs mb-3" style={{ color: 'var(--dim)' }}>
            We never see it and never store it. Use a password manager — this is the only
            thing standing in front of your menu.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="eyebrow block mb-1">{T.accountNewPassword}</span>
              <input type="password" value={pw} onChange={e => setPw(e.target.value)}
                     minLength={8} autoComplete="new-password" />
            </label>
            <label className="block">
              <span className="eyebrow block mb-1">{T.againLabel}</span>
              <input type="password" value={again} onChange={e => setAgain(e.target.value)}
                     minLength={8} autoComplete="new-password" />
            </label>
          </div>
          <button type="submit" className="btn btn-primary mt-3" disabled={busy || !pw}>
            {busy ? 'Saving…' : 'Change password'}
          </button>
        </form>

        <div className="card p-5">
          <div className="eyebrow mb-1">
            {plan.tenants.length === 1 ? 'Your restaurant' : 'Restaurants you can edit'}
          </div>
          <p className="text-xs mb-3" style={{ color: 'var(--dim)' }}>
            {T.accountTeamNote}
          </p>
          <div className="grid gap-1">
            {plan.tenants.map(t => (
              <Link key={t.id} href={`/home?tenant=${t.slug}`}
                    className="flex items-baseline gap-2 py-1.5 text-sm"
                    style={{ borderTop: '1px solid var(--border)' }}>
                <span className="font-semibold flex-1">{t.name}</span>
                <span className="text-xs" style={{ color: 'var(--dim)' }}>/{t.slug}</span>
                {t.slug === plan.restaurantSlug && <span className="pill pill-on">editing</span>}
              </Link>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <div className="eyebrow mb-3">{T.accountThisDevice}</div>
          <button className="btn btn-danger" onClick={signOut}>{T.signOut}</button>
          <p className="text-xs mt-3" style={{ color: 'var(--dim)' }}>
            {T.accountSignOutNote}
          </p>
        </div>
      </div>
    </div>
  )
}
