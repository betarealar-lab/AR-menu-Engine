'use client'
// BetaReal's to-do list (Nika, 2026-10-11). Two kinds of row in one list:
//   Help  - a restaurant pressed "Need help?" in their admin. One of us calls or messages
//           them, then ticks it off. The product sends nothing; this list IS the alert.
//   Idea  - anything one of us wants to remember to do.
// Help requests sit on top, newest first; finished rows fold away underneath.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePlan } from '@/lib/usePlan'
import DevNav from '@/components/DevNav'
import { liveMenuUrl } from '@/lib/data/dev'
import { loadTodos, addIdea, setDone, removeTodo, ago, type Todo } from '@/lib/data/todos'

export default function TodoPage() {
  const plan = usePlan()
  const [rows, setRows] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [showDone, setShowDone] = useState(false)

  const refresh = useCallback(async () => {
    const { rows, error } = await loadTodos()
    setRows(rows); setError(error); setLoading(false)
    window.dispatchEvent(new Event('bl-todos'))
  }, [])

  useEffect(() => {
    if (plan.loading || plan.role !== 'super_admin') return
    queueMicrotask(refresh)
    const t = setInterval(refresh, 60_000)
    return () => clearInterval(t)
  }, [plan.loading, plan.role, refresh])

  const open = useMemo(() => rows.filter(r => !r.done_utc), [rows])
  const done = useMemo(() => rows.filter(r => r.done_utc), [rows])
  const helpOpen = open.filter(r => r.kind === 'help').length

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    const err = await addIdea(title, notes)
    setSaving(false)
    if (err) { setError(err); return }
    setTitle(''); setNotes('')
    refresh()
  }
  async function toggle(r: Todo) {
    const err = await setDone(r.id, !r.done_utc)
    if (err) setError(err); else refresh()
  }
  async function remove(r: Todo) {
    if (!window.confirm(`Delete "${r.title}"?`)) return
    const err = await removeTodo(r.id)
    if (err) setError(err); else refresh()
  }

  if (!plan.loading && plan.role !== 'super_admin') {
    return <div className="p-6 text-sm" style={{ color: 'var(--dim)' }}>This page is for BetaReal.</div>
  }

  // A plain function, not a component: a component defined in here would be a new type
  // on every render and React would remount every row.
  const row = (r: Todo) => {
    const help = r.kind === 'help'
    return (
      <div key={r.id} className="card p-4 flex gap-3 items-start"
           style={help && !r.done_utc ? { borderColor: 'var(--danger)' } : undefined}>
        <button onClick={() => toggle(r)} aria-label={r.done_utc ? 'Reopen' : 'Mark done'}
                className="mt-0.5 w-5 h-5 shrink-0 rounded-md flex items-center justify-center text-xs"
                style={{ border: '1.5px solid var(--border)',
                         background: r.done_utc ? 'var(--gold)' : 'transparent', color: '#000' }}>
          {r.done_utc ? '✓' : ''}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                  style={help
                    ? { background: 'var(--danger)', color: '#fff' }
                    : { background: 'var(--gold-dim)', color: 'var(--gold)' }}>
              {help ? 'Help' : 'Idea'}
            </span>
            <span className="font-semibold"
                  style={r.done_utc ? { textDecoration: 'line-through', color: 'var(--dim)' } : undefined}>
              {r.title}
            </span>
            <span className="text-xs" style={{ color: 'var(--dim)' }}>
              {help && r.updated_utc !== r.created_utc ? `asked again ${ago(r.updated_utc)}` : ago(r.created_utc)}
            </span>
          </div>
          {help && (
            <div className="text-sm mt-1 flex flex-wrap gap-x-3 gap-y-1" style={{ color: 'var(--dim)' }}>
              {r.tenant_slug && (
                <a href={liveMenuUrl(r.tenant_slug)} target="_blank" rel="noreferrer"
                   className="underline">/{r.tenant_slug}</a>
              )}
              {r.requester_email && (
                <a href={`mailto:${r.requester_email}`} className="underline">{r.requester_email}</a>
              )}
            </div>
          )}
          {r.notes && (
            <p className="text-sm mt-2 whitespace-pre-wrap">{r.notes}</p>
          )}
        </div>
        <button onClick={() => remove(r)} className="btn btn-ghost btn-sm btn-danger shrink-0">Delete</button>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <DevNav />
      <div className="mb-5">
        <p className="eyebrow">BetaReal</p>
        <h1 className="text-2xl font-bold">To-do</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--dim)' }}>
          Our ideas, and restaurants that pressed “Need help?”. Call or message them, then tick it off.
        </p>
      </div>

      <form onSubmit={add} className="card p-4 mb-5 grid gap-2">
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={300}
               placeholder="New idea or task" aria-label="Title" />
        <textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={4000} rows={2}
                  placeholder="Details (optional)" aria-label="Details" />
        <div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !title.trim()}>
            {saving ? 'Adding…' : 'Add'}
          </button>
        </div>
      </form>

      {error && <div className="card p-4 mb-4 text-sm" style={{ color: 'var(--danger)' }}>{error}</div>}
      {loading && <div className="card p-6 text-sm" style={{ color: 'var(--dim)' }}>Loading…</div>}

      {!loading && (
        <>
          <p className="eyebrow mb-2">
            Open · {open.length}{helpOpen > 0 ? ` · ${helpOpen} need help` : ''}
          </p>
          <div className="grid gap-2 mb-6">
            {open.length === 0 && (
              <div className="card p-6 text-sm" style={{ color: 'var(--dim)' }}>Nothing open.</div>
            )}
            {open.map(row)}
          </div>

          {done.length > 0 && (
            <>
              <button onClick={() => setShowDone(v => !v)} className="eyebrow mb-2">
                {showDone ? '▾' : '▸'} Done · {done.length}
              </button>
              {showDone && <div className="grid gap-2">{done.map(row)}</div>}
            </>
          )}
        </>
      )}
    </div>
  )
}
