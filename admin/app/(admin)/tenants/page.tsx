'use client'
// Restaurants: the list, making a new one, and who can get into each.
//
// A NEW screen rather than a port, and that is a deliberate exception to how the rest of
// this app was adopted. The platform's tenants page is 1,215 lines about brands, branches,
// plan tiers, admin links and a table of client passwords in cleartext. We have no brands,
// no branches, no plans (DECISIONS §9.3) and the password table is the one piece of that
// codebase's debt that must not come across. Porting it would mean deleting most of it and
// keeping the shape of things we decided not to build.
//
// What it does instead is the three things that are actually true here: list what you can
// reach, create one, and let somebody else in.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePlan } from '@/lib/usePlan'
import { createClient } from '@/lib/supabase/client'

type Row = {
  id: string
  slug: string
  name: string
  template_id: string | null
  items: number
  models: number
}

type Member = { user_id: string; role: string; email: string }

export default function TenantsPage() {
  const plan = usePlan()
  const [rows, setRows] = useState<Row[]>([])
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', slug: '', template_id: 'monday_greens' })
  const [slugTouched, setSlugTouched] = useState(false)
  const [openMembers, setOpenMembers] = useState<string | null>(null)

  const say = (text: string, bad = false) => {
    setMsg({ text, bad })
    setTimeout(() => setMsg(null), 6000)
  }

  const load = useCallback(async () => {
    if (plan.loading) return
    setLoading(true)
    const supabase = createClient()
    // Unfiltered: RLS decides what comes back, so a super admin sees everything and an
    // owner sees theirs, with no branch here that could disagree with the policy.
    const [{ data: tenants }, { data: tpl }] = await Promise.all([
      supabase.from('tenants').select('id, slug, name, template_id').order('name'),
      supabase.from('templates').select('id, name').eq('listed', true).order('name'),
    ])

    // Counts in one query each rather than one per restaurant: twenty restaurants would
    // otherwise be forty round trips to draw a list.
    const [{ data: items }, { data: models }] = await Promise.all([
      supabase.from('items').select('tenant_id'),
      supabase.from('models').select('tenant_id'),
    ])
    const tally = (list: { tenant_id: string }[] | null) => {
      const out = new Map<string, number>()
      for (const r of list || []) out.set(r.tenant_id, (out.get(r.tenant_id) || 0) + 1)
      return out
    }
    const itemCount = tally(items)
    const modelCount = tally(models)

    setRows((tenants || []).map(t => ({
      ...t,
      items: itemCount.get(t.id) || 0,
      models: modelCount.get(t.id) || 0,
    })))
    setTemplates(tpl || [])
    setLoading(false)
  }, [plan.loading])

  useEffect(() => { void load() }, [load])

  async function create() {
    const name = form.name.trim()
    const slug = form.slug.trim().toLowerCase()
    if (!name) return say('The restaurant needs a name', true)
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) {
      return say('The address can only use lowercase letters, numbers and hyphens', true)
    }
    setCreating(true)
    // Through the function, not an insert. `authenticated` deliberately has no INSERT on
    // tenants (0002): a restaurant and its first membership have to be created together or
    // neither, and the alternative is reaching for the service key in a request handler.
    const { error } = await createClient().rpc('create_tenant', {
      p_name: name, p_slug: slug, p_template_id: form.template_id,
    })
    setCreating(false)
    if (error) {
      return say(error.code === '23505'
        ? `Something already lives at /${slug}`
        : error.message, true)
    }
    setForm({ name: '', slug: '', template_id: 'monday_greens' })
    setSlugTouched(false)
    say(`${name} created`)
    void load()
  }

  return (
    <div className="page-content">
      <div className="flex items-center gap-3 flex-wrap mb-6">
        <h1 className="page-title mr-auto" style={{ color: 'var(--gold)' }}>Restaurants</h1>
        <span className="text-xs" style={{ color: 'var(--dim)' }}>
          {rows.length} you can reach
        </span>
      </div>

      {msg && (
        <div className="card px-4 py-3 mb-5 text-sm"
             style={{ color: msg.bad ? 'var(--danger)' : 'var(--success)' }}>
          {msg.text}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px] items-start">
        <div className="card overflow-hidden">
          {loading ? (
            <p className="p-5 text-sm" style={{ color: 'var(--dim)' }}>Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-8 text-sm text-center" style={{ color: 'var(--dim)' }}>
              Nothing yet. Create the first one.
            </p>
          ) : rows.map((r, i) => (
            <div key={r.id} style={{ borderTop: i ? '1px solid var(--border)' : undefined }}>
              <div className="flex items-center gap-3 px-5 py-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{r.name}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--dim)' }}>
                    /{r.slug} · {r.items} dishes · {r.models} models
                    {r.template_id ? ` · ${r.template_id.replace(/_/g, ' ')}` : ''}
                  </div>
                </div>
                <Link href={`/menu?tenant=${r.slug}`} className="btn btn-sm">Menu</Link>
                <Link href={`/theme?tenant=${r.slug}`} className="btn btn-sm">Look</Link>
                <button className="btn btn-sm btn-ghost"
                        onClick={() => setOpenMembers(openMembers === r.id ? null : r.id)}>
                  {openMembers === r.id ? 'Close' : 'Access'}
                </button>
              </div>
              {openMembers === r.id && <Members tenantId={r.id} onSay={say} />}
            </div>
          ))}
        </div>

        <div className="card p-5">
          <h2 className="font-semibold mb-1">New restaurant</h2>
          <p className="text-xs mb-4" style={{ color: 'var(--dim)' }}>
            Everything else has a sensible default. Two fields is the whole thing.
          </p>

          <label className="eyebrow block mb-1">Name</label>
          <input value={form.name} placeholder="Monday Greens" className="mb-4"
                 onChange={e => {
                   const name = e.target.value
                   setForm(f => ({
                     ...f,
                     name,
                     // Suggested, then left alone the moment it is touched. A field that
                     // keeps rewriting itself under somebody's cursor is worse than empty.
                     slug: slugTouched ? f.slug : name.toLowerCase().trim()
                       .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63),
                   }))
                 }} />

          <label className="eyebrow block mb-1">Address</label>
          <input value={form.slug} placeholder="monday-greens" className="mb-1"
                 autoCapitalize="none" spellCheck={false}
                 onChange={e => { setSlugTouched(true); setForm(f => ({ ...f, slug: e.target.value })) }} />
          <p className="text-xs mb-4" style={{ color: 'var(--dim)' }}>
            Diners reach the menu here. It goes on the QR codes, and changing it later
            breaks every one already printed.
          </p>

          <label className="eyebrow block mb-1">Design</label>
          <select value={form.template_id} className="mb-5"
                  onChange={e => setForm(f => ({ ...f, template_id: e.target.value }))}>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>

          <button className="btn btn-primary w-full" onClick={create} disabled={creating}>
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── who can get in ───────────────────────────────────────────────────────────

function Members({ tenantId, onSay }: {
  tenantId: string
  onSay: (text: string, bad?: boolean) => void
}) {
  const [members, setMembers] = useState<Member[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'owner' | 'staff'>('staff')
  const [busy, setBusy] = useState(false)
  const [invite, setInvite] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from('tenant_members').select('user_id, role').eq('tenant_id', tenantId)
    // No email here on purpose. `auth.users` is not readable from the browser at all, and
    // it should not be - a members list is not worth a route that can enumerate accounts.
    // The id is enough to show who is here and to remove them.
    setMembers((data || []).map(m => ({ ...m, email: '' })))
  }, [tenantId])

  useEffect(() => { void load() }, [load])

  async function add() {
    setBusy(true)
    setInvite(null)
    try {
      const res = await fetch('/api/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, email, role }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not add them')
      setEmail('')
      if (data.link) {
        setInvite(data.link)
        onSay('Account created. Send them the link below.')
      } else {
        onSay('They already had an account and now have access.')
      }
      void load()
    } catch (e) {
      onSay(e instanceof Error ? e.message : String(e), true)
    }
    setBusy(false)
  }

  async function remove(userId: string) {
    const res = await fetch(`/api/members?tenantId=${tenantId}&userId=${userId}`,
                            { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return onSay(data.error || 'Could not remove them', true)
    void load()
  }

  return (
    <div className="px-5 pb-5" style={{ background: 'var(--card2)' }}>
      <div className="pt-4">
        <div className="eyebrow mb-2">Who can edit this restaurant</div>
        {members.length === 0 ? (
          <p className="text-xs mb-3" style={{ color: 'var(--dim)' }}>Nobody yet.</p>
        ) : (
          <div className="grid gap-1 mb-4">
            {members.map(m => (
              <div key={m.user_id} className="flex items-center gap-2 text-xs">
                <span className="font-mono truncate flex-1" style={{ color: 'var(--dim)' }}>
                  {m.user_id.slice(0, 8)}…
                </span>
                <span className={`pill ${m.role === 'owner' ? 'pill-wait' : 'pill-mute'}`}>
                  {m.role}
                </span>
                <button className="btn btn-sm btn-ghost btn-danger"
                        onClick={() => remove(m.user_id)}>Remove</button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[180px]">
            <label className="eyebrow block mb-1">Add by email</label>
            <input value={email} onChange={e => setEmail(e.target.value)}
                   placeholder="manager@restaurant.ge" type="email" />
          </div>
          <select value={role} onChange={e => setRole(e.target.value as 'owner' | 'staff')}
                  style={{ width: 'auto' }}>
            <option value="staff">Staff</option>
            <option value="owner">Owner</option>
          </select>
          <button className="btn btn-primary" onClick={add} disabled={busy || !email}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>

        {invite && (
          <div className="mt-3 p-3 rounded-lg text-xs break-all"
               style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <div className="eyebrow mb-1">One-time link — send it to them</div>
            {invite}
            <p className="mt-2" style={{ color: 'var(--dim)' }}>
              They choose their own password. We never see it, and this link works once.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
