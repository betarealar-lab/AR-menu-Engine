'use client'
// The plate: four photos become a request for a 3D model.
//
// One component, used by the 3D screen and by setup, because the first model an owner
// ever makes and the fortieth should be the same experience - and two copies of the angle
// guidance is two chances for one of them to be out of date.
//
// It owns everything up to the moment the request exists: the slots, the resizing, the
// upload, the send. What happens after - the library, the polling - is the screen's.

import { useRef, useState } from 'react'
import { uploadAsset } from '@/lib/upload'
import { requestModel } from '@/lib/data/models'

// dataset.SLOTS, in the engine's order, with dataset.SLOT_ROLE's reason for each. The
// order is not cosmetic: the first frame is what the generator reconstructs from, and
// four photos of the same side make a confident, wrong model.
export const SLOTS = [
  { key: 'front', label: 'Front',
    help: 'Straight on, at about the height a diner sees it. The model is built from this one first.' },
  { key: 'right', label: 'Right', help: 'A quarter turn clockwise. Same distance, same light.' },
  { key: 'back',  label: 'Back',
    help: 'The opposite side. Even if it looks the same — it is what stops the far side being invented.' },
  { key: 'left',  label: 'Left',  help: 'A quarter turn the other way, and you are done.' },
]

type Dish = { id: string; name: string }

export default function Plate(props: {
  tenantId: string
  dishes: Dish[]
  /** Pre-select a dish, e.g. from a "make a 3D model" button on that dish. */
  forItem?: string
  left: number
  quota: number
  compact?: boolean
  onSent: (state: string) => void
  onError: (message: string) => void
}) {
  const { tenantId, dishes, left } = props
  const [frames, setFrames] = useState<(string | null)[]>([null, null, null, null])
  const [previews, setPreviews] = useState<(string | null)[]>([null, null, null, null])
  const [busySlot, setBusySlot] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [forItem, setForItem] = useState(props.forItem || '')
  const [sending, setSending] = useState(false)
  const fileRefs = useRef<(HTMLInputElement | null)[]>([])

  const filled = frames.filter(Boolean).length
  const card = { background: 'var(--card)', border: '1px solid var(--border)' }

  async function shrink(file: File): Promise<Blob> {
    // 2048px, JPEG, quality high. Bigger than a menu photo on purpose: this is engine
    // input, and whatever detail is thrown away here is the ceiling on the model forever.
    // Still resized, because a modern phone hands over 12 MB and none of it past 2048
    // reaches the generator.
    const bmp = await createImageBitmap(file)
    const w = Math.min(2048, bmp.width)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = Math.round(bmp.height * (w / bmp.width))
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not read that photo'))),
                    'image/jpeg', 0.92))
  }

  async function putFrame(slot: number, file: File) {
    setBusySlot(slot)
    try {
      const blob = await shrink(file)
      // The slot name is in the filename so a frame is identifiable on its own in a bucket
      // listing - which is what you want when a model came out wrong and the question is
      // which photo it came from.
      const url = await uploadAsset(blob, 'photo', tenantId, `${SLOTS[slot].key}.jpg`)
      const key = url.split('/a/')[1] || url
      setFrames(f => { const n = [...f]; n[slot] = key; return n })
      setPreviews(p => { const n = [...p]; n[slot] = url; return n })
    } catch (e) {
      props.onError(e instanceof Error ? e.message : String(e))
    }
    setBusySlot(null)
  }

  function clearFrame(slot: number) {
    setFrames(f => { const n = [...f]; n[slot] = null; return n })
    setPreviews(p => { const n = [...p]; n[slot] = null; return n })
  }

  async function send() {
    if (!filled) return props.onError('Add at least one photo of the dish')
    setSending(true)
    const name = title.trim() || dishes.find(d => d.id === forItem)?.name || ''
    const { data, error } = await requestModel(
      tenantId, frames.filter(Boolean) as string[], name, forItem || null)
    setSending(false)
    if (error) return props.onError(error.message)
    setFrames([null, null, null, null])
    setPreviews([null, null, null, null])
    setTitle('')
    props.onSent(data?.state || 'approved')
  }

  return (
    <div className={props.compact ? 'grid gap-5' : 'grid gap-5 lg:grid-cols-[2fr_1fr]'}>
      <div className="rounded-xl p-5" style={card}>
        <div className="flex items-baseline gap-3 mb-1">
          <h2 className="font-semibold">Four photos</h2>
          <span className="text-xs ml-auto" style={{ color: 'var(--dim)' }}>
            {filled === 0 ? 'need at least one'
              : filled < 4 ? `${filled} of 4 — more angles, better model`
              : 'ready'}
          </span>
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--dim)' }}>
          Even light, no hands in shot, the plate filling most of the frame.
        </p>

        <div className="grid grid-cols-2 gap-3">
          {SLOTS.map((slot, i) => (
            <div key={slot.key} className="rounded-lg overflow-hidden relative"
                 style={{ border: i === 0 ? '1px solid var(--gold)' : '1px solid var(--border)',
                          background: 'var(--bg)' }}>
              <div className="flex items-center gap-2 px-3 pt-2 text-[11px]"
                   style={{ color: i === 0 ? 'var(--gold)' : 'var(--dim)' }}>
                <span className="font-mono">0{i + 1}</span>
                <span className="uppercase tracking-wide">
                  {slot.label}{i === 0 ? ' · primary' : ''}
                </span>
              </div>

              <button type="button" onClick={() => fileRefs.current[i]?.click()}
                      className="w-full aspect-[4/3] flex items-center justify-center text-xs"
                      style={{ color: 'var(--dim)' }}>
                {busySlot === i ? 'Uploading…'
                  : previews[i]
                    ? <img src={previews[i]!} alt="" className="w-full h-full object-cover" />
                    : 'add photo'}
              </button>

              <input ref={el => { fileRefs.current[i] = el }}
                     type="file" accept="image/*" capture="environment" className="hidden"
                     onChange={e => { const f = e.target.files?.[0]; if (f) putFrame(i, f) }} />

              {previews[i] && (
                <button type="button" onClick={() => clearFrame(i)}
                        className="absolute top-8 right-2 text-[11px] px-2 py-1 rounded"
                        style={{ background: 'rgba(0,0,0,.6)', color: '#fff' }}>Clear</button>
              )}
              {!props.compact && (
                <p className="px-3 pb-3 text-[11px] leading-4" style={{ color: 'var(--dim)' }}>
                  {slot.help}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl p-5 h-fit" style={card}>
        <label className="eyebrow block mb-1">Which dish</label>
        <select value={forItem} onChange={e => setForItem(e.target.value)} className="mb-4">
          <option value="">Not on the menu yet</option>
          {dishes.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>

        {!forItem && (
          <>
            <label className="eyebrow block mb-1">Name</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
                   placeholder="Khachapuri" className="mb-4" />
          </>
        )}

        <button type="button" onClick={send} disabled={sending || !filled}
                className="btn btn-primary w-full">
          {sending ? 'Sending…' : 'Build it'}
        </button>

        <p className="text-[11px] mt-3 leading-4" style={{ color: 'var(--dim)' }}>
          {left > 0
            ? `${left} of your ${props.quota} free models left. A few minutes, then it lands in your library for you to approve before any diner sees it.`
            : 'You have used your free models. Send it and we will be in touch — it will not start until we say yes.'}
        </p>
      </div>
    </div>
  )
}
