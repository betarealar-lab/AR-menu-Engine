'use client'
// The files behind a model, for us.
//
// Temo asked for download in developer mode. What it is actually for: taking a GLB into
// Blender to see what the engine did, keeping a copy of a master before a re-run, and
// handing a client their own model if they ever ask for it.
//
// **This is a control, not a lock.** The files are public by URL - a diner's phone fetches
// the same bytes with no credential, because that is what serving a 3D menu means. Hiding
// the button from an owner is a courtesy: it is a thing they have no use for, and a menu
// screen with a "download .usdz" on it is a screen that has stopped being about food.
// Nothing here would be a security boundary if it were shown to everyone.
//
// The one that is NOT here is the master: 60-100 MB and two million triangles, kept in the
// engine's own bucket and never served to a browser. `worker.py` is where that lives.

import { useEffect, useState } from 'react'
import type { TenantModel } from '@/lib/data/models'
import { fileName, saveAs, sizeOf, humanSize } from '@/lib/download'

type Entry = { label: string; url: string; ext: string; what: string }

export default function ModelFiles({ model: m, onSay }: {
  model: TenantModel; onSay: (msg: string, bad?: boolean) => void
}) {
  const entries: Entry[] = [
    { label: 'Model', url: m.glb, ext: 'glb',
      what: 'what the web and Android show. Draco-compressed.' },
    { label: 'iPhone AR', url: m.usdz, ext: 'usdz',
      what: 'what Quick Look reads. iOS uses nothing else.' },
    { label: 'Poster', url: m.poster || '', ext: 'png',
      what: 'the still the card shows before the model loads.' },
  ].filter(e => !!e.url)

  const [sizes, setSizes] = useState<Record<string, number | null>>({})
  const [busy, setBusy] = useState('')

  // HEAD each one on open. Cheap, and the number is the point: a 40 MB GLB on a card is
  // the thing you want to notice before a diner does.
  useEffect(() => {
    let dead = false
    ;(async () => {
      const found: Record<string, number | null> = {}
      for (const e of entries) found[e.ext] = await sizeOf(e.url)
      if (!dead) setSizes(found)
    })()
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.glb, m.usdz, m.poster])

  async function get(e: Entry) {
    setBusy(e.ext)
    const name = fileName(m.title, m.variant, e.ext)
    const err = await saveAs(e.url, name)
    setBusy('')
    onSay(err ?? `Saved ${name}`, !!err)
  }

  return (
    <div className="rounded-lg p-3 grid gap-2" style={{ background: 'var(--card2)' }}>
      {entries.map(e => (
        <div key={e.ext} className="flex items-center gap-3 text-[11px]">
          <div className="flex-1 min-w-0">
            <div className="font-semibold" style={{ color: 'var(--text)' }}>
              {e.label}
              {sizes[e.ext] !== undefined && sizes[e.ext] !== null && (
                <span className="font-normal ml-1.5" style={{ color: 'var(--dim)' }}>
                  {humanSize(sizes[e.ext])}
                </span>
              )}
            </div>
            <div style={{ color: 'var(--dim)' }}>{e.what}</div>
          </div>
          <button type="button" className="btn btn-sm" disabled={busy === e.ext}
                  onClick={() => void get(e)}>
            {busy === e.ext ? 'Saving…' : 'Download'}
          </button>
        </div>
      ))}
      <p className="text-[10px] pt-1" style={{ color: 'var(--dim)', borderTop: '1px solid var(--border)' }}>
        The master this was optimised from is not here — it is 60–100 MB and lives in the
        engine&rsquo;s bucket, never in a browser.
      </p>
    </div>
  )
}
