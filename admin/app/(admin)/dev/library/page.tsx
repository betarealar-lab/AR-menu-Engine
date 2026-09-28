'use client'
// The Library Studio. BetaReal's own 3D models, made without a restaurant.
//
// Temo, 2026-09-28: "developers should have independent 3D studio that adds to library
// not tenants model list." Before 0030 a model had to belong to a restaurant, so a demo
// dish or an engine test was filed under whichever client was selected and appeared in
// their Studio, their counts and their analytics.
//
// Three views:
//   Models   - everything the library owns (tenant_id NULL): look, approve, rename, retire
//   Build    - four photos -> a model, with the engine chosen here and nowhere else
//   Queue    - what is on its way
//
// A library model is borrowable by any restaurant from its 3D Studio's Shared tab, the
// same pointer mechanism as before (0024): one fix fixes every menu using it.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePlan } from '@/lib/usePlan'
import { uploadAsset } from '@/lib/upload'
import SizeInput from '@/components/SizeInput'
import ModelStage from '@/components/ModelStage'
import LiveThumb from '@/components/LiveThumb'
import DevNav from '@/components/DevNav'
import EngineBanner from '@/components/EngineBanner'
import DevRequests from '@/components/DevRequests'
import { EMPTY_DIMS, hasDims, type Dims } from '@/lib/data/studio'
import {
  loadLibraryModels, requestLibraryBuild, setLibraryState, renameLibraryModel,
  archiveLibraryModel, ENGINES, DEFAULT_ENGINE, type LibraryItem,
} from '@/lib/data/dev'

type View = 'models' | 'build' | 'queue'
const SLOT_NAMES = ['Front', 'Right', 'Back', 'Left'] as const

/** 2048px JPEG - the same preparation the restaurant Studio's plate does, for the same
 *  reason: nothing past 2048 reaches the generator, and a phone hands over 12 MB. */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const w = Math.min(2048, bmp.width)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = Math.round(bmp.height * (w / bmp.width))
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  return new Promise<Blob>((res, rej) =>
    canvas.toBlob(b => (b ? res(b) : rej(new Error('Could not read that photo'))), 'image/jpeg', 0.92))
}

const STATE_PILL = { approved: 'pill-on', draft: 'pill-wait', rejected: 'pill-off' } as const

export default function LibraryStudio() {
  const plan = usePlan()
  const [view, setView] = useState<View>('models')
  const [models, setModels] = useState<LibraryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [stage, setStage] = useState<LibraryItem | null>(null)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [bump, setBump] = useState(0)

  // Build
  const [frames, setFrames] = useState<({ key: string; preview: string } | null)[]>([null, null, null, null])
  const [busySlot, setBusySlot] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [dims, setDims] = useState<Dims>(EMPTY_DIMS)
  const [engine, setEngine] = useState(DEFAULT_ENGINE)
  const [sending, setSending] = useState(false)

  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion(v => v + 1), [])
  useEffect(() => {
    if (plan.loading || plan.role !== 'super_admin') return
    let dead = false
    loadLibraryModels().then(m => { if (!dead) { setModels(m); setLoading(false) } })
    return () => { dead = true }
  }, [plan.loading, plan.role, version])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return models.filter(m => (showArchived || !m.archived)
      && (!q || `${m.title} ${m.dish}`.toLowerCase().includes(q)))
  }, [models, query, showArchived])

  async function act(p: Promise<{ message: string } | null>, ok: string) {
    const err = await p
    setMsg(err ? { text: err.message, bad: true } : { text: ok })
    reload()
  }

  async function putFrame(slot: number, file: File | undefined) {
    if (!file) return
    setBusySlot(slot)
    try {
      const blob = await shrink(file)
      const { key, url } = await uploadAsset(blob, 'photo', 'library',
        `${SLOT_NAMES[slot].toLowerCase()}.jpg`)
      setFrames(f => { const n = [...f]; n[slot] = { key, preview: url }; return n })
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), bad: true })
    }
    setBusySlot(null)
  }

  async function build() {
    const keys = frames.filter(Boolean).map(f => f!.key)
    if (!frames[0]) { setMsg({ text: 'The front photo is the one the engine builds from.', bad: true }); return }
    setSending(true)
    const err = await requestLibraryBuild({ title: title || 'Library dish', photoKeys: keys, dims, engine })
    setSending(false)
    if (err) { setMsg({ text: err.message, bad: true }); return }
    setMsg({ text: 'Queued. It lands here as a draft for you to approve.' })
    setFrames([null, null, null, null]); setTitle(''); setDims(EMPTY_DIMS)
    setBump(b => b + 1)
    setView('queue')
  }

  if (!plan.loading && plan.role !== 'super_admin') {
    return <div className="p-6 text-sm" style={{ color: 'var(--dim)' }}>This page is for BetaReal.</div>
  }

  const chosen = ENGINES.find(e => e.id === engine)
  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <DevNav />
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <p className="eyebrow">Developer</p>
          <h1 className="text-2xl font-bold">Library Studio</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--dim)' }}>
            BetaReal&rsquo;s own models. Any restaurant can use one from its 3D Studio&rsquo;s Shared tab.
          </p>
        </div>
        <div className="flex gap-1">
          {([['models', `Models (${models.filter(m => !m.archived).length})`], ['build', 'Build from photos'], ['queue', 'Queue']] as [View, string][])
            .map(([id, label]) => (
              <button key={id} onClick={() => setView(id)}
                      className={`btn btn-sm ${view === id ? 'btn-primary' : 'btn-ghost'}`}>{label}</button>
            ))}
        </div>
      </div>
      <EngineBanner />
      {msg && <p className="text-sm mb-4" style={{ color: msg.bad ? 'var(--danger)' : 'var(--success)' }}>{msg.text}</p>}

      {view === 'models' && (
        <>
          <div className="flex flex-col md:flex-row gap-2 mb-4">
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search the library" style={{ flex: 1, minWidth: 0 }} />
            <label className="text-xs flex items-center gap-2 shrink-0" style={{ color: 'var(--dim)' }}>
              <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} style={{ width: 'auto' }} />
              Show retired
            </label>
          </div>
          {loading && <div className="card p-6 text-sm" style={{ color: 'var(--dim)' }}>Loading…</div>}
          {!loading && shown.length === 0 && (
            <div className="card p-6 text-sm text-center" style={{ color: 'var(--dim)' }}>
              The library is empty. Build one from photos, or use Upload &amp; optimise.
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {shown.map(m => (
              <div key={m.id} className="card overflow-hidden flex flex-col" style={{ opacity: m.archived ? 0.55 : 1 }}>
                <button className="aspect-square flex items-center justify-center text-xs"
                        style={{ background: 'var(--card2)', color: 'var(--dim)' }}
                        onClick={() => m.glb && setStage(m)} disabled={!m.glb}
                        title={m.glb ? 'Turn it around' : 'No file yet'}>
                  {m.poster
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={m.poster} alt="" className="w-full h-full object-cover" />
                    : m.glb ? <LiveThumb src={m.glb} /> : 'No file'}
                </button>
                <div className="p-3 grid gap-2 flex-1">
                  <input defaultValue={m.title} className="text-sm font-semibold"
                         onBlur={e => { if (e.target.value.trim() && e.target.value !== m.title) void act(renameLibraryModel(m.id, e.target.value), 'Renamed') }} />
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]" style={{ color: 'var(--dim)' }}>
                    <span className={`pill ${STATE_PILL[m.state]}`}>{m.state}</span>
                    {m.scale_cm && <span>{m.scale_cm} cm {m.scale_axis}</span>}
                    <span>{m.usedBy ? `on ${m.usedBy} dish${m.usedBy > 1 ? 'es' : ''}` : 'unused'}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-auto">
                    {m.state !== 'approved' && (
                      <button className="btn btn-sm btn-primary" onClick={() => act(setLibraryState(m.id, 'approved'), 'Approved')}>Approve</button>
                    )}
                    {m.state !== 'rejected' && (
                      <button className="btn btn-sm btn-ghost" onClick={() => act(setLibraryState(m.id, 'rejected'), 'Rejected')}>Reject</button>
                    )}
                    <button className="btn btn-sm btn-ghost"
                            onClick={() => act(archiveLibraryModel(m.id, !m.archived), m.archived ? 'Restored' : 'Retired')}>
                      {m.archived ? 'Restore' : 'Retire'}
                    </button>
                    {m.glb && <a className="btn btn-sm btn-ghost" href={m.glb} download>GLB</a>}
                    {m.usdz && <a className="btn btn-sm btn-ghost" href={m.usdz} download>USDZ</a>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {view === 'build' && (
        <div className="card p-4 md:p-5 grid gap-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {SLOT_NAMES.map((name, i) => (
              <label key={name} className="rounded-xl overflow-hidden cursor-pointer block aspect-square relative"
                     style={{ background: 'var(--card2)', border: '1px solid var(--border)' }}>
                <input type="file" accept="image/*" className="hidden" disabled={busySlot !== null}
                       onChange={e => putFrame(i, e.target.files?.[0])} />
                {frames[i]
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={frames[i]!.preview} alt="" className="w-full h-full object-cover" />
                  : <span className="absolute inset-0 flex items-center justify-center text-xs text-center p-2" style={{ color: 'var(--dim)' }}>
                      {busySlot === i ? 'Uploading…' : `${name}${i === 0 ? ' (required)' : ''}`}
                    </span>}
                <span className="absolute left-2 top-2 pill pill-mute">{i + 1} · {name}</span>
              </label>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="eyebrow block mb-1.5">Name</label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Khachapuri Adjaruli" />
            </div>
            <div>
              <label className="eyebrow block mb-1.5">Engine</label>
              <select value={engine} onChange={e => setEngine(e.target.value)}>
                {ENGINES.map(e => (
                  <option key={e.id} value={e.id} disabled={!e.wired}>
                    {e.label} · {e.cost}{e.wired ? '' : ' · not switched on'}
                  </option>
                ))}
              </select>
              {chosen && <p className="text-xs mt-1.5" style={{ color: 'var(--dim)' }}>{chosen.note} Takes up to {chosen.views} photos.</p>}
            </div>
          </div>

          <div>
            <label className="eyebrow block mb-1.5">Real size</label>
            <SizeInput value={dims} onChange={setDims} compact />
            {!hasDims(dims) && (
              <p className="text-xs mt-1.5" style={{ color: 'var(--gold)' }}>
                Without a size it ships at whatever size the engine invents.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" onClick={build} disabled={sending || !frames[0]}>
              {sending ? 'Queuing…' : `Build · ${chosen?.cost || ''}`}
            </button>
            <span className="text-xs" style={{ color: 'var(--dim)' }}>
              Spends Meshy credits. Library builds are not held by any quota.
            </span>
          </div>
        </div>
      )}

      {view === 'queue' && (
        <div className="card p-4">
          <DevRequests tenants={plan.tenants} filter={['generate']} bump={bump} />
        </div>
      )}

      {stage && (
        <ModelStage src={stage.glb} poster={stage.poster} title={stage.title}
                    caption={stage.scale_cm ? `${stage.scale_cm} cm ${stage.scale_axis}` : undefined}
                    onClose={() => setStage(null)} />
      )}
    </div>
  )
}
