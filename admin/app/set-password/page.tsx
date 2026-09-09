'use client'
// Choosing a password, from a one-time link.
//
// The whole account-creation flow for somebody who was invited rather than signed up:
// make_admin.py and the Team screen both print a link to here. No password is ever
// chosen, printed or stored by us - the person picks their own and Supabase holds it.

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLang } from '@/lib/useLang'

function SetPasswordForm() {
  const [T] = useLang()
  const params = useSearchParams()
  const router = useRouter()
  const token = params.get('token') || ''
  const email = params.get('email') || ''
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== again) return setError('Those do not match')
    setError('')
    setBusy(true)
    const res = await fetch('/api/set-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, email, password }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error || 'Something went wrong'); setBusy(false); return }
    router.push('/home')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <div className="eyebrow mb-2">BetaReal</div>
          <h1 className="text-2xl font-bold">{T.setPwTitle}</h1>
          {email && <p className="text-sm mt-1" style={{ color: 'var(--dim)' }}>for {email}</p>}
        </div>

        {!token || !email ? (
          <div className="card p-5">
            <p className="text-sm" style={{ color: 'var(--danger)' }}>{T.setPwLinkBad}</p>
            <p className="text-xs mt-2" style={{ color: 'var(--dim)' }}>
              Ask for a new one and open it whole — some chat apps cut long links in half.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="card p-6 space-y-4">
            <div>
              <label className="eyebrow block mb-1">{T.passwordLabel2}</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                     minLength={8} required autoFocus autoComplete="new-password" />
            </div>
            <div>
              <label className="eyebrow block mb-1">{T.againLabel}</label>
              <input type="password" value={again} onChange={e => setAgain(e.target.value)}
                     minLength={8} required autoComplete="new-password" />
            </div>
            <p className="text-xs" style={{ color: 'var(--dim)' }}>
              At least 8 characters. Use a password manager — this is the only thing in
              front of every restaurant you can edit.
            </p>
            {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
            <button type="submit" className="btn btn-primary w-full" disabled={busy}>
              {busy ? 'Saving…' : 'Set it and sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default function SetPasswordPage() {
  return <Suspense fallback={null}><SetPasswordForm /></Suspense>
}
