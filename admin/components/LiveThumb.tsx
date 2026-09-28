'use client'
// A model drawn live in a card, for models that have no poster.
//
// An uploaded model has no engine thumbnail - Meshy hands one back with a generation, an
// upload has nothing - so its library card showed the words "View in 3D" on an empty
// square. The rule the diner's menu settled on applies here too: when there is no picture
// to prefer, the model IS the picture (HANDOFF, 2026-09-18).
//
// `loading="lazy"` so a long grid does not start twenty WebGL contexts at once, and no
// camera controls: the card is a picture that happens to be 3D; clicking opens the stage.

import { useEffect, useRef } from 'react'
import { ensureViewer } from '@/lib/viewer'

/** `interactive`: a viewer you can turn, with the menu's own limits (0-85 degrees, so
 *  never from under the plate) - for a preview that is looked at, not a card in a grid. */
export default function LiveThumb({ src, interactive = false }: { src: string; interactive?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const mount = host.current
    if (!src || !mount) return
    let dead = false
    ;(async () => {
      await ensureViewer()
      if (dead || mount.querySelector('model-viewer')) return
      const el = document.createElement('model-viewer')
      el.setAttribute('src', src)
      el.setAttribute('loading', interactive ? 'eager' : 'lazy')
      el.setAttribute('auto-rotate', '')
      el.setAttribute('rotation-per-second', '18deg')
      el.setAttribute('interaction-prompt', 'none')
      el.setAttribute('shadow-intensity', '0.8')
      el.setAttribute('camera-orbit', '0deg 60deg 105%')
      if (interactive) {
        el.setAttribute('camera-controls', '')
        el.setAttribute('touch-action', 'pan-y')
        el.setAttribute('min-camera-orbit', 'auto 0deg auto')
        el.setAttribute('max-camera-orbit', 'auto 85deg auto')
      }
      el.style.cssText = 'width:100%;height:100%;background:transparent' +
        (interactive ? '' : ';pointer-events:none')
      mount.appendChild(el)
    })()
    return () => { dead = true; mount.querySelector('model-viewer')?.remove() }
  }, [src, interactive])
  return <div ref={host} className="w-full h-full" />
}
