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
import SizeInput from '@/components/SizeInput'
import {
  loadCaptures, saveCapture, removeCapture, requestMultiview, loadCaptureTasks,
  requestBuild, EMPTY_DIMS, hasDims, type Capture, type CaptureTask, type Dims,
} from '@/lib/data/studio'
import { useFileDrop } from '@/lib/useFileDrop'
import { useLang } from '@/lib/useLang'
import { text } from '@/lib/i18n'

// dataset.SLOTS, in the engine's order. The first frame is what the generator builds
// from, and four photos of the same side make a confident, wrong model.
// `key` is the ENGINE's name for the angle and stays English in every language - it
// becomes part of the uploaded filename and the dataset slot. Only what the owner reads
// is translated, looked up at render time so it follows the language switch.
export const SLOTS = [
  { key: 'front', label: 'slotFront', help: 'slotFrontHelp' },
  { key: 'right', label: 'slotRight', help: 'slotRightHelp' },
  { key: 'back',  label: 'slotBack',  help: 'slotBackHelp' },
  { key: 'left',  label: 'slotLeft',  help: 'slotLeftHelp' },
] as const

type Dish = { id: string; name: string }


/** One of the four photo slots, as its own element so it can hold a drop target.
 *
 *  Per slot rather than one target over the whole grid: the angles are not
 *  interchangeable - 01 is the primary and the model is built around it - so a photo
 *  dragged onto "left" should land on left, not in the next free space. The hook has to
 *  live in a component for that, because React will not allow one to be called in a loop.
 */
function SlotBox({ primary, accept, disabled, onFiles, children }: {
  primary: boolean
  accept: string
  disabled: boolean
  onFiles: (files: File[]) => void
  children: React.ReactNode
}) {
  const [T] = useLang()
  const { dropProps, over } = useFileDrop(onFiles, { accept, disabled })
  return (
    <div {...dropProps} className="rounded-xl overflow-hidden relative transition-colors"
         style={{
           border: `1px solid ${over || primary ? 'var(--gold)' : 'var(--border)'}`,
           background: over ? 'var(--gold-dim)' : 'var(--bg)',
         }}>
      {children}
      {/* Only while something is over it. A permanent "drop here" is noise on a phone,
          where there is no dragging at all. */}
      {over && (
        <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold pointer-events-none"
             style={{ background: 'rgba(0,0,0,.45)', color: 'var(--gold)' }}>
          {T.plateDropHere}
        </div>
      )}
    </div>
  )
}


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
  const [T] = useLang()
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
  // A flat plate by default: it is what most dishes are, and a default that is usually
  // right beats an empty box an owner skips.
  // EMPTY, not a preset. It used to open with Flat plate's 28 x 28 x 3 already in the
  // boxes, which is a default answer to a question only the owner can answer - and a
  // burger built as a dinner plate costs 30 credits and a remake. The Build button
  // stays disabled until one number is typed.
  const [dims, setDims] = useState<Dims>({ ...EMPTY_DIMS })
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
      // The KEY, from the route, rather than `url.split('/a/')[1]` - which is what this
      // did, and which quietly becomes the whole URL the day the serving path changes.
      const { key } = await uploadAsset(blob, 'photo', tenantId, `${SLOTS[slot].key}.jpg`)
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

  async function send() {
    if (!filled) return props.onError('Add at least one photo of the dish')
    const bad = Object.values(dims).some(v => v !== null && (v < 1 || v > 200))
    if (bad) return props.onError('A dish is between 1 and 200 cm')
    setSending(true)
    const name = title.trim() || dishes.find(d => d.id === itemId)?.name || ''
    const { data, error } = await requestBuild({
      tenantId, dish: dishKey, variant, itemId: itemId || null, title: name,
      photoKeys: frames.filter(Boolean).map(f => f!.key),
      dims: hasDims(dims) ? dims : EMPTY_DIMS,
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
          <h2 className="font-semibold">{T.viewPhotos}</h2>
          <span className={`pill ml-auto ${filled === 4 ? 'pill-on' : filled ? 'pill-wait' : 'pill-mute'}`}>
            {filled === 0 ? T.plateNoneYet
              : filled < 4 ? text(T.plateSomeOfFour, { n: filled })
              : T.plateAllFour}
          </span>
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--dim)' }}>
          {T.plateHint}
        </p>

        <div className="grid grid-cols-2 gap-3">
          {SLOTS.map((slot, i) => {
            const f = frames[i]
            return (
              <SlotBox key={slot.key} primary={i === 0} accept="image/*"
                       disabled={busySlot === i}
                       onFiles={files => {
                         if (!files.length) { props.onError(T.plateNotAnImage); return }
                         void putFrame(i, files[0])
                       }}>
                <div className="flex items-center gap-2 px-3 pt-2.5 pb-1 text-[11px]">
                  <span className="font-mono" style={{ color: i === 0 ? 'var(--gold)' : 'var(--dim)' }}>
                    0{i + 1}
                  </span>
                  <span className="eyebrow" style={{ color: i === 0 ? 'var(--gold)' : undefined }}>
                    {T[slot.label]}{i === 0 ? ' · ' + T.slotPrimary : ''}
                  </span>
                  {f?.generated && <span className="pill pill-mute ml-auto">{T.platePredicted}</span>}
                </div>

                <button type="button" onClick={() => fileRefs.current[i]?.click()}
                        disabled={busySlot === i}
                        className="w-full aspect-[4/3] flex items-center justify-center text-xs"
                        style={{ color: 'var(--dim)' }}>
                  {busySlot === i ? T.plateUploading
                    : f ? <img src={f.url} alt="" className="w-full h-full object-cover" />
                    : <span className="flex flex-col items-center gap-1">
                        <span className="text-xl leading-none">+</span>
                        <span>{f === null && predicting ? T.platePredicting : T.plateAddPhoto}</span>
                      </span>}
                </button>

                {/* No `capture` attribute, deliberately. `capture="environment"` does
                    not mean "prefer the camera" - it REPLACES the file picker with the
                    camera, so an owner on a phone could not choose a photo they already
                    had. That is the normal case, not the edge one: the capture protocol
                    asks for a proper camera and four planned angles, and those photos
                    reach the phone afterwards. Without the attribute a phone offers both,
                    camera included, so nothing is lost and the gallery is back. */}
                <input ref={el => { fileRefs.current[i] = el }} type="file" accept="image/*"
                       className="hidden"
                       onChange={e => { const file = e.target.files?.[0]; if (file) putFrame(i, file) }} />

                {f && (
                  <button type="button" onClick={() => clearFrame(i)}
                          className="absolute top-9 right-2 text-[11px] px-2 py-1 rounded"
                          style={{ background: 'rgba(0,0,0,.65)', color: '#fff' }}>
                    {f.generated ? T.plateReplace : T.plateRemove}
                  </button>
                )}
                {!props.compact && (
                  <p className="px-3 pb-3 text-[11px] leading-4" style={{ color: 'var(--dim)' }}>
                    {T[slot.help]}
                  </p>
                )}
              </SlotBox>
            )
          })}
        </div>

        {/* multiview */}
        <div className="mt-4 flex items-center gap-3 flex-wrap rounded-xl p-3"
             style={{ background: 'var(--card2)' }}>
          <div className="flex-1 min-w-[200px]">
            <div className="text-sm font-semibold">{T.plateOneOnly}</div>
            <p className="text-xs" style={{ color: 'var(--dim)' }}>
              {predicting ? T.platePredictingNow
                : predictedOnce ? T.platePredictedAlready
                : T.platePredictOffer}
            </p>
          </div>
          <button type="button" className="btn btn-sm" onClick={predict}
                  disabled={!canPredict || predicting}>
            {predicting ? T.platePredicting : T.platePredictButton}
          </button>
        </div>
      </div>

      {/* ── what it is, how big, build ──────────────────────────────────── */}
      <div className="grid gap-4 content-start">
        <div className="card p-5">
          <label className="eyebrow block mb-1.5">{T.plateWhichDish}</label>
          <select value={itemId} onChange={e => setItemId(e.target.value)} className="mb-3">
            <option value="">{T.plateNotOnMenu}</option>
            {dishes.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {!itemId && (
            <>
              <label className="eyebrow block mb-1.5">{T.nameLabel}</label>
              <input value={title} onChange={e => setTitle(e.target.value)}
                     placeholder={T.phDish} className="mb-3" />
            </>
          )}
          <label className="eyebrow block mb-1.5">{T.variantWord} <span style={{ color: 'var(--dim)', textTransform: 'none', letterSpacing: 0 }}>· {T.optionalWord}</span></label>
          <input value={variant === 'default' ? '' : variant}
                 onChange={e => setVariant(e.target.value.trim() || 'default')}
                 placeholder={T.plateVariantPh} />
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--dim)' }}>
            The same dish, made differently. Each variant gets its own photos and model.
          </p>
        </div>

        <div className="card p-5">
          <label className="eyebrow block mb-1.5">{T.plateHowBig}</label>
          <p className="text-[11px] mb-3" style={{ color: 'var(--dim)' }}>
            {T.plateSizeWhy}
          </p>
          <SizeInput value={dims} onChange={setDims} />
        </div>

        <div className="card p-5">
          {/* Disabled without a size. "Huge as a boat" in AR is the single most common way
              a model gets remade, and the fix costs nothing here and 30 credits later. */}
          <button type="button" onClick={send} disabled={sending || !filled || !hasDims(dims)}
                  className="btn btn-primary w-full">
            {sending ? T.plateSending : T.plateBuild}
          </button>
          <p className="text-[11px] mt-3 leading-4" style={{ color: 'var(--dim)' }}>
            {left > 0
              ? text(T.plateLeftHint, { left, quota: props.quota })
              : T.plateNoneLeftHint}
          </p>
        </div>
      </div>
    </div>
  )
}
