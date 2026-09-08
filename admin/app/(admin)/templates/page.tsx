'use client'
// Templates, for us.
//
// A template is two halves that live in different places, and the point of this screen is
// to stop that being a surprise:
//
//   the STYLESHEET   shipped in the menu app (app/src/lib/css/<id>.css). It decides the
//                    SHAPE - card layout, the hero band, where a price sits. Adding one is
//                    design work and a deploy, not a form, and pretending otherwise would
//                    let somebody create a "template" that silently renders as Monday
//                    Greens on a client's menu.
//   the PALETTE      the `defaults` on the row: what a NEW restaurant starts with before
//                    anyone opens the theme editor. Data. Safe to change, because it only
//                    ever seeds - a restaurant that already exists has its own saved
//                    palette and is untouched.
//
// So this screen edits palettes and names freely, and is explicit about which ids have a
// stylesheet behind them.
//
// The boundary is the database, not this file: `templates_write` is `is_super_admin()`.
// 0021 added the grant that policy had been missing since it was written - which is why
// this screen could not have worked before today.

import { useCallback, useEffect, useState } from 'react'
import { usePlan } from '@/lib/usePlan'
import {
  loadTemplates, saveTemplate, createTemplate, deleteTemplate,
  normalizeTemplateId, SHIPPED_STYLESHEETS, type Template,
} from '@/lib/data/templates'

export default function TemplatesPage() {
  const plan = usePlan()
  const [rows, setRows] = useState<Template[]>([])
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [msg, setMsg] = useState('')
  const say = useCallback((m: string) => {
    setMsg(m); setTimeout(() => setMsg(''), 4000)
  }, [])

  const load = useCallback(async () => {
    if (plan.loading) return
    setRows(await loadTemplates())
    setLoadedOnce(true)
  }, [plan.loading])

  useEffect(() => { void Promise.resolve().then(load) }, [load])

  if (plan.loading) return <p style={{ color: 'var(--dim)' }}>Loading…</p>
  if (!plan.canManageTenants) {
    // The same shape as the developer screens: an empty room, not an error that confirms
    // there is something here to find.
    return <p style={{ color: 'var(--dim)' }}>Nothing here.</p>
  }

  return (
    <div className="page-content max-w-4xl">
      <h1 className="text-2xl font-bold mb-1">Templates</h1>
      <p className="text-sm mb-5" style={{ color: 'var(--dim)' }}>
        A template is a stylesheet plus a starting palette. The stylesheet ships with the
        menu app and decides the shape; the palette is here, and only ever seeds a new
        restaurant — changing it never touches one that already exists.
      </p>

      {msg && <div className="card px-4 py-3 mb-4 text-sm">{msg}</div>}

      <div className="grid gap-3">
        {rows.map(t => <TemplateCard key={t.id} row={t} onSay={say} onChanged={load} />)}
      </div>

      {loadedOnce && rows.length === 0 && (
        <p className="card p-8 text-center text-sm" style={{ color: 'var(--dim)' }}>
          No templates. That should not be possible — the menu app needs at least one.
        </p>
      )}

      <NewTemplate rows={rows} onSay={say} onChanged={load} />
    </div>
  )
}

function TemplateCard({ row, onSay, onChanged }: {
  row: Template; onSay: (m: string) => void; onChanged: () => void
}) {
  const [name, setName] = useState(row.name)
  const [open, setOpen] = useState(false)
  const hasSheet = (SHIPPED_STYLESHEETS as readonly string[]).includes(row.id)
  const keys = Object.keys(row.defaults)

  async function patch(p: Parameters<typeof saveTemplate>[1], said: string) {
    const err = await saveTemplate(row.id, p)
    if (err) { onSay(`Could not save: ${err.message}`); return }
    onSay(said)
    onChanged()
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-3 flex-wrap">
        <input value={name} onChange={e => setName(e.target.value)}
               onBlur={() => {
                 if (name.trim() && name !== row.name) {
                   void patch({ name: name.trim() }, `Renamed to ${name.trim()}`)
                 }
               }}
               aria-label={`Name of ${row.id}`}
               className="font-semibold bg-transparent border-0 p-0 rounded-none text-[15px]"
               style={{ boxShadow: 'none', width: 'auto', minWidth: 140 }} />
        <code className="text-xs" style={{ color: 'var(--dim)' }}>{row.id}</code>

        {/* The fact that decides whether this template is real. */}
        {hasSheet
          ? <span className="pill pill-on">stylesheet</span>
          : <span className="pill pill-off"
                  title="No stylesheet ships for this id, so a menu on it renders as Monday Greens">
              no stylesheet
            </span>}

        <span className="text-xs" style={{ color: 'var(--dim)' }}>
          {row.used === 0 ? 'no restaurants'
            : row.used === 1 ? '1 restaurant' : `${row.used} restaurants`}
        </span>

        <label className="flex items-center gap-1.5 text-xs ml-auto cursor-pointer"
               style={{ color: 'var(--dim)' }}>
          <input type="checkbox" checked={row.listed} style={{ width: 'auto' }}
                 onChange={e => void patch({ listed: e.target.checked },
                   e.target.checked
                     ? `${row.name} is offered to owners`
                     : `${row.name} is hidden from owners`)} />
          offered to owners
        </label>
      </div>

      {!hasSheet && (
        <p className="text-[11px] mt-2" style={{ color: 'var(--gold)' }}>
          No stylesheet ships for <code>{row.id}</code>, so a restaurant on it renders as
          Monday Greens. Adding one is a file in <code>app/src/lib/css</code> and a deploy.
        </p>
      )}

      <div className="flex gap-3 text-[11px] mt-2" style={{ color: 'var(--dim)' }}>
        <button className="underline" onClick={() => setOpen(!open)}>
          {open ? 'close' : `starting palette · ${keys.length} ${keys.length === 1 ? 'key' : 'keys'}`}
        </button>
        {row.used === 0 && (
          <button className="underline ml-auto" style={{ color: 'var(--danger)' }}
                  onClick={async () => {
                    if (!confirm(`Delete the template "${row.name}"? No restaurant uses it.`)) return
                    const err = await deleteTemplate(row.id)
                    onSay(err ? `Could not delete: ${err.message}` : `Deleted ${row.name}`)
                    onChanged()
                  }}>delete</button>
        )}
      </div>

      {open && <Defaults row={row} onSay={onSay} onChanged={onChanged} />}
    </div>
  )
}

/** The starting palette, as the key/value pairs it actually is.
 *
 *  Deliberately not forty labelled colour pickers: that screen exists already, in the
 *  theme editor, against a live preview of a real menu. What is being edited HERE is a
 *  default, by somebody who is reading `day_bg` in a stylesheet or a migration rather than
 *  looking at a swatch, so the raw bag is the honest control.
 */
function Defaults({ row, onSay, onChanged }: {
  row: Template; onSay: (m: string) => void; onChanged: () => void
}) {
  const [draft, setDraft] = useState(() => JSON.stringify(row.defaults, null, 2))
  const [saving, setSaving] = useState(false)

  async function save() {
    let parsed: Record<string, string>
    try {
      parsed = JSON.parse(draft)
      if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
        throw new Error('it has to be an object of key: "value" pairs')
      }
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v !== 'string') throw new Error(`"${k}" is not text`)
      }
    } catch (e) {
      onSay(`That is not a palette: ${(e as Error).message}`)
      return
    }
    setSaving(true)
    const err = await saveTemplate(row.id, { defaults: parsed })
    setSaving(false)
    if (err) { onSay(`Could not save: ${err.message}`); return }
    onSay(`${row.name}: ${Object.keys(parsed).length} starting values saved. `
      + 'Existing restaurants are unchanged.')
    onChanged()
  }

  return (
    <div className="mt-3 grid gap-2">
      <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={10}
                spellCheck={false} aria-label={`Starting palette for ${row.name}`}
                className="text-xs" style={{ fontFamily: 'ui-monospace, monospace' }} />
      <div className="flex items-center gap-3 flex-wrap">
        <button className="btn btn-sm btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save palette'}
        </button>
        <span className="text-[11px]" style={{ color: 'var(--dim)' }}>
          Seeds new restaurants only. Keys are theme keys — <code>day_bg</code>,{' '}
          <code>night_card</code>, <code>font_body</code>.
        </span>
      </div>
    </div>
  )
}

function NewTemplate({ rows, onSay, onChanged }: {
  rows: Template[]; onSay: (m: string) => void; onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [basedOn, setBasedOn] = useState('')
  const [busy, setBusy] = useState(false)
  const finalId = normalizeTemplateId(id || name)
  const taken = rows.some(r => r.id === finalId)
  const willRender = (SHIPPED_STYLESHEETS as readonly string[]).includes(finalId)

  async function make() {
    if (!name.trim() || !finalId) { onSay('It needs a name.'); return }
    if (taken) { onSay(`There is already a template called ${finalId}.`); return }
    setBusy(true)
    const err = await createTemplate({ id: finalId, name: name.trim(), basedOn: basedOn || null })
    setBusy(false)
    if (err) { onSay(`Could not create it: ${err.message}`); return }
    onSay(`Created ${name.trim()}. It is hidden from owners until you offer it.`)
    setOpen(false); setName(''); setId(''); setBasedOn('')
    onChanged()
  }

  if (!open) {
    return <button className="btn mt-4" onClick={() => setOpen(true)}>New template</button>
  }

  return (
    <div className="card p-4 mt-4 grid gap-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="eyebrow block mb-1">Name</span>
          <input value={name} onChange={e => setName(e.target.value)}
                 placeholder="Monday Greens, warm" />
        </label>
        <label className="block">
          <span className="eyebrow block mb-1">Id</span>
          <input value={id} onChange={e => setId(e.target.value)}
                 placeholder={finalId || 'monday_greens_warm'} />
        </label>
      </div>

      <label className="block">
        <span className="eyebrow block mb-1">Start from</span>
        <select value={basedOn} onChange={e => setBasedOn(e.target.value)}>
          <option value="">an empty palette</option>
          {rows.map(r => (
            <option key={r.id} value={r.id}>{r.name} — its palette</option>
          ))}
        </select>
      </label>

      {/* The one thing somebody could get badly wrong here, said before they do it. */}
      <p className="text-[11px]" style={{ color: willRender ? 'var(--dim)' : 'var(--gold)' }}>
        {willRender
          ? <>A stylesheet ships for <code>{finalId}</code>, so this renders as itself.</>
          : <>No stylesheet ships for <code>{finalId || '…'}</code>. A restaurant on it would
              render as Monday Greens with this palette. That is a real and useful thing — a
              recolour of a shape that already works — but it is not a new layout, and a new
              layout is a file in <code>app/src/lib/css</code> and a deploy.</>}
      </p>

      <div className="flex gap-2 items-center flex-wrap">
        <button className="btn btn-primary btn-sm" disabled={busy || !name.trim() || taken}
                onClick={() => void make()}>
          {busy ? 'Creating…' : 'Create'}
        </button>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
        {taken && (
          <span className="text-[11px]" style={{ color: 'var(--danger)' }}>
            {finalId} already exists
          </span>
        )}
      </div>
    </div>
  )
}
