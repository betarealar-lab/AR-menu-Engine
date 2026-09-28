'use client'
// Change history, and undo.
//
// Rebuilt 2026-09-28 (Temo: "change history is not working"). The screen before this was
// ported from the platform and read a `change_history` table keyed on `restaurant_id` that
// the rebuild never had, so every visit ended in "not set up". 0036 records every change
// with triggers - dishes, categories, the theme and settings key by key, the restaurant,
// models, dish pages - with WHO made it, and `revert_change` puts one back through the
// same rules a person editing it would meet. An undo is itself recorded.

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLang } from '@/lib/useLang'
import { usePlan } from '@/lib/usePlan'
import { text } from '@/lib/i18n'
import LockedCard from '@/components/LockedCard'

type Change = {
  id: number
  source: 'item' | 'category' | 'theme' | 'settings' | 'restaurant' | 'model' | 'dish_page'
  record_id: string | null
  label: string | null
  field: string
  old_value: unknown
  new_value: unknown
  changed_at: string
  who: string
}
type Filter = 'all' | 'menu' | 'look' | 'restaurant' | 'model' | 'dish_page'

const PAGE = 100
const GROUP: Record<Change['source'], Filter> = {
  item: 'menu', category: 'menu', theme: 'look', settings: 'restaurant',
  restaurant: 'restaurant', model: 'model', dish_page: 'dish_page',
}

// Field names people read, in both languages. Theme keys ("day_accent") are prettified
// below instead - there are ~150 of them and they already read well once split.
const FIELDS: Record<'en' | 'ka', Record<string, string>> = {
  en: {
    name: 'Name', description: 'Description', price_minor: 'Price', price_old_minor: 'Old price',
    price_text: 'Price text', visible: 'Shown on menu', is_3d: '3D', thumb_3d: 'Live 3D thumbnail',
    model_id: 'Model', photo_key: 'Photo', category_id: 'Category', i18n: 'Translations',
    text_only: 'Text only', featured: 'Featured', variants: 'Sizes', addons: 'Add-ons',
    currency: 'Currency', tenant_state: 'Approval', tenant_id: 'Owner', archived: 'Retired',
    view_orbit: 'Camera angle', scale_cm: 'Size (cm)', scale_axis: 'Size axis', title: 'Title',
    shared: 'In the library', active: 'Dish page live', address: 'Dish page address',
    all_pages_active: 'All dish pages live', embed_active: 'Website embeds on', slug: 'Address',
    template_id: 'Template', languages: 'Languages', studio: '3D Studio', model_quota: 'Free models',
    setup_done: 'Setup finished', country: 'Country', draco_key: 'Web model file', usdz_key: 'iPhone AR file',
    poster_key: 'Poster', width_cm: 'Width (cm)', length_cm: 'Length (cm)', height_cm: 'Height (cm)',
    source_ref: 'Import reference', photo_source_url: 'Photo source',
  },
  ka: {
    name: 'სახელი', description: 'აღწერა', price_minor: 'ფასი', price_old_minor: 'ძველი ფასი',
    price_text: 'ფასის ტექსტი', visible: 'მენიუში ჩანს', is_3d: '3D', thumb_3d: 'ცოცხალი 3D მინიატურა',
    model_id: 'მოდელი', photo_key: 'ფოტო', category_id: 'კატეგორია', i18n: 'თარგმანები',
    text_only: 'მხოლოდ ტექსტი', featured: 'გამორჩეული', variants: 'ზომები', addons: 'დამატებები',
    currency: 'ვალუტა', tenant_state: 'დამტკიცება', tenant_id: 'მფლობელი', archived: 'არქივში',
    view_orbit: 'კამერის კუთხე', scale_cm: 'ზომა (სმ)', scale_axis: 'ზომის ღერძი', title: 'სათაური',
    shared: 'ბიბლიოთეკაში', active: 'კერძის გვერდი ჩართულია', address: 'კერძის გვერდის მისამართი',
    all_pages_active: 'ყველა კერძის გვერდი', embed_active: 'საიტზე ჩასმა', slug: 'მისამართი',
    template_id: 'შაბლონი', languages: 'ენები', studio: '3D სტუდია', model_quota: 'უფასო მოდელები',
    setup_done: 'დაყენება დასრულდა', country: 'ქვეყანა', draco_key: 'ვებ მოდელის ფაილი', usdz_key: 'iPhone AR ფაილი',
    poster_key: 'პოსტერი', width_cm: 'სიგანე (სმ)', length_cm: 'სიგრძე (სმ)', height_cm: 'სიმაღლე (სმ)',
    source_ref: 'იმპორტის მითითება', photo_source_url: 'ფოტოს წყარო',
  },
}

function prettyField(field: string, lang: 'en' | 'ka') {
  if (FIELDS[lang][field]) return FIELDS[lang][field]
  const mode = field.startsWith('day_') ? (lang === 'ka' ? 'დღე' : 'Day')
    : field.startsWith('night_') ? (lang === 'ka' ? 'ღამე' : 'Night') : ''
  const rest = field.replace(/^(day|night)_/, '').replace(/_/g, ' ')
  const name = rest.charAt(0).toUpperCase() + rest.slice(1)
  return mode ? `${mode} · ${name}` : name
}

/** A stored value as a person reads it. Prices are integers in tetri (MENU-PLATFORM §9.4). */
function show(v: unknown, field: string, lang: 'en' | 'ka'): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? (lang === 'ka' ? 'კი' : 'Yes') : (lang === 'ka' ? 'არა' : 'No')
  if (typeof v === 'number' && /price.*minor/.test(field)) return `${(v / 100).toFixed(2).replace(/\.00$/, '')} ₾`
  if (typeof v === 'string') return v.trim() ? (v.length > 60 ? v.slice(0, 58) + '…' : v) : (lang === 'ka' ? '(ცარიელი)' : '(empty)')
  const s = JSON.stringify(v)
  return s.length > 60 ? s.slice(0, 58) + '…' : s
}

const isColor = (v: unknown) => typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim())

function timeAgo(iso: string, T: { historyJustNow: string; historyMinutesAgo: string; historyHoursAgo: string; historyDaysAgo: string }) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return T.historyJustNow
  if (mins < 60) return T.historyMinutesAgo.replace('{n}', String(mins))
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return T.historyHoursAgo.replace('{n}', String(hrs))
  return T.historyDaysAgo.replace('{n}', String(Math.floor(hrs / 24)))
}

export default function HistoryPage() {
  const [T, lang] = useLang()
  const plan = usePlan()
  const [rows, setRows] = useState<Change[]>([])
  const [more, setMore] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState<Filter>('all')
  const [library, setLibrary] = useState(false)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [err, setErr] = useState('')

  const isSuper = plan.role === 'super_admin'
  const key = `${plan.restaurantId}:${library}:${version}`
  const loading = plan.loading || loadedKey !== key

  const fetchPage = useCallback(async (before: number | null) => {
    const { data, error } = await createClient().rpc('change_history_list', {
      p_tenant: plan.restaurantId, p_library: library, p_limit: PAGE, p_before: before,
    })
    return { rows: (data as Change[]) || [], error: error?.message || '' }
  }, [plan.restaurantId, library])

  useEffect(() => {
    if (plan.loading || (!plan.restaurantId && !library)) return
    let dead = false
    fetchPage(null).then(r => {
      if (dead) return
      setRows(r.rows); setMore(r.rows.length === PAGE); setErr(r.error)
      setPicked(new Set()); setLoadedKey(key)
    })
    return () => { dead = true }
  }, [plan.loading, plan.restaurantId, library, fetchPage, key])

  async function older() {
    const last = rows[rows.length - 1]
    if (!last) return
    const r = await fetchPage(last.id)
    setRows(x => [...x, ...r.rows]); setMore(r.rows.length === PAGE)
  }

  async function undo(ids: number[]) {
    setBusy(true); setMsg(null); setConfirming(false)
    let done = 0
    const fails: string[] = []
    // Newest first: several changes to one field unwind in the order they were made.
    for (const id of [...ids].sort((a, b) => b - a)) {
      const { error } = await createClient().rpc('revert_change', { p_id: id })
      if (error) fails.push(error.message); else done++
    }
    setBusy(false)
    setMsg(fails.length
      ? { text: `${T.historyReverted.replace('{n}', String(done))} ${T.historyRevertFailed} ${fails[0]}`, bad: true }
      : { text: T.historyReverted.replace('{n}', String(done)) })
    setVersion(v => v + 1)
  }

  if (!plan.loading && !plan.restaurantId && !library) {
    return <LockedCard title={T.historyLockedTitle} description={T.noRestaurantSelected} planLabel={plan.label} />
  }

  const shown = rows.filter(r => filter === 'all' || GROUP[r.source] === filter)
  const FILTERS: [Filter, string][] = [
    ['all', T.historyAll], ['menu', T.historySourceMenu], ['look', T.historySourceTheme],
    ['restaurant', T.historySourceRestaurant], ['model', T.historySourceModels], ['dish_page', T.historySourceDishPages],
  ]
  const L = lang === 'ka' ? 'ka' : 'en'

  return (
    <div>
      <h1 className="page-title mb-1">{T.historyTitle}</h1>
      <p className="text-sm mb-5" style={{ color: 'var(--dim)' }}>
        {library ? T.historyLibraryIntro : T.historyIntro}
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {FILTERS.map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} className="text-xs px-3 py-1.5 rounded-full"
                  style={{ background: filter === id ? 'var(--gold-dim)' : 'var(--card2)',
                           color: filter === id ? 'var(--gold)' : 'var(--dim)',
                           border: `1px solid ${filter === id ? 'var(--gold)' : 'var(--border)'}` }}>
            {label}
          </button>
        ))}
        {isSuper && (
          <label className="text-xs flex items-center gap-2 ml-auto" style={{ color: 'var(--dim)' }}>
            <input type="checkbox" checked={library} onChange={e => setLibrary(e.target.checked)} style={{ width: 'auto' }} />
            {T.historyLibraryToggle}
          </label>
        )}
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {confirming ? (
          <>
            <span className="text-sm">{T.historyRevertConfirm.replace('{n}', String(picked.size))}</span>
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => undo([...picked])}>{T.historyUndo}</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>{T.cancel}</button>
          </>
        ) : (
          <button className="btn btn-sm btn-primary" disabled={busy || !picked.size} onClick={() => setConfirming(true)}>
            {T.historyRevertSelected.replace('{n}', String(picked.size))}
          </button>
        )}
        <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setVersion(v => v + 1)}>{T.historyRefresh}</button>
        {msg && <span className="text-sm" style={{ color: msg.bad ? 'var(--danger)' : 'var(--success)' }}>{msg.text}</span>}
      </div>

      {err && <div className="card p-4 text-sm mb-3" style={{ color: 'var(--danger)' }}>{err}</div>}
      {loading && <div className="card p-6 text-sm" style={{ color: 'var(--dim)' }}>{T.loading}</div>}
      {!loading && !shown.length && !err && (
        <div className="card p-6 text-sm" style={{ color: 'var(--dim)' }}>{T.historyEmpty}</div>
      )}

      <ul className="grid gap-2 list-none p-0">
        {!loading && shown.map(r => {
          const on = picked.has(r.id)
          const created = r.field === '__created__'
          const deleted = r.field === '__deleted__'
          const canUndo = !(r.source === 'dish_page' && r.field === 'address') && !(r.source === 'model' && created)
          return (
            <li key={r.id} className="card p-3" style={{ borderColor: on ? 'var(--gold)' : undefined }}>
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={on} disabled={!canUndo} aria-label={T.historyUndo}
                       onChange={() => setPicked(p => { const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n })}
                       className="mt-1 shrink-0" style={{ width: 16, height: 16, accentColor: 'var(--gold)' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--dim)' }}>
                    {FILTERS.find(f => f[0] === GROUP[r.source])?.[1]}
                    {r.label ? ` · ${r.label}` : ''}
                    {!created && !deleted && ` · ${prettyField(r.field, L)}`}
                  </div>
                  {created ? (
                    <div className="text-sm" style={{ color: 'var(--success)' }}>{T.historyCreated}</div>
                  ) : deleted ? (
                    <div className="text-sm" style={{ color: 'var(--danger)' }}>{T.historyItemDeleted}</div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <Value v={r.old_value} field={r.field} lang={L} />
                      <span style={{ color: 'var(--dim)' }}>→</span>
                      <Value v={r.new_value} field={r.field} lang={L} />
                    </div>
                  )}
                  <div className="text-xs mt-1" style={{ color: 'var(--dim)' }}>
                    {timeAgo(r.changed_at, T)} · {new Date(r.changed_at).toLocaleString(L === 'ka' ? 'ka-GE' : 'en-GB')} · {r.who}
                  </div>
                </div>
                {canUndo && (
                  <button className="btn btn-sm btn-ghost shrink-0" disabled={busy} onClick={() => undo([r.id])}>
                    {deleted ? T.historyRestore : created ? T.historyRemove : T.historyUndo}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {!loading && more && (
        <button className="btn btn-sm btn-ghost mt-4" onClick={older}>{T.historyOlder}</button>
      )}
      {!loading && rows.length > 0 && (
        <p className="text-xs mt-4" style={{ color: 'var(--dim)' }}>{text(T.historyCount, { n: rows.length })}</p>
      )}
    </div>
  )
}

// Colours get a swatch so "which blue was it?" is answerable at a glance.
function Value({ v, field, lang }: { v: unknown; field: string; lang: 'en' | 'ka' }) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      {isColor(v) && (
        <span style={{ width: 14, height: 14, borderRadius: 3, background: v as string,
                       border: '1px solid var(--border)', display: 'inline-block' }} />
      )}
      <code className="truncate" style={{ fontSize: '0.8rem', color: 'var(--text)', maxWidth: '28rem' }}>{show(v, field, lang)}</code>
    </span>
  )
}
