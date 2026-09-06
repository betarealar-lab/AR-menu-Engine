'use client'
// The plate: photos become a request for a 3D model.
//
// Everything Scan Studio's bench does, for one restaurant: four slots that persist in the
// photo library between visits, multiview to predict the missing angles from one photo,
// the dish's real size before a credit is spent, a variant name for "the same dish, with
// sauce". What Scan Studio has and this does not is the engine choice, the optimise
// targets and the credit balance, because each one is a knob on how much we spend.
//
// One component, used by the studio and by setup, so the first model an owner makes and
// the fortieth are the same experience.

import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadAsset } from '@/lib/upload'
import {
  loadCaptures, saveCapture, removeCapture, requestMultiview, loadCaptureTasks,
  requestBuild, SHAPES, type Capture, type CaptureTask,
} from '@/lib/data/studio'

// dataset.SLOTS, in the engine's order. The first frame is what the generator builds
// from, and four photos of the same side make a confident, wrong model.
export const SLOTS = [
  { key: 'front', label: 'Front', help: 'Straight on, at the height a diner sees it. The model is built from this one first.' },
  { key: 'right', label: 'Right', help: 'A quarter turn clockwise. Same distance, same light.' },
  { key: 'back',  label: 'Back',  help: 'The far side. It is what stops the back being invented.' },
  { key: 'left',  label: 'Left',  help: 'A quarter turn the other way.' },
]

type Dish = { id: string; name: string }

export default function Plate(props: {
  tenantId: string
  dishes: Dish[]
  /** Open with this dish already chosen. */
  forItem?: string
  /** Open with this dish key (from the photo library), which may not be on the menu. */
  forDish?: { dish: string; variant: string; title: string }
  left: number
  quota: number
  compact?: boolean
  onSent: (state: string) => void
  onError: (message: string) => void
}) {
  const { tenantId, dishes, left } = props

  const [itemId, setItemId] = useState(props.forItem || '')
  const [title, setTitle] = useState(props.forDish?.title || '')
  const [variant, setVariant] = useState(props.forDish?.variant || 'default')
  // The engine key. The item's uuid when it is on the menu; a made-up one otherwise,
  // fixed for the life of this plate so its frames land under one dish.
  const [dishKey, setDishKey] = useState<string>(
    props.forDish?.dish || props.forItem || crypto.randomUUID())

  const [frames, setFrames] = useState<(Capture | null)[]>([null, null, null, null])
  const [tasks, setTasks] = useState<CaptureTask[]>([])
  const [busySlot, setBusySlot] = useState<number | null>(null)
  const [shape, setShape] = useState<string>('flat-plated')
  const [customCm, setCustomCm] = useState('')
  const [sending, setSending] = useState(false)
  const fileRefs = useRef<(HTMLInputElement | null)[]>([])

  // Picking a dish moves the plate onto that dish's frames - whatever was photographed
  // for it before is already here. That is the photo library doing its job.
  useEffect(() => {
    if (itemId) setDishKey(itemId)
  }, [itemId])

  const reload = useCallback(async () => {
    const [all, ts] = await Promise.all([loadCaptures(tenantId), loadCaptureTasks(tenantId)])
    const mine = all.filter(c => c.dish === dishKey && c.variant === variant)
    const next: (Capture | null)[] = [null, null, null, null]
    for (const c of mine) next[c.slot] = c
    setFrames(next)
    setTasks(ts.filter(t => t.dish === dishKey && t.variant === variant))
  }, [tenantId, dishKey, variant])

  useEffect(() => { void reload() }, [reload])

  // Multiview in flight: the frames will change without anyone touching them.
  const predicting = tasks.some(t => t.state === 'queued' || t.state === 'running')
  useEffect(() => {
    if (!predicting) return
    const id = setInterval(() => { void reload() }, 5000)
    return () => clearInterval(id)
  }, [predicting, reload])

  async function shrink(file: File): Promise<Blob> {
    // 2048px JPEG: engine input, and the detail thrown away here is the ceiling on the
    // model forever. Still resized - a phone hands over 12 MB and nothing past 2048 reaches
    // the generator.
    const bmp = await createImageBitmap(file)
    const w = Math.min(2048, bmp.width)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = Math.round(bmp.height * (w / bmp.width))
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return new Promise<Blob>((res, rej) =>
      canvas.toBlob(b => (b ? res(b) : rej(new Error('Could not read that photo'))), 'image/jpeg', 0.92))
  }

  async function putFrame(slot: number, file: File) {
    setBusySlot(slot)
    try {
      const blob = await shrink(file)
      const url = await uploadAsset(blob, 'photo', tenantId, `${SLOTS[slot].key}.jpg`)
      const key = url.split('/a/')[1] || url
      const { capture, error } = await saveCapture(tenantId, dishKey, variant, slot, key)
      if (error) throw new Error(error.message)
      setFrames(f => { const n = [...f]; n[slot] = capture; return n })
    } catch (e) {
      props.onError(e instanceof Error ? e.message : String(e))
    }
    setBusySlot(null)
  }

  async function clearFrame(slot: number) {
    const c = frames[slot]
    if (!c) return
    const err = await removeCapture(c.id)
    if (err) return props.onError(err.message)
    setFrames(f => { const n = [...f]; n[slot] = null; return n })
  }

  async function predict() {
    const have = frames.map((f, i) => (f ? i : -1)).filter(i => i >= 0)
    if (have.length !== 1) return
    const err = await requestMultiview(tenantId, dishKey, variant, have[0])
    if (err) return props.onError(err.message)
    void reload()
  }

  const filled = frames.filter(Boolean).length
  const predictedOnce = tasks.length > 0
  const canPredict = filled === 1 && !predictedOnce

  const chosenShape = SHAPES.find(s => s.id === shape)
  const cm = customCm ? Number(customCm) : chosenShape?.cm ?? null
  const axis = chosenShape?.axis ?? 'width'

  async function send() {
    if (!filled) return props.onError('Add at least one photo of the dish')
    if (cm !== null && (cm < 1 || cm > 200)) return props.onError('A dish is between 1 and 200 cm')
    setSending(true)
    const name = title.trim() || dishes.find(d => d.id === itemId)?.name || ''
    const { data, error } = await requestBuild({
      tenantId, dish: dishKey, variant, itemId: itemId || null, title: name,
      photoKeys: frames.filter(Boolean).map(f => f!.key),
      scaleCm: cm, scaleAxis: cm !== null ? axis : null,
    })
    setSending(false)
    if (error) return props.onError(error.message)
    props.onSent(data?.state || 'approved')
  }

  return (
    <div className={props.compact ? 'grid gap-4' : 'grid gap-4 lg:grid-cols-[1fr_320px]'}>
      {/* ── the four photos ─────────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-baseline gap-3 mb-1">
          <h2 className="font-semibold">Photos</h2>
          <span className={`pill ml-auto ${filled === 4 ? 'pill-on' : filled ? 'pill-wait' : 'pill-mute'}`}>
            {filled === 0 ? 'none yet' : filled < 4 ? `${filled} of 4` : 'all four'}
          </span>
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--dim)' }}>
          Even light, no hands in shot, the plate filling the frame. More angles, better model.
        </p>

        <div className="grid grid-cols-2 gap-3">
          {SLOTS.map((slot, i) => {
            const f = frames[i]
            return (
              <div key={slot.key} className="rounded-xl overflow-hidden relative"
                   style={{ border: `1px solid ${i === 0 ? 'var(--gold)' : 'var(--border)'}`,
                            background: 'var(--bg)' }}>
                <div className="flex items-center gap-2 px-3 pt-2.5 pb-1 text-[11px]">
                  <span className="font-mono" style={{ color: i === 0 ? 'var(--gold)' : 'var(--dim)' }}>
                    0{i + 1}
                  </span>
                  <span className="eyebrow" style={{ color: i === 0 ? 'var(--gold)' : undefined }}>
                    {slot.label}{i === 0 ? ' · primary' : ''}
                  </span>
                  {f?.generated && <span className="pill pill-mute ml-auto">predicted</span>}
                </div>

                <button type="button" onClick={() => fileRefs.current[i]?.click()}
                        disabled={busySlot === i}
                        className="w-full aspect-[4/3] flex items-center justify-center text-xs"
                        style={{ color: 'var(--dim)' }}>
                  {busySlot === i ? 'Uploading…'
                    : f ? <img src={f.url} alt="" className="w-full h-full object-cover" />
                    : <span className="flex flex-col items-center gap-1">
                        <span className="text-xl leading-none">+</span>
                        <span>{f === null && predicting ? 'predicting…' : 'add photo'}</span>
                      </span>}
                </button>

                <input ref={el => { fileRefs.current[i] = el }} type="file" accept="image/*"
                       capture="environment" className="hidden"
                       onChange={e => { const file = e.target.files?.[0]; if (file) putFrame(i, file) }} />

                {f && (
                  <button type="button" onClick={() => clearFrame(i)}
                          className="absolute top-9 right-2 text-[11px] px-2 py-1 rounded"
                          style={{ background: 'rgba(0,0,0,.65)', color: '#fff' }}>
                    {f.generated ? 'Replace' : 'Remove'}
                  </button>
                )}
                {!props.compact && (
                  <p className="px-3 pb-3 text-[11px] leading-4" style={{ color: 'var(--dim)' }}>
                    {slot.help}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {/* multiview */}
        <div className="mt-4 flex items-center gap-3 flex-wrap rounded-xl p-3"
             style={{ background: 'var(--card2)' }}>
          <div className="flex-1 min-w-[200px]">
            <div className="text-sm font-semibold">Only have one photo?</div>
            <p className="text-xs" style={{ color: 'var(--dim)' }}>
              {predicting ? 'Predicting the other three angles — about a minute.'
                : predictedOnce ? 'The other angles were predicted for this dish. Real photos beat predicted ones — replace any you can.'
                : 'We can predict the other three angles from it. Once per dish, free. A real photo always beats a prediction.'}
            </p>
          </div>
          <button type="button" className="btn btn-sm" onClick={predict}
                  disabled={!canPredict || predicting}>
            {predicting ? 'Predicting…' : 'Predict the other angles'}
          </button>
        </div>
      </div>

      {/* ── what it is, how big, build ──────────────────────────────────── */}
      <div className="grid gap-4 content-start">
        <div className="card p-5">
          <label className="eyebrow block mb-1.5">Which dish</label>
          <select value={itemId} onChange={e => setItemId(e.target.value)} className="mb-3">
            <option value="">Not on the menu yet</option>
            {dishes.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {!itemId && (
            <>
              <label className="eyebrow block mb-1.5">Name</label>
              <input value={title} onChange={e => setTitle(e.target.value)}
                     placeholder="Khachapuri" className="mb-3" />
            </>
          )}
          <label className="eyebrow block mb-1.5">Variant <span style={{ color: 'var(--dim)', textTransform: 'none', letterSpacing: 0 }}>· optional</span></label>
          <input value={variant === 'default' ? '' : variant}
                 onChange={e => setVariant(e.target.value.trim() || 'default')}
                 placeholder="with sauce, large, …" />
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--dim)' }}>
            The same dish, made differently. Each variant gets its own photos and model.
          </p>
        </div>

        <div className="card p-5">
          <label className="eyebrow block mb-1.5">How big is it</label>
          <p className="text-[11px] mb-3" style={{ color: 'var(--dim)' }}>
            One measurement is enough. Wrong size is the number one reason a model looks
            wrong in AR, and it is fixable later for free.
          </p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {SHAPES.map(s => (
              <button key={s.id} type="button" onClick={() => { setShape(s.id); setCustomCm('') }}
                      className="text-left rounded-lg px-3 py-2.5 text-xs transition-colors"
                      style={{ border: `1px solid ${shape === s.id && !customCm ? 'var(--gold)' : 'var(--border)'}`,
                               background: shape === s.id && !customCm ? 'var(--gold-dim)' : 'var(--bg)' }}>
                <div className="font-semibold">{s.label}</div>
                <div style={{ color: 'var(--dim)' }}>{s.cm} cm {s.axis === 'height' ? 'tall' : 'across'}</div>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input type="number" min={1} max={200} value={customCm} placeholder="or exactly"
                   inputMode="decimal" onChange={e => setCustomCm(e.target.value)} />
            <span className="text-xs shrink-0" style={{ color: 'var(--dim)' }}>cm {axis === 'height' ? 'tall' : 'across'}</span>
          </div>
        </div>

        <div className="card p-5">
          <button type="button" onClick={send} disabled={sending || !filled}
                  className="btn btn-primary w-full">
            {sending ? 'Sending…' : 'Build the model'}
          </button>
          <p className="text-[11px] mt-3 leading-4" style={{ color: 'var(--dim)' }}>
            {left > 0
              ? `${left} of ${props.quota} free models left. A few minutes, then it lands in your library for you to approve before any diner sees it.`
              : 'You have used your free models. Send it and we will be in touch — it will not start until we say yes.'}
          </p>
        </div>
      </div>
    </div>
  )
}
