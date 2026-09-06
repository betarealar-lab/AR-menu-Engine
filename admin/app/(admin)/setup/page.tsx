'use client'
// The first ten minutes.
//
// Three steps, one thing each, and every one after the first can be skipped. An owner who
// finishes setup in one sitting stays; one who is shown an empty dashboard does not.
//
//   1. Pick a look      the two templates, previewed with THEIR name already on them
//   2. First dishes     name, price, category - three and you can move on
//   3. First 3D model   the same plate as the 3D screen, so the first one and the
//                       fortieth are the same experience
//   Done                the live address, and the QR code, right there
//
// The preview in step 1 is the real menu page in a frame, not a mockup. The restaurant
// already exists by the time this screen loads, so the menu app renders it - which means
// what the owner is choosing between is exactly what a diner will see.
//
// "Import from a file" is a visible button that says it is coming. The slot exists now so
// the flow does not change when import ships, and so an owner knows typing is a choice.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePlan } from '@/lib/usePlan'
import { createClient } from '@/lib/supabase/client'
import { loadLibrary } from '@/lib/data/models'
import { saveThemeConfig } from '@/lib/data/theme'
import Plate from '@/components/Plate'
import QrCode from '@/components/QrCode'

const MENU_ORIGIN = process.env.NEXT_PUBLIC_MENU_ORIGIN || ''

type Step = 'look' | 'dishes' | 'model' | 'done'
const ORDER: Step[] = ['look', 'dishes', 'model', 'done']

export default function SetupPage() {
  const plan = usePlan()
  const router = useRouter()
  const [step, setStep] = useState<Step>('look')
  const [msg, setMsg] = useState('')
  const say = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 4000) }

  const next = () => setStep(ORDER[ORDER.indexOf(step) + 1])

  async function finish() {
    if (plan.restaurantId) {
      await createClient().from('tenants').update({ setup_done: true }).eq('id', plan.restaurantId)
    }
    router.push(`/home?tenant=${plan.restaurantSlug}`)
  }

  if (plan.loading) return <p style={{ color: 'var(--dim)' }}>Loading…</p>
  if (!plan.restaurantId) return <p style={{ color: 'var(--dim)' }}>Pick a restaurant first.</p>

  return (
    <div className="page-content max-w-4xl">
      <div className="flex items-center gap-2 mb-6">
        {ORDER.slice(0, 3).map((s, i) => {
          const done = ORDER.indexOf(step) > i
          const here = step === s
          return (
            <div key={s} className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold"
                    style={{ background: done || here ? 'var(--gold)' : 'var(--card2)',
                             color: done || here ? 'var(--gold-ink)' : 'var(--dim)' }}>
                {done ? '✓' : i + 1}
              </span>
              <span className="text-xs font-semibold"
                    style={{ color: here ? 'var(--text)' : 'var(--dim)' }}>
                {s === 'look' ? 'Look' : s === 'dishes' ? 'Dishes' : '3D'}
              </span>
              {i < 2 && <span className="w-6 h-px mx-1" style={{ background: 'var(--border)' }} />}
            </div>
          )
        })}
      </div>

      {msg && <div className="card px-4 py-3 mb-5 text-sm">{msg}</div>}

      {step === 'look'   && <Look plan={plan} onNext={next} onSay={say} />}
      {step === 'dishes' && <Dishes tenantId={plan.restaurantId} onNext={next} onSay={say} />}
      {step === 'model'  && <FirstModel tenantId={plan.restaurantId} onNext={next} onSay={say} />}
      {step === 'done'   && <Done plan={plan} onFinish={finish} />}
    </div>
  )
}

// ── 1 · look ─────────────────────────────────────────────────────────────────

function Look({ plan, onNext, onSay }: {
  plan: ReturnType<typeof usePlan>
  onNext: () => void
  onSay: (m: string) => void
}) {
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([])
  const [current, setCurrent] = useState<string>('')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from('templates').select('id, name').eq('listed', true).order('name'),
      supabase.from('tenants').select('template_id').eq('id', plan.restaurantId!).single(),
    ]).then(([{ data: tpl }, { data: t }]) => {
      setTemplates(tpl || [])
      setCurrent((t?.template_id as string) || tpl?.[0]?.id || '')
    })
  }, [plan.restaurantId])

  async function pick(id: string) {
    setCurrent(id)
    // Both the column and the settings key, because the renderer reads template_key the
    // way the live restaurants store it and everything else joins on the column.
    const err = await saveThemeConfig(plan.restaurantId!, { template_key: id })
    if (err) return onSay(err.message)
    setNonce(n => n + 1)          // reload the frame; it is the real page
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
      <div>
        <h1 className="text-xl font-bold mb-1">Pick a look</h1>
        <p className="text-sm mb-5" style={{ color: 'var(--dim)' }}>
          This is your real menu, with your name on it. Colours, fonts and photos can all
          be changed later — this is just the shape.
        </p>
        <div className="grid gap-2">
          {templates.map(t => (
            <button key={t.id} onClick={() => pick(t.id)}
                    className="text-left px-4 py-3 rounded-lg text-sm font-semibold transition-colors"
                    style={{ border: `1px solid ${current === t.id ? 'var(--gold)' : 'var(--border)'}`,
                             background: current === t.id ? 'var(--gold-dim)' : 'var(--card)',
                             color: current === t.id ? 'var(--gold)' : 'var(--text)' }}>
              {t.name}
            </button>
          ))}
        </div>
        <button className="btn btn-primary w-full mt-5" onClick={onNext}>
          Use this one
        </button>
      </div>

      <div className="card overflow-hidden" style={{ minHeight: 560 }}>
        <iframe key={nonce} title="Your menu"
                src={`${MENU_ORIGIN}/${plan.restaurantSlug}`}
                className="w-full h-[560px] border-0" />
      </div>
    </div>
  )
}

// ── 2 · dishes ───────────────────────────────────────────────────────────────

type Row = { name: string; price: string; category: string }

function Dishes({ tenantId, onNext, onSay }: {
  tenantId: string
  onNext: () => void
  onSay: (m: string) => void
}) {
  const [rows, setRows] = useState<Row[]>([
    { name: '', price: '', category: '' },
    { name: '', price: '', category: '' },
    { name: '', price: '', category: '' },
  ])
  const [saving, setSaving] = useState(false)
  const filled = rows.filter(r => r.name.trim()).length

  function set(i: number, patch: Partial<Row>) {
    setRows(rs => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)))
  }

  async function save(andNext: boolean) {
    const supabase = createClient()
    setSaving(true)

    // Categories are made from whatever was typed, in the order they first appeared. An
    // owner typing "Starters" three times means one category, not three.
    const names = [...new Set(rows.map(r => r.category.trim()).filter(Boolean))]
    const catId = new Map<string, string>()
    for (let i = 0; i < names.length; i++) {
      const { data } = await supabase.from('categories')
        .insert({ tenant_id: tenantId, name: names[i], position: i }).select('id').single()
      if (data) catId.set(names[i], data.id)
    }

    const items = rows.filter(r => r.name.trim()).map((r, i) => {
      // Minor units where the price is a plain number; text where it is not ("16 / 70").
      const plain = r.price.replace(/[^\d.,]/g, '').replace(',', '.')
      const simple = /^\d+(\.\d{1,2})?$/.test(plain)
      return {
        tenant_id: tenantId,
        name: r.name.trim(),
        price_minor: simple ? Math.round(parseFloat(plain) * 100) : 0,
        price_text: simple ? null : (r.price.trim() || null),
        category_id: catId.get(r.category.trim()) ?? null,
        position: i,
        visible: true,
        // A dish typed in setup has no model yet. It is a photo dish until it has one.
        is_3d: false,
      }
    })
    if (items.length) {
      const { error } = await supabase.from('items').insert(items)
      if (error) { setSaving(false); return onSay(error.message) }
    }
    setSaving(false)
    if (andNext) onNext()
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Your first dishes</h1>
      <p className="text-sm mb-5" style={{ color: 'var(--dim)' }}>
        Three is enough to start. The rest can wait — and there is a full editor for it.
      </p>

      <div className="card p-4">
        <div className="hidden sm:grid grid-cols-[1fr_120px_160px] gap-2 mb-2 px-1">
          <span className="eyebrow">Dish</span>
          <span className="eyebrow">Price</span>
          <span className="eyebrow">Category</span>
        </div>
        <div className="grid gap-2">
          {rows.map((r, i) => (
            <div key={i} className="grid sm:grid-cols-[1fr_120px_160px] gap-2">
              <input value={r.name} placeholder="Khachapuri" autoFocus={i === 0}
                     onChange={e => set(i, { name: e.target.value })} />
              <input value={r.price} placeholder="18" inputMode="decimal"
                     onChange={e => set(i, { price: e.target.value })} />
              <input value={r.category} placeholder="Starters" list="cats"
                     onChange={e => set(i, { category: e.target.value })} />
            </div>
          ))}
        </div>
        <datalist id="cats">
          {[...new Set(rows.map(r => r.category.trim()).filter(Boolean))].map(c =>
            <option key={c} value={c} />)}
        </datalist>
        <button className="btn btn-ghost btn-sm mt-3"
                onClick={() => setRows(rs => [...rs, { name: '', price: '', category: '' }])}>
          + Another dish
        </button>
      </div>

      <div className="flex items-center gap-3 mt-5 flex-wrap">
        <button className="btn btn-primary" onClick={() => save(true)} disabled={saving || !filled}>
          {saving ? 'Saving…' : `Save ${filled || ''} and continue`}
        </button>
        <button className="btn btn-ghost" onClick={onNext}>Skip for now</button>
        <span className="ml-auto text-xs" style={{ color: 'var(--dim)' }}>
          <button className="underline" disabled title="Coming soon">Import from a file</button>
          {' '}· coming soon
        </span>
      </div>
    </div>
  )
}

// ── 3 · first model ──────────────────────────────────────────────────────────

function FirstModel({ tenantId, onNext, onSay }: {
  tenantId: string
  onNext: () => void
  onSay: (m: string) => void
}) {
  const [dishes, setDishes] = useState<{ id: string; name: string }[]>([])
  const [quota, setQuota] = useState(0)
  const [used, setUsed] = useState(0)

  const load = useCallback(async () => {
    const d = await loadLibrary(tenantId)
    setDishes(d.dishes)
    setQuota(d.quota)
    setUsed(d.used)
  }, [tenantId])
  useEffect(() => { void load() }, [load])

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Your first 3D model</h1>
      <p className="text-sm mb-5" style={{ color: 'var(--dim)' }}>
        Four photos of one dish, from four sides. A phone is fine. It takes a few
        minutes to build, and you can keep going while it does.
      </p>

      <Plate tenantId={tenantId} dishes={dishes} left={Math.max(0, quota - used)}
             quota={quota} compact
             onError={onSay}
             onSent={() => { onSay('Building. It will be in your library in a few minutes.'); onNext() }} />

      <div className="mt-5">
        <button className="btn btn-ghost" onClick={onNext}>Skip for now</button>
      </div>
    </div>
  )
}

// ── done ─────────────────────────────────────────────────────────────────────

function Done({ plan, onFinish }: {
  plan: ReturnType<typeof usePlan>
  onFinish: () => void
}) {
  const url = `${MENU_ORIGIN}/${plan.restaurantSlug}`
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_260px] items-start">
      <div>
        <h1 className="text-xl font-bold mb-1">Your menu is live.</h1>
        <p className="text-sm mb-5" style={{ color: 'var(--dim)' }}>
          Anyone who scans the code, or opens the address, sees it now. Everything you did
          here can be changed from the menu.
        </p>
        <div className="card p-4 mb-4">
          <div className="eyebrow mb-1">Address</div>
          <a href={url} target="_blank" rel="noreferrer" className="text-sm font-semibold break-all"
             style={{ color: 'var(--gold)' }}>{url}</a>
        </div>
        <button className="btn btn-primary" onClick={onFinish}>Go to my menu</button>
      </div>
      <div className="card p-4 text-center">
        <QrCode value={url} size={200} />
        <p className="text-xs mt-3" style={{ color: 'var(--dim)' }}>
          Print-ready sizes are under QR &amp; share.
        </p>
      </div>
    </div>
  )
}
