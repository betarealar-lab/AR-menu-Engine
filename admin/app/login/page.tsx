'use client'
// Signing in. The same frame as /start, so the two do not look like two products.

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useLang } from '@/lib/useLang'
import SampleDish from '@/components/SampleDish'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [T] = useLang()
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await createClient().auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false); return }
    router.push('/home')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10"
         style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-4xl grid gap-10 lg:grid-cols-[1fr_380px] items-center">
        <div className="order-2 lg:order-1 hidden lg:block">
          <div className="eyebrow mb-2">BetaReal</div>
          <h1 className="text-2xl font-bold leading-tight mb-6" style={{ color: 'var(--text)' }}>
            Your dishes, in 3D.
          </h1>
          <SampleDish height={260} />
        </div>

        <div className="order-1 lg:order-2">
          <div className="lg:hidden mb-6">
            <div className="eyebrow mb-1">BetaReal</div>
            <h1 className="text-xl font-bold">{T.loginTitle}</h1>
          </div>

          <form onSubmit={handleLogin} className="card p-6 space-y-4">
            <h2 className="hidden lg:block font-semibold text-lg mb-1">{T.loginTitle}</h2>

            <div>
              <label className="eyebrow block mb-1">{T.emailLabel}</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                     autoComplete="email" required autoFocus />
            </div>
            <div>
              <label className="eyebrow block mb-1">{T.passwordLabel}</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                     autoComplete="current-password" required />
            </div>

            {error && (
              <p className="text-sm rounded-lg px-3 py-2"
                 style={{ color: 'var(--danger)', background: 'rgba(240,104,95,.1)' }}>{error}</p>
            )}

            <button type="submit" disabled={loading} className="btn btn-primary w-full">
              {loading ? T.signingIn : T.signIn}
            </button>

            <div className="flex items-center justify-between text-xs pt-1">
              <a href="/reset-password" className="hover:underline" style={{ color: 'var(--dim)' }}>
                {T.forgotPassword}
              </a>
              <a href="/start" className="hover:underline" style={{ color: 'var(--dim)' }}>
                Have an invite code?
              </a>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
