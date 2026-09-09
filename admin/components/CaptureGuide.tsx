'use client'
// How to photograph a dish, said before it costs anything.
//
// The engine's failure modes are almost all capture-time, and every one of them is free to
// avoid and thirty credits to discover. The rules here are the capture protocol, not
// general photography advice:
//
//   four evenly spaced angles   the model is trained on renders of 3D assets - fixed
//                               radius, fixed elevation, evenly spaced azimuths. Four
//                               photos of the pretty side is the most common way to get a
//                               confident, wrong model.
//   one height, all four        consistency matters more than the exact angle. ~25° is
//                               the working bet: below ~10° a bowl shows nothing, above
//                               ~45° the silhouette collapses and the dish comes out flat.
//   one light, no flash         glare is the geometry stage's weakness. Diffuse light,
//                               away from a window, no flash.
//   one edit, copied            grading each frame separately feeds inconsistent colour
//                               to the texture stage and bakes patchiness into the
//                               material. This is the trap in their own workflow.
//
// **Turn the plate, not yourself.** The spec says evenly spaced azimuths; for somebody
// standing in a restaurant, rotating the plate is easier than walking a circle AND keeps
// the background and framing identical, which the model also wants. Same result, less to
// get wrong.
//
// Two ways in, because they answer different questions. The full guide opens on its own
// the first time and from a button afterwards - "what am I about to do?". The one-line
// step under the slots answers "what is this next photo?" and changes every time, which
// is why it can appear on every upload without becoming wallpaper.

import { useEffect, useState } from 'react'
import { useLang } from '@/lib/useLang'
import { text } from '@/lib/i18n'

/** Remembered per restaurant: the second dish should not re-teach the first lesson. */
const seenKey = (tenantId: string) => `br-capture-guide-${tenantId}`

export function useCaptureGuide(tenantId: string) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!tenantId) return
    try {
      if (!localStorage.getItem(seenKey(tenantId))) setOpen(true)
    } catch { /* private window: showing it every time is the safe failure */ }
  }, [tenantId])

  const close = () => {
    setOpen(false)
    try { localStorage.setItem(seenKey(tenantId), '1') } catch { /* nothing to do */ }
  }
  return { open, close, show: () => setOpen(true) }
}

/** The one-line instruction for the photo they are about to take. */
export function NextShot({ slot, done }: { slot: number; done: number }) {
  const [T] = useLang()
  const steps = [T.shot1, T.shot2, T.shot3, T.shot4]
  if (done >= 4) {
    return (
      <p className="text-xs rounded-lg px-3 py-2" style={{ background: 'var(--gold-dim)', color: 'var(--gold)' }}>
        {T.shotAllDone}
      </p>
    )
  }
  return (
    <p className="text-xs rounded-lg px-3 py-2"
       style={{ background: 'var(--card2)', color: 'var(--text)', border: '1px solid var(--border)' }}>
      <strong>{text(T.shotStep, { n: slot + 1 })}</strong>{' '}
      {steps[slot]}{' '}
      <span style={{ color: 'var(--dim)' }}>{T.shotConstant}</span>
    </p>
  )
}

export default function CaptureGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [T] = useLang()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const steps = [
    { n: 1, deg: '0°', body: T.shot1 },
    { n: 2, deg: '90°', body: T.shot2 },
    { n: 3, deg: '180°', body: T.shot3 },
    { n: 4, deg: '270°', body: T.shot4 },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
         style={{ background: 'rgba(0,0,0,.6)' }} role="dialog" aria-modal="true"
         aria-label={T.guideTitle} onClick={onClose}>
      <div className="card w-full sm:max-w-lg max-h-[92vh] overflow-auto p-5 grid gap-4"
           onClick={e => e.stopPropagation()}>
        <div>
          <h2 className="text-lg font-bold">{T.guideTitle}</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--dim)' }}>{T.guideIntro}</p>
        </div>

        {/* The four shots, numbered, with the turn in degrees - the whole method is that
            they are evenly spaced, so the number is the instruction. */}
        <ol className="grid gap-2">
          {steps.map(s => (
            <li key={s.n} className="flex gap-3 rounded-lg p-3"
                style={{ background: 'var(--card2)' }}>
              <span className="font-mono text-sm font-bold shrink-0"
                    style={{ color: 'var(--gold)', width: 34 }}>{s.deg}</span>
              <span className="text-sm">{s.body}</span>
            </li>
          ))}
        </ol>

        <div className="grid gap-2">
          <div className="eyebrow">{T.guideEveryShot}</div>
          <ul className="text-sm grid gap-1.5" style={{ color: 'var(--dim)' }}>
            <li>· {T.ruleHeight}</li>
            <li>· {T.ruleFrame}</li>
            <li>· {T.ruleLight}</li>
            <li>· {T.ruleBackground}</li>
            <li>· {T.ruleEdit}</li>
          </ul>
        </div>

        <div className="grid gap-2">
          <div className="eyebrow" style={{ color: 'var(--danger)' }}>{T.guideMistakes}</div>
          <ul className="text-sm grid gap-1.5" style={{ color: 'var(--dim)' }}>
            <li>· {T.mistakePrettySide}</li>
            <li>· {T.mistakeFlash}</li>
            <li>· {T.mistakeHeight}</li>
            <li>· {T.mistakeEdits}</li>
          </ul>
        </div>

        <p className="text-[11px]" style={{ color: 'var(--dim)' }}>{T.guideWhy}</p>

        <button className="btn btn-primary w-full" onClick={onClose}>{T.guideGotIt}</button>
      </div>
    </div>
  )
}
