'use client'
// The Library Studio. BetaReal's own 3D models, made without a restaurant.
//
// Temo, 2026-09-28: "developers should have independent 3D studio that adds to library
// not tenants model list." Before 0030 a model had to belong to a restaurant, so a demo
// dish or an engine test was filed under whichever client was selected and appeared in
// their Studio, their counts and their analytics.
//
// Three views:
//   Library  - EVERY model, whoever owns it (components/LibraryModels): owner, dishes,
//              dish pages and QR codes (2026-09-28)
//   Build    - four photos -> a model, with the engine chosen here and nowhere else
//   Queue    - what is on its way
//
// A library model is borrowable by any restaurant from its 3D Studio's Shared tab, the
// same pointer mechanism as before (0024): one fix fixes every menu using it.

import { useState } from 'react'
import { usePlan } from '@/lib/usePlan'
import { uploadAsset } from '@/lib/upload'
import SizeInput from '@/components/SizeInput'
import LibraryModels from '@/components/LibraryModels'
import DevNav from '@/components/DevNav'
import EngineBanner from '@/components/EngineBanner'
import DevRequests from '@/components/DevRequests'
import { EMPTY_DIMS, hasDims, type Dims } from '@/lib/data/studio'
import { requestLibraryBuild, ENGINES, DEFAULT_ENGINE } from '@/lib/data/dev'

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


export default function LibraryStudio() {
  const plan = usePlan()
  const [view, setView] = useState<View>('models')
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [bump, setBump] = useState(0)

  // Build
  const [frames, setFrames] = useState<({ key: string; preview: string } | null)[]>([null, null, null, null])
  const [busySlot, setBusySlot] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [dims, setDims] = useState<Dims>(EMPTY_DIMS)
  const [engine, setEngine] = useState(DEFAULT_ENGINE)
  const [sending, setSending] = useState(false)

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
            Every model BetaReal has. New ones are BetaReal&rsquo;s until assigned; ones made in a
            restaurant&rsquo;s 3D Studio are that restaurant&rsquo;s. Open a model for its dishes, pages and QR codes.
          </p>
        </div>
        <div className="flex gap-1">
          {([['models', 'Library'], ['build', 'Build from photos'], ['queue', 'Queue']] as [View, string][])
            .map(([id, label]) => (
              <button key={id} onClick={() => setView(id)}
                      className={`btn btn-sm ${view === id ? 'btn-primary' : 'btn-ghost'}`}>{label}</button>
            ))}
        </div>
      </div>
      <EngineBanner />
      {msg && <p className="text-sm mb-4" style={{ color: msg.bad ? 'var(--danger)' : 'var(--success)' }}>{msg.text}</p>}

      {view === 'models' && <LibraryModels onMsg={setMsg} />}

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

    </div>
  )
}
