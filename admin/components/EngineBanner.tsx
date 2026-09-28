'use client'
// One line: is anything going to process what I am about to queue?
//
// The full health panel lives on /dev-analytics. This is the compact version for the
// pages that PUT work on the queue - Library Studio and Upload & optimise - because the
// moment somebody queues a model is exactly when "the engine is down" is worth knowing,
// and on 2026-09-28 it had been down for a day and a half with nothing on these screens
// to say so. Same two reporters and the same thresholds as the full panel.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Beat = { id: string; seen_utc: string; host: string; detail: string }

const UP_SECONDS = 70       // keepalive writes every 20 s: three missed beats
const PASS_SECONDS = 180    // the bridge passes every 30 s: six missed passes

const age = (b?: Beat) => (b ? (Date.now() - Date.parse(b.seen_utc)) / 1000 : Infinity)
const long = (s: number) => !Number.isFinite(s) ? 'never'
  : s < 90 ? `${Math.round(s)}s` : s < 5400 ? `${Math.round(s / 60)}m`
    : s < 172800 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`

export default function EngineBanner() {
  const [beats, setBeats] = useState<Beat[] | null>(null)

  useEffect(() => {
    let dead = false
    const load = async () => {
      const { data } = await createClient().from('engine_heartbeat')
        .select('id, seen_utc, host, detail')
      if (!dead) setBeats((data as Beat[]) || [])
    }
    void load()
    const id = setInterval(load, 30_000)
    return () => { dead = true; clearInterval(id) }
  }, [])

  if (!beats) return null
  const engine = beats.find(b => b.id === 'engine')
  const bridge = beats.find(b => b.id === 'bridge')
  const up = age(engine) < UP_SECONDS
  const passing = age(bridge) < PASS_SECONDS

  if (up && passing) {
    return (
      <div className="text-xs mb-4 flex items-center gap-2" style={{ color: 'var(--dim)' }}>
        <span className="pill pill-on">engine working</span>
        on {engine?.host || 'unknown host'} · last pass {long(age(bridge))} ago
      </div>
    )
  }
  return (
    <div className="card p-3 mb-4 text-sm flex flex-wrap items-center gap-2"
         style={{ borderColor: 'var(--danger)' }}>
      <span className="pill pill-off">{up ? 'engine not passing' : 'engine down'}</span>
      <span style={{ color: 'var(--dim)' }}>
        {up
          ? `Alive, but its last successful pass was ${long(age(bridge))} ago.`
          : `Last seen ${long(age(engine))} ago${engine?.host ? ` on ${engine.host}` : ''}.`}
        {' '}You can still queue work - it waits until the engine is back.
      </span>
    </div>
  )
}
