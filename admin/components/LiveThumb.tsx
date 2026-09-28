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

export default function LiveThumb({ src }: { src: string }) {
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
      el.setAttribute('loading', 'lazy')
      el.setAttribute('auto-rotate', '')
      el.setAttribute('rotation-per-second', '18deg')
      el.setAttribute('interaction-prompt', 'none')
      el.setAttribute('shadow-intensity', '0.8')
      el.setAttribute('camera-orbit', '0deg 60deg 105%')
      el.style.cssText = 'width:100%;height:100%;background:transparent;pointer-events:none'
      mount.appendChild(el)
    })()
    return () => { dead = true; mount.querySelector('model-viewer')?.remove() }
  }, [src])
  return <div ref={host} className="w-full h-full" />
}
