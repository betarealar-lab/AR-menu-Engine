'use client'
// Upload & optimise. Developers only.
//
// A GLB we already have - a Meshy web export, a Blender fix, a model from anywhere - goes
// through the SAME optimiser a generated master does: decimate to what a phone can hold,
// textures on budget, real-world size baked in, Draco for the web, USDZ for iPhone AR.
// Until 2026-09-28 the only way to do that was a person running scripts on a laptop and
// uploading the results by hand; the admin's own .glb upload shipped the file raw.
//
// The file goes up in parts (a master is 60-290 MB, far past what one request to a Worker
// can carry), lands as `lib/raw/…`, and a `model_requests` row of kind `upload` hands it
// to the bridge (0030). No credits: nothing is generated.

import { useMemo, useState } from 'react'
import { usePlan } from '@/lib/usePlan'
import { useFileDrop } from '@/lib/useFileDrop'
import SizeInput from '@/components/SizeInput'
import DevNav from '@/components/DevNav'
import EngineBanner from '@/components/EngineBanner'
import DevRequests from '@/components/DevRequests'
import { EMPTY_DIMS, hasDims, type Dims } from '@/lib/data/studio'
import { uploadRawModel, requestUploadOptimise } from '@/lib/data/dev'

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`

export default function UploadOptimise() {
  const plan = usePlan()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [dims, setDims] = useState<Dims>(EMPTY_DIMS)
  const [target, setTarget] = useState<string>('library')
  const [targetQuery, setTargetQuery] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [bump, setBump] = useState(0)

  const choose = (files: File[]) => {
    const f = files[0]
    if (!f) return
    if (!/\.glb$/i.test(f.name)) { setMsg({ text: 'Only .glb files.', bad: true }); return }
    setFile(f)
    setMsg(null)
    if (!title) setTitle(f.name.replace(/\.glb$/i, '').replace(/[_-]+/g, ' ').trim())
  }
  const { dropProps, over } = useFileDrop(choose, { accept: '.glb' })

  const tenants = useMemo(() => {
    const q = targetQuery.trim().toLowerCase()
    return plan.tenants.filter(t => !q || `${t.name} ${t.slug}`.toLowerCase().includes(q))
  }, [plan.tenants, targetQuery])

  async function go() {
    if (!file) return
    setMsg(null)
    setProgress(0)
    try {
      const key = await uploadRawModel(file, setProgress)
      const err = await requestUploadOptimise({
        rawKey: key, title: title || file.name, dims,
        tenantId: target === 'library' ? null : target,
      })
      if (err) throw new Error(err.message)
      setMsg({ text: `Uploaded ${mb(file.size)}. Queued for optimisation - it appears ${
        target === 'library' ? 'in the Library Studio' : "in that restaurant's 3D Studio, as a draft"
      } when it is done.` })
      setFile(null); setTitle(''); setDims(EMPTY_DIMS)
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
  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <DevNav />
      <p className="eyebrow">Developer</p>
      <h1 className="text-2xl font-bold mb-1">Upload &amp; optimise</h1>
      <p className="text-sm mb-5" style={{ color: 'var(--dim)' }}>
        Any .glb, any size up to 400 MB. It comes out decimated, textured on budget, at real
        size, as Draco for the web and USDZ for iPhone AR. No credits are spent.
      </p>
      <EngineBanner />

      <div className="card p-4 md:p-5 grid gap-5">
        <label {...dropProps}
               className="rounded-xl p-6 text-center cursor-pointer transition-colors block"
               style={{ border: `2px dashed ${over ? 'var(--gold)' : 'var(--border)'}`,
                        background: over ? 'var(--gold-dim)' : 'var(--card2)' }}>
          <input type="file" accept=".glb" className="hidden" disabled={busy}
                 onChange={e => choose(Array.from(e.target.files || []))} />
          {file
            ? <span className="font-semibold">{file.name} · {mb(file.size)}</span>
            : <span style={{ color: 'var(--dim)' }}>Drop a .glb here, or tap to choose</span>}
        </label>

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

        {busy && (
          <div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--card2)' }}>
              <div className="h-full transition-all" style={{ width: `${Math.round(progress! * 100)}%`, background: 'var(--gold)' }} />
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>Uploading… {Math.round(progress! * 100)}%</p>
          </div>
        )}
        {msg && <p className="text-sm" style={{ color: msg.bad ? 'var(--danger)' : 'var(--success)' }}>{msg.text}</p>}

        <div>
          <button className="btn btn-primary" onClick={go} disabled={!file || busy}>
            {busy ? 'Uploading…' : 'Upload & optimise'}
          </button>
        </div>
      </div>

      <h2 className="text-lg font-semibold mt-8 mb-3">Uploads</h2>
      <div className="card p-4">
        <DevRequests tenants={plan.tenants} filter={['upload']} bump={bump} />
      </div>
    </div>
  )
}
