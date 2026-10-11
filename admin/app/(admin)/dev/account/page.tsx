'use client'
// One restaurant's logins, for BetaReal (Nika, 2026-10-11). Opened from the "Account"
// button on a restaurant's row in /dev.
//
//   Logins     - who can sign in, when they last signed in, when they were last active
//   Password   - never shown: Supabase keeps only a hash. "Set password" sets a new one
//                at once (works for test emails that aren't real inboxes) and shows it
//                that one time; "Reset link" lets the owner choose their own.
//   Sign-ins   - each signed-in device, from auth.sessions
//   Activity   - every edit made to the restaurant (change_history, 0036)

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { usePlan } from '@/lib/usePlan'
import DevNav from '@/components/DevNav'
import { ago } from '@/lib/data/todos'
import {
  loadTenantAccount, makeResetLink, addLogin, setLoginPassword, liveMenuUrl, type TenantAccount,
} from '@/lib/data/dev'

const when = (iso: string | null) => iso
  ? `${new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} · ${ago(iso)}`
  : 'never'

/** "Chrome on Windows", "Safari on iPhone" - enough to tell two devices apart. */
function device(ua: string) {
  if (!ua) return 'Unknown device'
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const o = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'unknown system'
  return `${b} on ${o}`
}

const SOURCE: Record<string, string> = {
  item: 'Dish', category: 'Category', theme: 'Theme', settings: 'Settings',
  restaurant: 'Restaurant', model: '3D model', dish_page: 'Dish page',
}

function AccountView() {
  const plan = usePlan()
  const tenantId = useSearchParams().get('tenant') || ''
  const [acc, setAcc] = useState<TenantAccount | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [links, setLinks] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newLink, setNewLink] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwDraft, setPwDraft] = useState<Record<string, string>>({})
  const [pwSet, setPwSet] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    if (!tenantId) return
    const { data, error } = await loadTenantAccount(tenantId)
    setAcc(data); setError(error); setLoading(false)
  }, [tenantId])

  useEffect(() => {
    if (plan.loading || plan.role !== 'super_admin') return
    queueMicrotask(refresh)
  }, [plan.loading, plan.role, refresh])

  async function reset(userId: string) {
    setBusy(userId)
    const { link, error } = await makeResetLink(userId)
    setBusy('')
    if (error) { setError(error); return }
    setLinks(l => ({ ...l, [userId]: link }))
    navigator.clipboard?.writeText(link).catch(() => {})
  }

  async function setPw(userId: string) {
    const pw = (pwDraft[userId] || '').trim()
    setBusy('pw' + userId); setError('')
    const err = await setLoginPassword(userId, pw)
    setBusy('')
    if (err) { setError(err); return }
    setPwSet(m => ({ ...m, [userId]: pw }))
    setPwDraft(m => ({ ...m, [userId]: '' }))
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setBusy('new'); setError('')
    const { link, userId, error } = await addLogin(tenantId, newEmail)
    if (error) { setBusy(''); setError(error); return }
    // With a password typed in, it is set straight away and the link is not needed.
    if (newPw.trim() && userId) {
      const err = await setLoginPassword(userId, newPw.trim())
      if (err) { setBusy(''); setError(err); return }
      setPwSet(m => ({ ...m, [userId]: newPw.trim() }))
      setNewLink('')
    } else {
      setNewLink(link || '')
    }
    setBusy('')
    setNewEmail(''); setNewPw('')
    refresh()
  }

  if (!plan.loading && plan.role !== 'super_admin') {
    return <div className="p-6 text-sm" style={{ color: 'var(--dim)' }}>This page is for BetaReal.</div>
  }

  const t = acc?.tenant
  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <DevNav />
      <Link href="/dev" className="text-sm" style={{ color: 'var(--dim)' }}>← Restaurants</Link>
      <div className="flex flex-wrap items-end justify-between gap-3 mt-2 mb-5">
        <div>
          <p className="eyebrow">Account</p>
          <h1 className="text-2xl font-bold">{t?.name || (loading ? '…' : 'Restaurant')}</h1>
          {t && (
            <a href={liveMenuUrl(t.slug)} target="_blank" rel="noreferrer"
               className="text-sm underline" style={{ color: 'var(--dim)' }}>/{t.slug}</a>
          )}
        </div>
      </div>

      {error && <div className="card p-4 mb-4 text-sm" style={{ color: 'var(--danger)' }}>{error}</div>}
      {loading && <div className="card p-6 text-sm" style={{ color: 'var(--dim)' }}>Loading…</div>}

      {acc && (
        <>
          <p className="eyebrow mb-2">Logins · {acc.members.length}</p>
          <div className="grid gap-2 mb-3">
            {acc.members.length === 0 && (
              <div className="card p-5 text-sm" style={{ color: 'var(--dim)' }}>
                Nobody can sign in to this restaurant&apos;s admin yet. Add a login below.
              </div>
            )}
            {acc.members.map(m => (
              <div key={m.user_id} className="card p-4 grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <a href={`mailto:${m.email}`} className="font-semibold underline break-all">{m.email}</a>
                    <span className="text-[11px] px-2 py-0.5 rounded-full"
                          style={{ background: 'var(--card2)', color: 'var(--dim)' }}>
                      {m.is_super ? 'BetaReal' : m.role}
                    </span>
                    {!m.confirmed && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full"
                            style={{ background: 'var(--gold-dim)', color: 'var(--gold)' }}>
                        never set a password
                      </span>
                    )}
                  </div>
                  <button onClick={() => reset(m.user_id)} disabled={busy === m.user_id}
                          className="btn btn-ghost btn-sm">
                    {busy === m.user_id ? 'Making link…' : 'Password reset link'}
                  </button>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-1 text-sm">
                  <div><span style={{ color: 'var(--dim)' }}>Password: </span>
                    {pwSet[m.user_id]
                      ? <b style={{ color: 'var(--gold)' }}>{pwSet[m.user_id]}</b>
                      : 'hidden (only a hash is stored)'}
                  </div>
                  <div><span style={{ color: 'var(--dim)' }}>Last sign-in: </span>{when(m.last_sign_in_utc)}</div>
                  <div><span style={{ color: 'var(--dim)' }}>Last active: </span>{when(m.last_active_utc)}</div>
                  <div><span style={{ color: 'var(--dim)' }}>Edits: </span>{m.edits} · since {new Date(m.added_utc).toLocaleDateString('en-GB')}</div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-1 min-w-0">
                    <input value={pwDraft[m.user_id] || ''} minLength={6} maxLength={72}
                           onChange={e => setPwDraft(d => ({ ...d, [m.user_id]: e.target.value }))}
                           placeholder="New password (6+ characters)" aria-label={`New password for ${m.email}`} />
                  </div>
                  <button onClick={() => setPw(m.user_id)}
                          disabled={busy === 'pw' + m.user_id || (pwDraft[m.user_id] || '').trim().length < 6}
                          className="btn btn-primary btn-sm">
                    {busy === 'pw' + m.user_id ? 'Setting…' : 'Set password'}
                  </button>
                </div>
                {pwSet[m.user_id] && (
                  <p className="text-sm" style={{ color: 'var(--gold)' }}>
                    Done - {m.email} now signs in with <b>{pwSet[m.user_id]}</b>. Note it down:
                    it is shown only now and is not stored anywhere readable.
                  </p>
                )}
                {links[m.user_id] && (
                  <div className="text-sm grid gap-1">
                    <span style={{ color: 'var(--gold)' }}>
                      Copied. Send this to {m.email}; it opens a page where they choose a new password.
                      Their current password keeps working until they do.
                    </span>
                    <input readOnly value={links[m.user_id]} onFocus={e => e.currentTarget.select()}
                           aria-label="Reset link" />
                  </div>
                )}
              </div>
            ))}
          </div>

          <form onSubmit={add} className="card p-4 mb-6 grid gap-2">
            <div className="text-sm font-semibold">Add a login</div>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 min-w-0">
                <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
                       placeholder="owner@restaurant.ge" aria-label="Email" required />
              </div>
              <div className="sm:w-56 shrink-0">
                <input value={newPw} onChange={e => setNewPw(e.target.value)} maxLength={72}
                       placeholder="Password (optional)" aria-label="Password for the new login" />
              </div>
              <button type="submit" disabled={busy === 'new' || !newEmail.trim()} className="btn btn-primary btn-sm">
                {busy === 'new' ? 'Adding…' : 'Add as owner'}
              </button>
            </div>
            {newLink && (
              <div className="text-sm grid gap-1">
                <span style={{ color: 'var(--gold)' }}>Added. Send them this link to choose their password:</span>
                <input readOnly value={newLink} onFocus={e => e.currentTarget.select()} aria-label="Set-password link" />
              </div>
            )}
          </form>

          <p className="eyebrow mb-2">Sign-ins · {acc.sessions.length}</p>
          <div className="card mb-6 overflow-x-auto">
            {acc.sessions.length === 0
              ? <div className="p-5 text-sm" style={{ color: 'var(--dim)' }}>No signed-in devices.</div>
              : (
                <table className="w-full text-sm">
                  <thead><tr style={{ color: 'var(--dim)' }} className="text-left">
                    <th className="p-3 font-medium">Who</th><th className="p-3 font-medium">Device</th>
                    <th className="p-3 font-medium">Signed in</th><th className="p-3 font-medium">Last seen</th>
                  </tr></thead>
                  <tbody>
                    {acc.sessions.map((s, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="p-3 break-all">{s.email}</td>
                        <td className="p-3">{device(s.user_agent)}</td>
                        <td className="p-3 whitespace-nowrap">{ago(s.started_utc)}</td>
                        <td className="p-3 whitespace-nowrap">{ago(s.seen_utc)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>

          <p className="eyebrow mb-2">Activity · latest {acc.activity.length}</p>
          <div className="card overflow-x-auto">
            {acc.activity.length === 0
              ? <div className="p-5 text-sm" style={{ color: 'var(--dim)' }}>No changes yet.</div>
              : (
                <table className="w-full text-sm">
                  <thead><tr style={{ color: 'var(--dim)' }} className="text-left">
                    <th className="p-3 font-medium">When</th><th className="p-3 font-medium">Who</th>
                    <th className="p-3 font-medium">What</th><th className="p-3 font-medium">Change</th>
                  </tr></thead>
                  <tbody>
                    {acc.activity.map((a, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--border)' }} className="align-top">
                        <td className="p-3 whitespace-nowrap" title={new Date(a.at).toLocaleString('en-GB')}>{ago(a.at)}</td>
                        <td className="p-3 break-all">{a.email || <span style={{ color: 'var(--dim)' }}>system</span>}</td>
                        <td className="p-3">
                          <span style={{ color: 'var(--dim)' }}>{SOURCE[a.source] || a.source}</span>
                          {a.label ? <> · {a.label}</> : null}
                          <div className="text-xs" style={{ color: 'var(--dim)' }}>{a.field}</div>
                        </td>
                        <td className="p-3 break-words max-w-[320px]">
                          <span style={{ color: 'var(--dim)', textDecoration: a.old ? 'line-through' : undefined }}>
                            {a.old || '—'}
                          </span>
                          {' → '}{a.new || <span style={{ color: 'var(--dim)' }}>empty</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </>
      )}
    </div>
  )
}

export default function AccountPage() {
  return <Suspense fallback={null}><AccountView /></Suspense>
}
