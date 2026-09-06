'use client'
// Signing up. Four fields and a code.
//
// Deliberately not more. Everything else a restaurant needs - its look, its dishes, its
// first 3D model - is asked for on the next screen, one thing at a time, once they are
// already in. A signup form that asks for hours and an address is a signup form people
// leave.

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import SampleDish from '@/components/SampleDish'

const COUNTRIES: [string, string][] = [
  ['GE', 'Georgia'], ['AM', 'Armenia'], ['AZ', 'Azerbaijan'], ['TR', 'Türkiye'],
  ['UA', 'Ukraine'], ['KZ', 'Kazakhstan'], ['AE', 'United Arab Emirates'],
  ['DE', 'Germany'], ['FR', 'France'], ['IT', 'Italy'], ['ES', 'Spain'], ['NL', 'Netherlands'],
  ['PL', 'Poland'], ['GB', 'United Kingdom'], ['US', 'United States'],
]

function StartForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [code, setCode] = useState(params.get('code') || '')
  const [codeOk, setCodeOk] = useState<boolean | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [country, setCountry] = useState('GE')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // The code is checked as it is typed, so a wrong one is known before four more fields
  // are filled in for nothing.
  useEffect(() => {
    const clean = code.trim().toUpperCase()
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(clean)) { setCodeOk(null); return }
    let alive = true
    createClient().rpc('invite_valid', { p_code: clean })
      .then(({ data }) => { if (alive) setCodeOk(!!data) })
    return () => { alive = false }
  }, [code])

  function formatCode(raw: string) {
    const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name, email, password, country }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error || 'Something went wrong'); setBusy(false); return }
    router.push(`/setup?tenant=${data.slug}`)
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10"
         style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-4xl grid gap-10 lg:grid-cols-[1fr_400px] items-center">
        {/* The ending, at the start. A real dish, built from four phone photos, turning -
            the thing they are signing up for, visible before a single field is filled. */}
        <div className="order-2 lg:order-1">
          <div className="eyebrow mb-2">BetaReal</div>
          <h1 className="text-3xl font-bold leading-tight mb-3" style={{ color: 'var(--text)' }}>
            Your dishes, in 3D,<br />on the menu diners scan.
          </h1>
          <p className="text-sm mb-6" style={{ color: 'var(--dim)' }}>
            Four phone photos become a model a diner can turn around and put on their
            table. A minute to sign up. Ten to have a menu with a QR code on it.
          </p>
          <SampleDish height={280} caption="Built from four phone photos — this is what you get" />
          <ul className="text-sm grid gap-1.5 mt-6" style={{ color: 'var(--dim)' }}>
            <li>· The first three models are free.</li>
            <li>· You approve every model before a diner sees it.</li>
            <li>· Live at Monday Greens and Corner at Tabidze, Tbilisi.</li>
          </ul>
        </div>

        <div className="order-1 lg:order-2">

        <form onSubmit={submit} className="card p-6 space-y-5">
          <div>
            <label className="eyebrow block mb-1">Invite code</label>
            <input value={code} onChange={e => setCode(formatCode(e.target.value))}
                   placeholder="XXXX-XXXX" autoCapitalize="characters" spellCheck={false}
                   className="font-mono tracking-widest"
                   style={{ borderColor: codeOk === false ? 'var(--danger)'
                                       : codeOk ? 'var(--success)' : undefined }} />
            {codeOk === false && (
              <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>
                That code is not valid, or has already been used.
              </p>
            )}
            {codeOk === null && (
              <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>
                We are letting restaurants in a few at a time. Ask us for one.
              </p>
            )}
          </div>

          <div>
            <label className="eyebrow block mb-1">Restaurant</label>
            <input value={name} onChange={e => setName(e.target.value)}
                   placeholder="Monday Greens" required />
          </div>

          <div>
            <label className="eyebrow block mb-1">Country</label>
            <select value={country} onChange={e => setCountry(e.target.value)}>
              {COUNTRIES.map(([c, label]) => <option key={c} value={c}>{label}</option>)}
            </select>
            <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>
              Sets the currency your prices are in. It cannot be changed later.
            </p>
          </div>

          <div>
            <label className="eyebrow block mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                   autoComplete="email" required />
          </div>

          <div>
            <label className="eyebrow block mb-1">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                   autoComplete="new-password" minLength={8} required />
            <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>At least 8 characters.</p>
          </div>

          {error && (
            <p className="text-sm rounded-lg px-3 py-2"
               style={{ color: 'var(--danger)', background: 'rgba(240,104,95,.1)' }}>{error}</p>
          )}

          <button type="submit" className="btn btn-primary w-full" disabled={busy || codeOk !== true}>
            {busy ? 'Creating…' : 'Create my menu'}
          </button>

          <p className="text-center text-xs" style={{ color: 'var(--dim)' }}>
            Already have an account? <a href="/login" className="underline">Sign in</a>
          </p>
        </form>
        </div>
      </div>
    </div>
  )
}

// /start is a public page and Next prerenders it. useSearchParams() opts the tree below it
// out of prerendering, and Next insists that boundary is explicit so the rest of the page
// still ships as static HTML.
export default function StartPage() {
  return <Suspense fallback={null}><StartForm /></Suspense>
}
