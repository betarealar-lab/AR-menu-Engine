'use client'
// The preview: the real menu page, with the palette applied as it is typed.
//
// It replaces a hand-built mock - its own markup, emoji instead of dishes, and about
// twenty-five of the forty-one custom properties re-implemented by hand. That mock could
// not show a template's own CSS rules at all, so an owner was tuning colours against a
// drawing of their menu rather than against their menu. It also could not be wrong in a
// way anybody would notice, which is the worst property a preview can have.
//
// This is `/{slug}?preview=1` in a frame. The page carries a listener in that mode only
// (see [slug].astro) that takes a palette over postMessage and sets the custom properties
// on :root - which is exactly what the renderer does at publish time, so what is on screen
// is what a diner gets.
//
// Nothing is saved to show a preview. The frame is the unsaved state.

import { useCallback, useEffect, useRef, useState } from 'react'
import { VAR_MAP } from '@/lib/paletteVars'
import { PICK_MAP } from '@/lib/palette'
import { useLang } from '@/lib/useLang'

const MENU_ORIGIN = process.env.NEXT_PUBLIC_MENU_ORIGIN || ''

export type PreviewMode = 'night' | 'day'
export type PreviewDevice = 'phone' | 'desktop'

export default function ThemePreview({ slug, config, mode, onMode, template, onPick }: {
  slug: string
  config: Record<string, string>
  mode: PreviewMode
  onMode: (m: PreviewMode) => void
  template: string
  /** Tapping a part of the menu opens the row that governs its colour. */
  onPick?: (field: string) => void
}) {
  const [T] = useLang()
  const frame = useRef<HTMLIFrameElement>(null)
  const [device, setDevice] = useState<PreviewDevice>('phone')
  const [ready, setReady] = useState(false)
  const [nonce, setNonce] = useState(0)

  // The palette, as CSS custom properties. `VAR_MAP` is the platform's own varMap, key for
  // key - the same list the renderer uses - so a value that works here works published.
  const send = useCallback(() => {
    const win = frame.current?.contentWindow
    if (!win) return
    const vars: Record<string, string> = {}
    for (const [key, cssVar] of Object.entries(VAR_MAP)) {
      // A bare key is the fallback; the mode-prefixed one wins, which is how the
      // restaurants store it (68 keys, 34 of each).
      const v = config[`${mode}_${key}`] ?? config[key] ?? ''
      vars[cssVar] = v
    }
    // The two that are settings rather than colours but change the page just as visibly.
    if (config.hero_image_url) vars['--hero-image'] = `url("${config.hero_image_url}")`
    if (config.font_body) vars['--font-body'] = config.font_body
    if (config.font_heading) vars['--font-heading'] = config.font_heading

    win.postMessage({ type: 'br-theme', mode, template, vars }, MENU_ORIGIN || '*')
    // The click map goes with it. Sent from here rather than written into the page, so
    // one definition (lib/palette.ts) owns the label, the grouping and the target.
    win.postMessage({ type: 'br-pick-map', map: PICK_MAP }, MENU_ORIGIN || '*')
  }, [config, mode, template])

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (MENU_ORIGIN && e.origin !== MENU_ORIGIN) return
      const msg = e.data as { type?: string; field?: string }
      if (msg?.type === 'br-preview-ready') setReady(true)
      if (msg?.type === 'br-preview-pick' && msg.field) onPick?.(msg.field)
    }
    addEventListener('message', onMessage)
    return () => removeEventListener('message', onMessage)
  }, [onPick])

  // Post on every change, and once the frame says it is listening - otherwise the first
  // values go into a page that has not parsed its listener yet and are simply lost.
  useEffect(() => { if (ready) send() }, [ready, send])

  return (
    // Sticky on BOTH: pinned to the right of a wide screen, and pinned to the top of a
    // narrow one so it stays in sight while the controls scroll underneath it. A preview
    // you have to scroll back to is a preview you stop looking at.
    <div className="w-full xl:w-[420px] shrink-0 sticky top-0 xl:top-4 z-10 pb-3 xl:pb-0"
         style={{ background: 'var(--bg)' }}>
      <div className="flex items-center gap-2 mb-3 flex-wrap pt-3 xl:pt-0">
        <span className="eyebrow mr-auto">{T.previewWord}</span>

        <div className="flex rounded-lg p-0.5" style={{ background: 'var(--card2)' }}>
          {(['phone', 'desktop'] as PreviewDevice[]).map(d => (
            <button key={d} onClick={() => setDevice(d)}
                    className="px-2.5 py-1 rounded-md text-xs font-semibold transition-colors"
                    style={{ background: device === d ? 'var(--card)' : 'transparent',
                             color: device === d ? 'var(--text)' : 'var(--dim)' }}>
              {d === 'phone' ? 'Phone' : 'Desktop'}
            </button>
          ))}
        </div>

        <div className="flex rounded-lg p-0.5" style={{ background: 'var(--card2)' }}>
          {(['night', 'day'] as PreviewMode[]).map(m => (
            <button key={m} onClick={() => onMode(m)}
                    className="px-2.5 py-1 rounded-md text-xs font-semibold transition-colors"
                    style={{ background: mode === m ? 'var(--card)' : 'transparent',
                             color: mode === m ? 'var(--text)' : 'var(--dim)' }}>
              {m === 'night' ? 'Night' : 'Day'}
            </button>
          ))}
        </div>

        <button className="btn btn-sm btn-ghost" title={T.previewReload}
                onClick={() => { setReady(false); setNonce(n => n + 1) }}>
          ↻
        </button>
      </div>

      <div className="card overflow-hidden mx-auto transition-all"
           style={{ width: device === 'phone' ? 390 : '100%', maxWidth: '100%' }}>
        {/* Shorter on a narrow screen. A 680px frame pinned to the top of a laptop
            window leaves no room for the controls it is meant to help with. */}
        {/* Shorter on a narrow screen. A 680px frame pinned to the top of a laptop
            window leaves no room for the controls it is meant to help with. Two classes
            rather than an inline height, because the breakpoint cannot be expressed
            inline and a JS width listener would be a resize handler for a constant. */}
        <iframe
          key={nonce}
          ref={frame}
          title={T.yourMenu}
          src={`${MENU_ORIGIN}/${slug}?preview=1`}
          className={`w-full border-0 block h-[340px] ${
            device === 'phone' ? 'xl:h-[680px]' : 'xl:h-[620px]'}`}
          onLoad={() => send()}
        />
      </div>

      <p className="text-[11px] mt-2 text-center" style={{ color: 'var(--dim)' }}>
        Your real menu, with your dishes. Tap anything to open the colour that changes it.
      </p>
    </div>
  )
}
