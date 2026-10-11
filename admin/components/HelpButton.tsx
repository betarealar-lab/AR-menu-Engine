'use client'
// "Need help?" - an owner's line to BetaReal (0043). Pressing it files a help request on
// our to-do list with the restaurant and who asked; one of us calls or messages them.
// Nothing is sent from here: the request on our list is the whole notification.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '@/components/Icon'
import { helpStatus, requestHelp, ago } from '@/lib/data/todos'

export default function HelpButton({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [sentAt, setSentAt] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let dead = false
    helpStatus(tenantId).then(at => { if (!dead) setSentAt(at) })
    return () => { dead = true }
  }, [tenantId])

  async function send() {
    setSending(true); setError('')
    const { at, error } = await requestHelp(tenantId, msg)
    setSending(false)
    if (error) { setError(error); return }
    setSentAt(at); setMsg('')
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-left"
              style={{ color: sentAt ? 'var(--gold)' : 'var(--dim)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--card2)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
        <Icon name="help" />
        <span>{sentAt ? 'Help requested' : 'Need help?'}</span>
      </button>

      {/* Portalled to <body>: the sidebar is transformed (it slides on phones), and a
          transformed ancestor traps `position: fixed` inside it. */}
      {open && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.55)' }}
             onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Need help?">
          <div className="card p-5 w-full max-w-md grid gap-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold">Need help?</h2>
              <button onClick={() => setOpen(false)} aria-label="Close"
                      className="text-xl leading-none" style={{ color: 'var(--dim)' }}>×</button>
            </div>
            {sentAt && (
              <p className="text-sm" style={{ color: 'var(--gold)' }}>
                Sent {ago(sentAt)}. BetaReal will call or message you soon.
              </p>
            )}
            <p className="text-sm" style={{ color: 'var(--dim)' }}>
              Tell us what&apos;s wrong or what you need, if you like. We&apos;ll get in touch by phone or email.
            </p>
            <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={3} maxLength={1000}
                      placeholder="Optional message" aria-label="Message" />
            {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">Close</button>
              <button onClick={send} disabled={sending} className="btn btn-primary btn-sm">
                {sending ? 'Sending…' : sentAt ? 'Send again' : 'Ask for help'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
