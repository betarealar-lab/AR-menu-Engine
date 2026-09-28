'use client'
// What developers have put on the queue: library builds and uploads, newest first, with
// their state. Refreshes itself while anything is still moving, and stops when nothing is,
// so an idle page is not polling the database all day.

import { useEffect, useState } from 'react'
import { loadDevRequests, type LibraryRequest } from '@/lib/data/dev'
import type { Tenant } from '@/lib/usePlan'

const LIVE = new Set(['pending', 'approved', 'running'])

const STATE_PILL: Record<LibraryRequest['state'], string> = {
  pending: 'pill-wait', approved: 'pill-wait', running: 'pill-wait',
  done: 'pill-on', failed: 'pill-off', cancelled: 'pill-mute',
}

const WHAT: Record<LibraryRequest['kind'], string> = {
  generate: 'from photos', upload: 'upload → optimise', rescale: 'resize',
}

export default function DevRequests({ tenants, filter, bump }: {
  tenants: Tenant[]
  /** Only these kinds. Absent: everything. */
  filter?: LibraryRequest['kind'][]
  /** Change it to reload now - after the page has queued something. */
  bump?: number
}) {
  const [rows, setRows] = useState<LibraryRequest[]>([])
  const [tick, setTick] = useState(0)

  // The state is set in the promise's callback, not in the effect body - the fetch is the
  // external system and this subscribes to its answer.
  useEffect(() => {
    let dead = false
    loadDevRequests().then(r => { if (!dead) setRows(r) })
    return () => { dead = true }
  }, [bump, tick])
  const moving = rows.some(r => LIVE.has(r.state))
  useEffect(() => {
    if (!moving) return
    const id = setInterval(() => setTick(t => t + 1), 8000)
    return () => clearInterval(id)
  }, [moving])

  const shown = filter ? rows.filter(r => filter.includes(r.kind)) : rows
  const where = (id: string | null) =>
    id === null ? 'Library' : tenants.find(t => t.id === id)?.name || 'a restaurant'

  if (!shown.length) {
    return <p className="text-sm" style={{ color: 'var(--dim)' }}>Nothing queued yet.</p>
  }
  return (
    <div className="grid gap-1.5">
      {shown.map(r => (
        <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
             style={{ borderBottom: '1px solid var(--border)' }}>
          <span className={`pill ${STATE_PILL[r.state]}`}>{r.state}</span>
          <span className="font-medium truncate max-w-[16rem]">{r.title || 'Untitled'}</span>
          <span className="text-xs" style={{ color: 'var(--dim)' }}>
            {WHAT[r.kind]} · into {where(r.tenant_id)}
            {(r.engine || r.engine_requested) && ` · ${r.engine || r.engine_requested}`}
            {' · '}{new Date(r.requested_utc).toLocaleString()}
          </span>
          {r.note && r.state === 'failed' && (
            <span className="text-xs w-full" style={{ color: 'var(--danger)' }}>{r.note}</span>
          )}
        </div>
      ))}
    </div>
  )
}
