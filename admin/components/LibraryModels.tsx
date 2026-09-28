'use client'
// The BetaReal library, whole: every model, whose it is, where it is used, and the dish
// pages and QR codes that go with it.
//
// Temo, 2026-09-28: "every model is betareal's on default, it is then assigned to a
// restaurant; if it is made in a restaurant's 3D studio then it is automatically the
// restaurant's. but every model is visible on betareal library" - and the QRs and links
// belong here too. Before this, the whole library was only reachable by picking a
// restaurant, opening ITS 3D Studio and then its Shared tab.
//
// A grid to find a model, and a panel to act on one:
//   Owner   BetaReal, or a restaurant - assign it, or give it back
//   Dishes  every dish in any restaurant using it, each with its page, QR, downloads and
//           switch (3D dishes only - 0035), and "put it on a dish" for any restaurant
//   Model   approve / reject, rename, retire, the files

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import QR from 'qrcode'
import LiveThumb from '@/components/LiveThumb'
import ModelStage from '@/components/ModelStage'
import {
  loadAllModels, assignModel, loadDishesOf, type LibModel, type ModelUse, type TenantLite,
} from '@/lib/data/libraryAll'
import { setLibraryState, renameLibraryModel, archiveLibraryModel } from '@/lib/data/dev'
import { attachModel, createDishWithModel } from '@/lib/data/models'
import { setDishLinkActive } from '@/lib/data/dishLinks'
import { downloadQrPng, downloadQrSvg, safeName } from '@/lib/qrDownload'

const STATE_PILL = { approved: 'pill-on', draft: 'pill-wait', rejected: 'pill-off' } as const
type Owner = 'all' | 'betareal' | string

function Qr({ value, size }: { value: string; size: number }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let alive = true
    QR.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', width: size })
      .then(s => { if (alive) setSvg(s) }).catch(() => {})
    return () => { alive = false }
  }, [value, size])
  return <div className="bg-white rounded p-0.5 shrink-0" style={{ width: size + 4, height: size + 4 }}
              dangerouslySetInnerHTML={{ __html: svg }} />
}

export default function LibraryModels({ onMsg }: { onMsg: (m: { text: string; bad?: boolean }) => void }) {
  const [models, setModels] = useState<LibModel[]>([])
  const [tenants, setTenants] = useState<TenantLite[]>([])
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)
  const [query, setQuery] = useState('')
  const [owner, setOwner] = useState<Owner>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const reload = useCallback(() => setVersion(v => v + 1), [])
  useEffect(() => {
    let dead = false
    loadAllModels().then(r => {
      if (dead) return
      setModels(r.models); setTenants(r.tenants); setLoading(false)
      if (r.error) onMsg({ text: r.error, bad: true })
    })
    return () => { dead = true }
  }, [version, onMsg])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return models.filter(m => (showArchived || !m.archived)
      && (owner === 'all' || (owner === 'betareal' ? m.ownerId === null : m.ownerId === owner))
      && (!q || `${m.title} ${m.ownerName} ${m.uses.map(u => `${u.dishName} ${u.tenantName}`).join(' ')}`
        .toLowerCase().includes(q)))
  }, [models, query, owner, showArchived])

  const counts = useMemo(() => ({
    all: models.filter(m => !m.archived).length,
    betareal: models.filter(m => !m.archived && m.ownerId === null).length,
  }), [models])

  const open = models.find(m => m.id === openId) || null

  return (
    <>
      <div className="flex flex-col md:flex-row gap-2 mb-4">
        <div className="flex-1 min-w-0">
          <input value={query} onChange={e => setQuery(e.target.value)}
                 placeholder="Search models, dishes or restaurants" />
        </div>
        <div className="md:w-64 shrink-0">
          <select value={owner} onChange={e => setOwner(e.target.value)} aria-label="Owner">
            <option value="all">Every owner ({counts.all})</option>
            <option value="betareal">BetaReal, not assigned ({counts.betareal})</option>
            {tenants.map(t => (
              <option key={t.id} value={t.id}>
                {t.name} ({models.filter(m => !m.archived && m.ownerId === t.id).length})
              </option>
            ))}
          </select>
        </div>
        <label className="text-xs flex items-center gap-2 shrink-0" style={{ color: 'var(--dim)' }}>
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} style={{ width: 'auto' }} />
          Show retired
        </label>
      </div>

      {loading && <div className="card p-6 text-sm" style={{ color: 'var(--dim)' }}>Loading the library…</div>}
      {!loading && !shown.length && (
        <div className="card p-6 text-sm text-center" style={{ color: 'var(--dim)' }}>Nothing matches.</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {shown.map(m => {
          const pages = m.uses.filter(u => u.link).length
          return (
            <button key={m.id} onClick={() => setOpenId(m.id)}
                    className="card overflow-hidden flex flex-col text-left transition-transform hover:-translate-y-0.5"
                    style={{ opacity: m.archived ? 0.55 : 1 }}>
              <div className="aspect-square w-full flex items-center justify-center text-xs"
                   style={{ background: 'var(--card2)', color: 'var(--dim)' }}>
                {m.poster
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={m.poster} alt="" className="w-full h-full object-cover" />
                  : m.glb ? <LiveThumb src={m.glb} /> : 'No file'}
              </div>
              <div className="p-3 grid gap-1.5">
                <div className="font-semibold text-sm truncate">{m.title}</div>
                <div className="flex flex-wrap items-center gap-1 text-[11px]">
                  <span className={`pill ${m.ownerId ? 'pill-mute' : 'pill-wait'}`}>{m.ownerName}</span>
                  <span className={`pill ${STATE_PILL[m.state]}`}>{m.state}</span>
                </div>
                <div className="text-[11px]" style={{ color: 'var(--dim)' }}>
                  {m.uses.length ? `On ${m.uses.length} dish${m.uses.length > 1 ? 'es' : ''}` : 'Not on any dish'}
                  {pages > 0 && ` · ${pages} QR`}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {open && (
        <ModelPanel model={open} tenants={tenants} onClose={() => setOpenId(null)}
                    onChanged={(text, bad) => { onMsg({ text, bad }); reload() }} />
      )}
    </>
  )
}

/** One model: everything that can be done with it, in one place. */
function ModelPanel({ model: m, tenants, onClose, onChanged }: {
  model: LibModel; tenants: TenantLite[]; onClose: () => void; onChanged: (text: string, bad?: boolean) => void
}) {
  const [stage, setStage] = useState(false)
  const [assignTo, setAssignTo] = useState<string>(m.ownerId ?? '')
  const [putTenant, setPutTenant] = useState<string>(m.ownerId ?? '')
  const [dishes, setDishes] = useState<{ id: string; name: string; model_id: string | null }[]>([])
  const [putDish, setPutDish] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !stage) onClose() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose, stage])

  useEffect(() => {
    if (!putTenant) return
    let dead = false
    loadDishesOf(putTenant).then(d => { if (!dead) { setDishes(d); setPutDish('') } })
    return () => { dead = true }
  }, [putTenant])

  async function step(fn: () => Promise<string | { message: string } | null>, ok: string) {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    const err = typeof r === 'string' ? r : r?.message || ''
    onChanged(err || ok, !!err)
  }

  async function copy(url: string, id: string) {
    try { await navigator.clipboard.writeText(url); setCopied(id); setTimeout(() => setCopied(null), 1500) } catch {}
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[900] flex justify-end" style={{ background: 'rgba(0,0,0,0.5)' }}
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-label={m.title}
           className="h-full w-full max-w-xl overflow-y-auto shadow-2xl"
           style={{ background: 'var(--card)', borderLeft: '1px solid var(--border)' }}>
        <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3"
             style={{ background: 'var(--card)', borderBottom: '1px solid var(--border)' }}>
          <input defaultValue={m.title} key={m.id} className="font-semibold"
                 onBlur={e => { const v = e.target.value.trim(); if (v && v !== m.title) void step(() => renameLibraryModel(m.id, v), 'Renamed') }} />
          <button className="btn btn-sm btn-ghost shrink-0" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="p-4 grid gap-5">
          <button className="aspect-video w-full rounded-xl overflow-hidden flex items-center justify-center"
                  style={{ background: 'var(--card2)' }} onClick={() => m.glb && setStage(true)} disabled={!m.glb}>
            {m.glb ? <LiveThumb src={m.glb} />
              // eslint-disable-next-line @next/next/no-img-element
              : m.poster ? <img src={m.poster} alt="" className="h-full object-contain" /> : 'No file'}
          </button>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`pill ${STATE_PILL[m.state]}`}>{m.state}</span>
            {m.scaleCm && <span className="pill pill-mute">{m.scaleCm} cm {m.scaleAxis}</span>}
            <span className="text-xs" style={{ color: 'var(--dim)' }}>made {new Date(m.createdUtc).toLocaleDateString()}</span>
            <span className="flex-1" />
            {m.state !== 'approved' && <button className="btn btn-sm btn-primary" disabled={busy}
              onClick={() => step(() => setLibraryState(m.id, 'approved'), 'Approved')}>Approve</button>}
            {m.state !== 'rejected' && <button className="btn btn-sm btn-ghost" disabled={busy}
              onClick={() => step(() => setLibraryState(m.id, 'rejected'), 'Rejected')}>Reject</button>}
            <button className="btn btn-sm btn-ghost" disabled={busy}
              onClick={() => step(() => archiveLibraryModel(m.id, !m.archived), m.archived ? 'Restored' : 'Retired')}>
              {m.archived ? 'Restore' : 'Retire'}</button>
            {m.glb && <a className="btn btn-sm btn-ghost" href={m.glb} download>GLB</a>}
            {m.usdz && <a className="btn btn-sm btn-ghost" href={m.usdz} download>USDZ</a>}
          </div>

          {/* ── Owner ── */}
          <section className="grid gap-2">
            <h3 className="eyebrow">Owner</h3>
            <p className="text-sm">
              {m.ownerId
                ? <><b>{m.ownerName}</b> <span style={{ color: 'var(--dim)' }}>- shown as theirs in their 3D Studio.</span></>
                : <><b>BetaReal</b> <span style={{ color: 'var(--dim)' }}>- not assigned to a restaurant yet.</span></>}
            </p>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <select value={assignTo} onChange={e => setAssignTo(e.target.value)} aria-label="Assign to">
                  <option value="">BetaReal (unassigned)</option>
                  {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <button className="btn btn-sm btn-primary shrink-0" disabled={busy || assignTo === (m.ownerId ?? '')}
                      onClick={() => step(() => assignModel(m.id, assignTo || null),
                        assignTo ? `Assigned to ${tenants.find(t => t.id === assignTo)?.name}.` : 'Given back to BetaReal.')}>
                {assignTo ? 'Assign' : 'Give back'}
              </button>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--dim)' }}>
              Every model stays in the library whoever owns it; other restaurants already using it keep it.
            </p>
          </section>

          {/* ── Dishes, with their pages and QR codes ── */}
          <section className="grid gap-2">
            <h3 className="eyebrow">On dishes ({m.uses.length})</h3>
            {!m.uses.length && <p className="text-sm" style={{ color: 'var(--dim)' }}>Not on any dish yet.</p>}
            {m.uses.map(u => <UseRow key={u.itemId} use={u} title={m.title} busy={busy} copied={copied === u.itemId}
                                     onCopy={() => u.link && copy(u.link.url, u.itemId)}
                                     onToggle={() => step(() => setDishLinkActive(u.itemId, !u.link!.active),
                                       u.link!.active ? 'Dish page switched off.' : 'Dish page is live.')}
                                     onDetach={() => step(async () => (await attachModel(u.itemId, null))?.message || '',
                                       `Taken off ${u.dishName}.`)} />)}

            <div className="rounded-lg p-3 grid gap-2 mt-1" style={{ background: 'var(--card2)' }}>
              <div className="text-xs font-semibold">Put it on a dish</div>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 min-w-0">
                  <select value={putTenant} onChange={e => setPutTenant(e.target.value)} aria-label="Restaurant">
                    <option value="">Pick a restaurant…</option>
                    {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="flex-1 min-w-0">
                  <select value={putDish} onChange={e => setPutDish(e.target.value)} disabled={!putTenant} aria-label="Dish">
                    <option value="">Pick a dish…</option>
                    <option value="__new">+ New dish named “{m.title}”</option>
                    {dishes.map(d => (
                      <option key={d.id} value={d.id}>{d.name}{d.model_id ? ' (has a model - replaces it)' : ''}</option>
                    ))}
                  </select>
                </div>
                <button className="btn btn-sm btn-primary shrink-0" disabled={busy || !putTenant || !putDish}
                        onClick={() => step(async () => {
                          const err = putDish === '__new'
                            ? await createDishWithModel(putTenant, { id: m.id, title: m.title })
                            : await attachModel(putDish, m.id)
                          return err?.message || ''
                        }, 'On the dish. Its page and QR are below once the model is approved.')}>
                  Put on
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      {stage && m.glb && (
        <ModelStage src={m.glb} poster={m.poster} title={m.title}
                    caption={m.scaleCm ? `${m.scaleCm} cm ${m.scaleAxis}` : undefined}
                    onClose={() => setStage(false)} />
      )}
    </div>,
    document.body,
  )
}

function UseRow({ use: u, title, busy, copied, onCopy, onToggle, onDetach }: {
  use: ModelUse; title: string; busy: boolean; copied: boolean
  onCopy: () => void; onToggle: () => void; onDetach: () => void
}) {
  const name = `${safeName(u.tenantName)}-${safeName(u.dishName || title)}`
  const dead = u.link && (!u.link.active || !u.pagesActive || !u.visible)
  return (
    <div className="card-flat p-3 flex gap-3 items-start">
      {u.link ? <Qr value={u.link.url} size={56} /> : (
        <div className="w-[60px] h-[60px] rounded flex items-center justify-center text-[10px] text-center shrink-0"
             style={{ background: 'var(--card2)', color: 'var(--dim)' }}>no page</div>
      )}
      <div className="min-w-0 flex-1 grid gap-1">
        <div className="text-sm"><b>{u.dishName}</b> <span style={{ color: 'var(--dim)' }}>· {u.tenantName}</span></div>
        {u.link ? (
          <>
            <button className="text-xs font-mono truncate text-left underline decoration-dotted" onClick={onCopy}
                    title="Copy the address">
              {copied ? 'Copied ✓' : u.link.url.replace(/^https?:\/\//, '')}
            </button>
            <div className="flex flex-wrap gap-1 items-center">
              <span className={`pill ${dead ? 'pill-off' : 'pill-on'}`}>
                {!u.pagesActive ? 'restaurant off' : !u.link.active ? 'off' : !u.visible ? 'dish hidden' : 'live'}
              </span>
              <a className="btn btn-sm btn-ghost" href={u.link.url} target="_blank" rel="noreferrer">Open ↗</a>
              <button className="btn btn-sm btn-ghost" onClick={() => downloadQrPng(u.link!.url, name)}>PNG</button>
              <button className="btn btn-sm btn-ghost" onClick={() => downloadQrSvg(u.link!.url, name)}>SVG</button>
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={onToggle}>
                {u.link.active ? 'Switch off' : 'Switch on'}
              </button>
            </div>
          </>
        ) : (
          <div className="text-xs" style={{ color: 'var(--dim)' }}>
            No page yet: {u.live3d ? 'this dish has no link row' : 'the model is not approved or 3D is off on this dish'}.
          </div>
        )}
      </div>
      <button className="btn btn-sm btn-ghost shrink-0" disabled={busy} onClick={onDetach} title="Take the model off this dish">Take off</button>
    </div>
  )
}
