'use client'
// "On your website" - the Share page's answer to a restaurant that already has a site.
//
// Every dish with an approved 3D model gets a Copy code button. That button is the product
// for most people who will use this: an owner, or whoever "does the website", pasting one
// block into an HTML box. So the list is the whole screen and the explanation is one line
// plus a link to the step-by-step page on the menu app (/help/embed).
//
// The settings card - on/off and which websites may show the dishes - is BetaReal's, not the
// owner's: it is the lever for a restaurant that stops paying, and an owner must not be
// able to pull it back. The database enforces that (0028: tenant_embed_write is
// is_super_admin()); hiding the card from owners is only so nobody meets a form that
// cannot save.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { loadMenu, type MenuItem } from '@/lib/data/menu'
import { embedSnippet, dishLink, parseSites, menuOrigin } from '@/lib/embed'
import { useLang } from '@/lib/useLang'
import { text } from '@/lib/i18n'

export default function EmbedSection({ tenantId, isSuper }: { tenantId: string; isSuper: boolean }) {
  const [T, lang] = useLang()
  const [items, setItems] = useState<MenuItem[] | null>(null)
  const [copied, setCopied] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const origin = menuOrigin()

  useEffect(() => {
    let live = true
    loadMenu(tenantId)
      .then(m => {
        if (!live) return
        // What the embed page will actually show in 3D. Approval is checked again by the
        // page itself (public_dish) - an unapproved model there shows as a photo.
        setItems(m.items.filter(i => i.visible && i.is_3d && !i.text_only && i.model_id))
      })
      .catch(() => { if (live) setItems([]) })
    return () => { live = false }
  }, [tenantId])

  async function copy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      setTimeout(() => setCopied(c => (c === key ? '' : c)), 2000)
    } catch { /* the code is one click away in Preview either way */ }
  }

  const nameOf = (i: MenuItem) => (lang === 'ka' && i.name_ka) || i.name_en

  return (
    <div className="card p-5 mt-5 no-print">
      <div className="flex items-baseline gap-3 flex-wrap mb-1">
        <div className="font-semibold mr-auto">{T.embedTitle}</div>
        <a href={`${origin}/help/embed`} target="_blank" rel="noreferrer"
           className="text-xs" style={{ color: 'var(--gold)' }}>{T.embedHowTo} ↗</a>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--dim)' }}>{T.embedIntro}</p>

      {items === null && <p className="text-sm" style={{ color: 'var(--dim)' }}>Loading…</p>}
      {items && items.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--dim)' }}>{T.embedNone}</p>
      )}

      {items && items.length > 0 && (
        <div className="grid gap-2">
          {items.map(i => (
            <div key={i.id} className="rounded-lg p-3" style={{ border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-medium mr-auto">{nameOf(i)}</div>
                <button className="btn btn-sm" onClick={() => copy(`c:${i.id}`, embedSnippet(i.id, i.name_en, origin))}>
                  {copied === `c:${i.id}` ? T.embedCopied : T.embedCopyCode}
                </button>
                <button className="btn btn-sm" onClick={() => copy(`l:${i.id}`, dishLink(i.id, origin))}>
                  {copied === `l:${i.id}` ? T.embedCopied : T.embedCopyLink}
                </button>
                <button className="btn btn-sm" onClick={() => setPreview(p => (p === i.id ? null : i.id))}>
                  {preview === i.id ? T.embedHide : T.embedPreview}
                </button>
              </div>
              {preview === i.id && (
                <div className="grid gap-3 mt-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  {/* The real thing, framed exactly as it will be on their site. */}
                  <iframe src={dishLink(i.id, origin)} title={`${nameOf(i)} in 3D`}
                          allow="xr-spatial-tracking; fullscreen" allowFullScreen
                          style={{ display: 'block', width: '100%', aspectRatio: '4/3', border: 0, borderRadius: 12 }} />
                  <textarea readOnly value={embedSnippet(i.id, i.name_en, origin)}
                            onFocus={e => e.currentTarget.select()}
                            style={{ width: '100%', minHeight: 150, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 11 }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isSuper && <EmbedSettings tenantId={tenantId} />}
    </div>
  )
}

function EmbedSettings({ tenantId }: { tenantId: string }) {
  const [T] = useLang()
  const [active, setActive] = useState(true)
  const [sitesText, setSitesText] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'saving' | 'saved' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let live = true
    const supabase = createClient()
    supabase.from('tenant_embed').select('active, allowed_sites').eq('tenant_id', tenantId).maybeSingle()
      .then(({ data, error }) => {
        if (!live) return
        if (error) {
          // The table not existing yet means 0028 has not been applied to this database.
          const missing = error.code === '42P01' || error.code === 'PGRST205' || /tenant_embed/.test(error.message)
          setState(missing ? 'missing' : 'error')
          setMessage(missing ? '' : error.message)
          return
        }
        // No row is the default: on, allowed anywhere.
        setActive(data ? data.active !== false : true)
        setSitesText(((data?.allowed_sites as string[] | null) || []).join('\n'))
        setState('ready')
      })
    return () => { live = false }
  }, [tenantId])

  async function save() {
    const { sites, rejected } = parseSites(sitesText)
    if (rejected.length) {
      setState('error')
      setMessage(text(T.embedRejected, { list: rejected.join(', ') }))
      return
    }
    setState('saving')
    const supabase = createClient()
    const { error } = await supabase.from('tenant_embed').upsert(
      { tenant_id: tenantId, active, allowed_sites: sites, updated_utc: new Date().toISOString() },
      { onConflict: 'tenant_id' },
    )
    if (error) { setState('error'); setMessage(error.message); return }
    setSitesText(sites.join('\n'))
    setState('saved')
    setMessage('')
    setTimeout(() => setState(s => (s === 'saved' ? 'ready' : s)), 2000)
  }

  return (
    <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="eyebrow mb-2">{T.embedSettings}</div>
      {state === 'loading' && <p className="text-sm" style={{ color: 'var(--dim)' }}>Loading…</p>}
      {state === 'missing' && <p className="text-sm" style={{ color: 'var(--danger)' }}>{T.embedNotReady}</p>}
      {state !== 'loading' && state !== 'missing' && (
        <div className="grid gap-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              <span className="font-medium">{T.embedActive}</span>
              <span className="block text-xs" style={{ color: 'var(--dim)' }}>{T.embedActiveOff}</span>
            </span>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">{T.embedSites}</span>
            <textarea value={sitesText} onChange={e => setSitesText(e.target.value)}
                      placeholder="restaurant-x.ge" rows={3}
                      style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 13 }} />
            <span className="text-xs" style={{ color: 'var(--dim)' }}>{T.embedSitesHint}</span>
          </label>
          <div className="flex items-center gap-3">
            <button className="btn btn-sm" onClick={save} disabled={state === 'saving'}>
              {state === 'saved' ? T.embedSaved : T.embedSave}
            </button>
            {state === 'error' && <span className="text-xs" style={{ color: 'var(--danger)' }}>{message}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
