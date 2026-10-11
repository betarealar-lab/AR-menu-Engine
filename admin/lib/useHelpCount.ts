'use client'
// How many restaurants are waiting for help - the red number beside "To-do". Polls once a
// minute, and again at once when the to-do page changes something ('bl-todos'), so the
// badge and the list never disagree for long. Super admins only; 0 for everyone else.

import { useEffect, useState } from 'react'
import { openHelpCount } from '@/lib/data/todos'

export function useHelpCount(enabled: boolean): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let dead = false
    const tick = () => openHelpCount().then(c => { if (!dead) setN(c) })
    tick()
    const t = setInterval(tick, 60_000)
    window.addEventListener('bl-todos', tick)
    return () => { dead = true; clearInterval(t); window.removeEventListener('bl-todos', tick) }
  }, [enabled])
  return enabled ? n : 0
}
