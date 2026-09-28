'use client'
// Upload a model. Developers only.
//
// Two ways, one screen:
//
//   Optimise   A GLB we have - a Meshy web export, a Blender fix - goes through the SAME
//              optimiser a generated master does: decimated to what a phone can hold,
//              textures on budget, real-world size baked in, Draco for the web, USDZ for
//              iPhone AR. Queued as `model_requests.kind = 'upload'` (0030). No credits.
//
//   As-is      The file ships exactly as uploaded (2026-09-28). For a model that is already
//              right - hand-finished, optimised elsewhere, or a test of the raw file on a
//              phone. GLB required, USDZ optional (without it there is no iPhone AR).
//              No engine, so no queue: it is a models row the moment the upload finishes.
//
// Both go up in 8 MiB parts through /api/asset/multipart, because a master is 60-290 MB
// and one request to the admin carries 10.

import { useMemo, useState } from 'react'
import { usePlan } from '@/lib/usePlan'
import { useFileDrop } from '@/lib/useFileDrop'
import SizeInput from '@/components/SizeInput'
import DevNav from '@/components/DevNav'
import EngineBanner from '@/components/EngineBanner'
import DevRequests from '@/components/DevRequests'
import { EMPTY_DIMS, hasDims, type Dims } from '@/lib/data/studio'
import { uploadModelFile, requestUploadOptimise, createAsIsModel } from '@/lib/data/dev'

type Mode = 'optimise' | 'asis'
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`

function DropZone({ accept, file, onFile, hint, disabled }: {
  accept: string
  file: File | null
  onFile: (f: File) => void
  hint: string
  disabled: boolean
}) {
  const { dropProps, over } = useFileDrop(fs => fs[0] && onFile(fs[0]), { accept, disabled })
  return (
    <label {...dropProps}
           className="rounded-xl px-4 py-6 text-center cursor-pointer transition-colors block"
           style={{ border: `2px dashed ${over ? 'var(--gold)' : file ? 'var(--success)' : 'var(--border)'}`,
                    background: over ? 'var(--gold-dim)' : 'var(--card2)' }}>
      <input type="file" accept={accept} className="hidden" disabled={disabled}
             onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
      {file
        ? <span className="font-semibold">{file.name} · {mb(file.size)}</span>
        : <span className="text-sm" style={{ color: 'var(--dim)' }}>{hint}</span>}
    </label>
  )
}

export default function UploadModel() {
  const plan = usePlan()
  const [mode, setMode] = useState<Mode>('optimise')
  const [glb, setGlb] = useState<File | null>(null)
  const [usdz, setUsdz] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [dims, setDims] = useState<Dims>(EMPTY_DIMS)
  const [target, setTarget] = useState<string>('library')
  const [targetQuery, setTargetQuery] = useState('')
  const [progress, setProgress] = useState<{ label: string; f: number } | null>(null)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [bump, setBump] = useState(0)

  const tenants = useMemo(() => {
    const q = targetQuery.trim().toLowerCase()
    return plan.tenants.filter(t => !q || `${t.name} ${t.slug}`.toLowerCase().includes(q))
  }, [plan.tenants, targetQuery])

  function pickGlb(f: File) {
    if (!/\.glb$/i.test(f.name)) { setMsg({ text: 'That box takes a .glb.', bad: true }); return }
    setGlb(f); setMsg(null)
    if (!title) setTitle(f.name.replace(/\.glb$/i, '').replace(/[_-]+/g, ' ').trim())
  }
  function pickUsdz(f: File) {
    if (!/\.usdz$/i.test(f.name)) { setMsg({ text: 'That box takes a .usdz.', bad: true }); return }
    setUsdz(f); setMsg(null)
  }

  const where = target === 'library' ? null : target
  const whereName = where ? plan.tenants.find(t => t.id === where)?.name || 'the restaurant' : 'the library'

  async function go() {
    if (!glb) return
    setMsg(null)
    try {
      if (mode === 'optimise') {
        setProgress({ label: glb.name, f: 0 })
        const key = await uploadModelFile(glb, 'raw', f => setProgress({ label: glb.name, f }))
        const err = await requestUploadOptimise({ rawKey: key, title: title || glb.name, dims, tenantId: where })
        if (err) throw new Error(err.message)
        setMsg({ text: `Uploaded ${mb(glb.size)} and queued for optimisation. It appears in ${whereName}${
          where ? ' as a draft' : ''} when it is done.` })
      } else {
        setProgress({ label: glb.name, f: 0 })
        const glbKey = await uploadModelFile(glb, 'asis', f => setProgress({ label: glb.name, f }))
        let usdzKey: string | null = null
        if (usdz) {
          setProgress({ label: usdz.name, f: 0 })
          usdzKey = await uploadModelFile(usdz, 'asis', f => setProgress({ label: usdz.name, f }))
        }
        const { error } = await createAsIsModel({ glbKey, usdzKey, title: title || glb.name, tenantId: where })
        if (error) throw new Error(error.message)
        setMsg({ text: `Uploaded as-is. It is in ${whereName} now, approved${usdz ? '' : ' - no iPhone AR without a USDZ'}.` })
      }
      setGlb(null); setUsdz(null); setTitle(''); setDims(EMPTY_DIMS)
      setBump(b => b + 1)
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), bad: true })
    }
    setProgress(null)
  }

  if (!plan.loading && plan.role !== 'super_admin') {
    return <div className="p-6 text-sm" style={{ color: 'var(--dim)' }}>This page is for BetaReal.</div>
  }

  const busy = progress !== null
  const MODES: [Mode, string, string][] = [
    ['optimise', 'Optimise', 'Decimate, texture budget, real size, Draco + USDZ made for you'],
    ['asis', 'Upload as-is', 'Ships exactly the file you give it. Nothing is changed'],
  ]
  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <DevNav />
      <p className="eyebrow">Developer</p>
      <h1 className="text-2xl font-bold mb-1">Upload a model</h1>
      <p className="text-sm mb-5" style={{ color: 'var(--dim)' }}>
        Any size up to 400 MB. No credits are spent either way.
      </p>
      {mode === 'optimise' && <EngineBanner />}

      <div className="card p-4 md:p-5 grid gap-5">
        <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="How to upload">
          {MODES.map(([id, label, note]) => {
            const on = mode === id
            return (
              <button key={id} role="radio" aria-checked={on} disabled={busy}
                      onClick={() => { setMode(id); setMsg(null) }}
                      className="text-left rounded-xl p-3 transition-colors"
                      style={{ border: `1px solid ${on ? 'var(--gold)' : 'var(--border)'}`,
                               background: on ? 'var(--gold-dim)' : 'var(--card2)' }}>
                <span className="flex items-center gap-2 font-semibold text-sm"
                      style={{ color: on ? 'var(--gold)' : 'var(--text)' }}>
                  <span className="w-3.5 h-3.5 rounded-full shrink-0"
                        style={{ border: `2px solid ${on ? 'var(--gold)' : 'var(--dim)'}`,
                                 background: on ? 'var(--gold)' : 'transparent',
                                 boxShadow: on ? 'inset 0 0 0 2px var(--card2)' : 'none' }} />
                  {label}
                </span>
                <span className="block text-xs mt-1" style={{ color: 'var(--dim)' }}>{note}</span>
              </button>
            )
          })}
        </div>

        <div className={`grid gap-3 ${mode === 'asis' ? 'sm:grid-cols-2' : ''}`}>
          <DropZone accept=".glb" file={glb} onFile={pickGlb} disabled={busy}
                    hint={mode === 'asis' ? 'GLB for web + Android (required)' : 'Drop a .glb here, or tap to choose'} />
          {mode === 'asis' && (
            <DropZone accept=".usdz" file={usdz} onFile={pickUsdz} disabled={busy}
                      hint="USDZ for iPhone AR (optional)" />
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="eyebrow block mb-1.5">Name</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Salmon steak" disabled={busy} />
          </div>
          <div>
            <label className="eyebrow block mb-1.5">Goes to</label>
            <select value={target} onChange={e => setTarget(e.target.value)} disabled={busy}>
              <option value="library">BetaReal library (approved, borrowable)</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name} · /{t.slug}</option>)}
            </select>
            {plan.tenants.length > 8 && (
              <input className="mt-2 text-xs" value={targetQuery} placeholder="Filter restaurants…"
                     onChange={e => setTargetQuery(e.target.value)} disabled={busy} />
            )}
          </div>
        </div>

        {mode === 'optimise' ? (
          <div>
            <label className="eyebrow block mb-1.5">Real size</label>
            <SizeInput value={dims} onChange={setDims} compact />
            {!hasDims(dims) && (
              <p className="text-xs mt-1.5" style={{ color: 'var(--gold)' }}>
                No size: it ships at whatever size the file says, which for a Meshy export is
                usually wrong (the salmon plate came out 44 cm).
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs rounded-lg p-3" style={{ background: 'var(--card2)', color: 'var(--dim)' }}>
            As-is means as-is: the size, triangle count and textures are whatever the file has.
            A raw Meshy master is 60–290 MB and will stall a phone. Use this for files that are already finished.
            {!usdz && glb && <><br /><b style={{ color: 'var(--gold)' }}>No USDZ chosen: iPhones will see the 3D but cannot open AR.</b></>}
          </p>
        )}

        {busy && (
          <div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--card2)' }}>
              <div className="h-full transition-all" style={{ width: `${Math.round(progress!.f * 100)}%`, background: 'var(--gold)' }} />
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>
              Uploading {progress!.label}… {Math.round(progress!.f * 100)}%
            </p>
          </div>
        )}
        {msg && <p className="text-sm" style={{ color: msg.bad ? 'var(--danger)' : 'var(--success)' }}>{msg.text}</p>}

        <div>
          <button className="btn btn-primary" onClick={go} disabled={!glb || busy}>
            {busy ? 'Uploading…' : mode === 'optimise' ? 'Upload & optimise' : 'Upload as-is'}
          </button>
        </div>
      </div>

      <h2 className="text-lg font-semibold mt-8 mb-3">Optimisation queue</h2>
      <div className="card p-4">
        <DevRequests tenants={plan.tenants} filter={['upload']} bump={bump} />
      </div>
    </div>
  )
}
