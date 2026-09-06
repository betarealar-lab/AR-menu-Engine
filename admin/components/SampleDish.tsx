'use client'
// A real dish, rotating.
//
// It replaces the spinner while a model builds, sits on the signup page, and fills empty
// states. Deliberately unlabelled: a turning dish is self-explanatory, and a caption
// telling somebody what to think about it is worse than silence.
//
// Loaded on demand, one viewer at a time. It is 220 KB and one WebGL context, which is
// fine anywhere; twenty of them would not be.

import { useEffect, useRef, useState } from 'react'
import { ensureViewer, SAMPLES, sampleUrl } from '@/lib/viewer'

export default function SampleDish({ height = 220, cycleSeconds = 12, className = '' }: {
  height?: number
  cycleSeconds?: number
  className?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const [i, setI] = useState(0)
  const sample = SAMPLES[i % SAMPLES.length]

  useEffect(() => {
    if (SAMPLES.length < 2) return
    const id = setInterval(() => setI(n => n + 1), cycleSeconds * 1000)
    return () => clearInterval(id)
  }, [cycleSeconds])

  useEffect(() => {
    const mount = host.current
    if (!mount) return
    let dead = false
    ;(async () => {
      await ensureViewer()
      if (dead) return
      mount.replaceChildren()
      const el = document.createElement('model-viewer')
      el.setAttribute('src', sampleUrl(sample.glb))
      el.setAttribute('auto-rotate', '')
      el.setAttribute('auto-rotate-delay', '0')
      el.setAttribute('rotation-per-second', '25deg')
      el.setAttribute('camera-controls', '')
      el.setAttribute('touch-action', 'pan-y')
      el.setAttribute('interaction-prompt', 'none')
      el.setAttribute('disable-zoom', '')
      el.setAttribute('shadow-intensity', '0.7')
      el.setAttribute('exposure', '1.05')
      el.setAttribute('alt', sample.name)
      if (sample.orbit) el.setAttribute('camera-orbit', sample.orbit)
      el.style.cssText = `width:100%;height:${height}px;background:transparent`
      mount.appendChild(el)
    })()
    return () => { dead = true }
  }, [sample, height])

  return <div ref={host} className={className} style={{ height }} />
}
