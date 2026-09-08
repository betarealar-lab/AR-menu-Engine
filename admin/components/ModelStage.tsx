'use client'
// The dish, as big as the screen will allow.
//
// Temo: "upon clicking a thumbnail the model shows up in bigger whole screen 3d viewer."
//
// The card preview is a 250px square, which is enough to see that a model EXISTS and not
// enough to decide anything about it. The one thing an owner does on this screen is judge
// - is the sauce right, did the garnish survive, is the back of the plate invented
// nonsense - and every one of those questions needs the model bigger than a postage stamp.
// A rejection costs nothing; approving something wrong puts it in front of diners.
//
// Deliberately NOT a second implementation of the viewer. Same `ensureViewer()`, same
// pinned model-viewer 3.4.0 a diner's page loads, same `camera-orbit` the card uses - so
// what an owner approves here is framed the way it will appear on the menu. A preview that
// flatters is worse than no preview.

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ensureViewer } from '@/lib/viewer'

export default function ModelStage({ src, poster, orbit, title, caption, onClose }: {
  src: string
  poster?: string | null
  orbit?: string | null
  title: string
  caption?: string
  onClose: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  // Rendered into <body>, not where it sits in the tree. `position: fixed` is relative to
  // the VIEWPORT only while no ancestor has a transform, filter or perspective - and both
  // `main` and `.page-content` in this admin have one. So the first version of this
  // "full screen" viewer opened as a panel trapped inside the content column, 1830x628 of
  // a 2134x1032 window, with the sidebar still showing beside it. A portal steps out of
  // that entirely and is the only fix that does not depend on nobody ever adding a
  // transform to a wrapper again.

  // Escape closes, and the page behind does not scroll while this is open - on a phone a
  // drag meant for the model otherwise scrolls the list underneath it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  useEffect(() => {
    if (!src || !host.current) return
    let dead = false
    const mount = host.current
    ;(async () => {
      await ensureViewer()
      if (dead || mount.querySelector('model-viewer')) return
      const el = document.createElement('model-viewer')
      el.setAttribute('src', src)
      el.setAttribute('camera-controls', '')
      // No auto-rotate here, unlike the card. The card spins to catch the eye; this is
      // opened on purpose to look at something specific, and a model that keeps turning
      // away from the angle you are studying is an irritation.
      el.setAttribute('touch-action', 'none')
      el.setAttribute('shadow-intensity', '0.9')
      el.setAttribute('exposure', '1')
      el.setAttribute('interaction-prompt', 'none')
      // The same 85-degree floor the diner's viewer uses: below it you are looking up
      // through the plate, which no diner ever does and which makes any model look broken.
      el.setAttribute('min-camera-orbit', 'auto 0deg auto')
      el.setAttribute('max-camera-orbit', 'auto 85deg auto')
      if (poster) el.setAttribute('poster', poster)
      if (orbit) {
        const p = orbit.trim().split(/\s+/).map(Number)
        if (p.length === 3 && p.every(Number.isFinite)) {
          el.setAttribute('camera-orbit', `${p[0]}deg ${p[1]}deg ${p[2]}%`)
        }
      }
      el.style.cssText = 'width:100%;height:100%;background:transparent'
      mount.appendChild(el)
    })()
    return () => { dead = true }
  }, [src, poster, orbit])

  // No mounted flag: this component is only ever rendered after a click, inside a client
  // component whose state starts closed, so it never renders during SSR and `document`
  // always exists by the time it does. The `typeof` guard is belt and braces for a future
  // caller that renders it open on first paint.
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: 'rgba(8,8,10,0.94)', backdropFilter: 'blur(6px)' }}
      role="dialog" aria-modal="true" aria-label={`${title} in 3D`}
      // The backdrop closes; the model does not. Dragging to turn a dish must never be
      // the gesture that dismisses it, which is what a naive click-anywhere handler does
      // the moment a drag ends outside the canvas.
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="flex items-start justify-between gap-4 px-5 pt-4 shrink-0">
        <div className="min-w-0">
          <div className="font-semibold truncate" style={{ color: '#fff' }}>{title}</div>
          {caption && (
            <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,.55)' }}>{caption}</div>
          )}
        </div>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close"
                className="shrink-0 w-9 h-9 rounded-full grid place-items-center text-lg leading-none"
                style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }}>
          &#10005;
        </button>
      </div>

      {/* min-h-0 so the viewer can actually shrink inside the flex column - without it a
          model-viewer at height:100% pushes the hint line off the bottom of the screen. */}
      <div ref={host} className="flex-1 min-h-0" />

      <p className="text-center text-[11px] pb-4 pt-1 shrink-0"
         style={{ color: 'rgba(255,255,255,.45)' }}>
        Drag to turn it · pinch or scroll to zoom · Esc to close
      </p>
    </div>,
    document.body,
  )
}
