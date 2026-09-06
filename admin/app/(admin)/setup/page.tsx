'use client'
// The first ten minutes. 3D first; the wait becomes the setup.
//
//   1. Your first 3D model     four photos, two minutes. The build starts.
//   2. Pick a look             while it builds - the real menu page, with their name on it
//   3. First dishes            while it builds - name, price, category
//   Done                       the model lands, on their menu, with a QR code
//
// The order is the design. The old flow asked for all the work first and showed the
// payoff last; nobody quits during a wait they are filling, and the magic arriving as the
// final step is the thing they remember. Every step after the first can be skipped.
//
// The look preview is the real menu page in a frame - the restaurant exists by then and
// the menu app renders it - so what they choose between is what a diner will see.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePlan } from '@/lib/usePlan'
import { createClient } from '@/lib/supabase/client'
import { loadLibrary, type ModelRequest, type TenantModel } from '@/lib/data/models'
import { setTemplate } from '@/lib/data/theme'
import Plate from '@/components/Plate'
import QrCode from '@/components/QrCode'
import SampleDish from '@/components/SampleDish'

const MENU_ORIGIN = process.env.NEXT_PUBLIC_MENU_ORIGIN || ''

type Step = 'model' | 'look' | 'dishes' | 'done'
const ORDER: Step[] = ['model', 'look', 'dishes', 'done']
const LABEL: Record<Step, string> = { model: 'First 3D model', look: 'Look', dishes: 'Dishes', done: 'Live' }

export default function SetupPage() {
  const plan = usePlan()
  const router = useRouter()
  const [step, setStep] = useState<Step>('model')
  const [msg, setMsg] = useState('')
  const [building, setBuilding] = useState<ModelRequest | null>(null)
  const [landed, setLanded] = useState<TenantModel | null>(null)
  const say = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 4000) }
  const next = () => setStep(ORDER[ORDER.indexOf(step) + 1])

  // The model is building in the background for the whole of steps 2 and 3. Watched here,
  // at the top, so whichever step they are on the moment it lands is announced.
  const watch = useCallback(async () => {
    if (!plan.restaurantId) return
    const lib = await loadLibrary(plan.restaurantId)
    const open = lib.requests.find(r => r.kind === 'generate' && ['pending', 'approved', 'running'].includes(r.state)) ?? null
    setBuilding(open)
    const fresh = lib.models.find(m => m.state === 'draft')
    if (fresh) setLanded(fresh)
  }, [plan.restaurantId])

  useEffect(() => {
    if (!building) return
    const id = setInterval(() => { void watch() }, 15_000)
    return () => clearInterval(id)
  }, [building, watch])

  async function finish() {
    if (plan.restaurantId) {
      await createClient().from('tenants').update({ setup_done: true }).eq('id', plan.restaurantId)
    }
    router.push(`/home?tenant=${plan.restaurantSlug}`)
  }

  if (plan.loading) return <p style={{ color: 'var(--dim)' }}>Loading…</p>
  if (!plan.restaurantId) return <p style={{ color: 'var(--dim)' }}>Pick a restaurant first.</p>

  return (
    <div className="page-content max-w-5xl">
      {/* progress */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
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
              <span className="text-xs font-semibold" style={{ color: here ? 'var(--text)' : 'var(--dim)' }}>
                {LABEL[s]}
              </span>
              {i < 2 && <span className="w-6 h-px mx-1" style={{ background: 'var(--border)' }} />}
            </div>
          )
        })}
        {building && step !== 'model' && (
          <span className="pill pill-wait ml-auto">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--gold)' }} />
            your model is building
          </span>
        )}
        {landed && step !== 'done' && (
          <span className="pill pill-on ml-auto">your model is ready</span>
        )}
      </div>

      {msg && <div className="card px-4 py-3 mb-5 text-sm">{msg}</div>}

      {step === 'model' && (
        <FirstModel plan={plan} onSay={say}
                    onSent={() => { void watch(); next() }}
                    onSkip={next} />
      )}
      {step === 'look' && <Look plan={plan} onNext={next} onSay={say} />}
      {step === 'dishes' && <Dishes tenantId={plan.restaurantId} onNext={next} onSay={say} />}
      {step === 'done' && <Done plan={plan} landed={landed} building={building} onFinish={finish} />}
    </div>
  )
}

// ── 1 · first model ──────────────────────────────────────────────────────────

function FirstModel({ plan, onSay, onSent, onSkip }: {
  plan: ReturnType<typeof usePlan>
  onSay: (m: string) => void
  onSent: () => void
  onSkip: () => void
}) {
  const [quota, setQuota] = useState(3)
  const [used, setUsed] = useState(0)
  useEffect(() => {
    loadLibrary(plan.restaurantId!).then(d => { setQuota(d.quota); setUsed(d.used) })
  }, [plan.restaurantId])

  return (
    <div>
      <div className="grid gap-6 lg:grid-cols-[1fr_300px] items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-2">Your first 3D model</h1>
          <p className="text-sm mb-3" style={{ color: 'var(--dim)' }}>
            Four photos of one dish, from four sides. A phone is fine. It builds in a few
            minutes, and you can set up the rest of the menu while it does.
          </p>
          <ul className="text-sm grid gap-1.5" style={{ color: 'var(--dim)' }}>
            <li>· Your first {quota} models are free.</li>
            <li>· Nothing goes on the menu until you approve it.</li>
          </ul>
        </div>
        <div className="card p-3">
          <SampleDish height={200} />
        </div>
      </div>

      <Plate tenantId={plan.restaurantId!} dishes={[]} left={Math.max(0, quota - used)}
             quota={quota} compact
             onError={onSay}
             onSent={() => { onSay('Building. Set up the menu while it does.'); onSent() }} />

      <div className="mt-5">
        <button className="btn btn-ghost" onClick={onSkip}>Skip for now</button>
      </div>
    </div>
  )
}

// ── 2 · look ─────────────────────────────────────────────────────────────────

function Look({ plan, onNext, onSay }: {
  plan: ReturnType<typeof usePlan>
  onNext: () => void
  onSay: (m: string) => void
}) {
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([])
  const [current, setCurrent] = useState('')
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
    const err = await setTemplate(plan.restaurantId!, id)
    if (err) return onSay(err.message)
    setNonce(n => n + 1)
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
        <button className="btn btn-primary w-full mt-5" onClick={onNext}>Use this one</button>
      </div>
      <div className="card overflow-hidden" style={{ minHeight: 560 }}>
        <iframe key={nonce} title="Your menu"
                src={`${MENU_ORIGIN}/${plan.restaurantSlug}?preview=${nonce}`}
                className="w-full h-[560px] border-0" />
      </div>
    </div>
  )
}

// ── 3 · dishes ───────────────────────────────────────────────────────────────

type Row = { name: string; price: string; category: string }

function Dishes({ tenantId, onNext, onSay }: {
  tenantId: string
  onNext: () => void
  onSay: (m: string) => void
}) {
  const [rows, setRows] = useState<Row[]>([
    { name: '', price: '', category: '' }, { name: '', price: '', category: '' }, { name: '', price: '', category: '' },
  ])
  const [saving, setSaving] = useState(false)
  const filled = rows.filter(r => r.name.trim()).length
  const set = (i: number, patch: Partial<Row>) =>
    setRows(rs => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)))

  async function save() {
    const supabase = createClient()
    setSaving(true)
    const names = [...new Set(rows.map(r => r.category.trim()).filter(Boolean))]
    const catId = new Map<string, string>()
    for (let i = 0; i < names.length; i++) {
      const { data } = await supabase.from('categories')
        .insert({ tenant_id: tenantId, name: names[i], position: i }).select('id').single()
      if (data) catId.set(names[i], data.id)
    }
    const items = rows.filter(r => r.name.trim()).map((r, i) => {
      const plain = r.price.replace(/[^\d.,]/g, '').replace(',', '.')
      const simple = /^\d+(\.\d{1,2})?$/.test(plain)
      return {
        tenant_id: tenantId, name: r.name.trim(),
        price_minor: simple ? Math.round(parseFloat(plain) * 100) : 0,
        price_text: simple ? null : (r.price.trim() || null),
        category_id: catId.get(r.category.trim()) ?? null,
        position: i, visible: true, is_3d: false,
      }
    })
    if (items.length) {
      const { error } = await supabase.from('items').insert(items)
      if (error) { setSaving(false); return onSay(error.message) }
    }
    setSaving(false)
    onNext()
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Your first dishes</h1>
      <p className="text-sm mb-5" style={{ color: 'var(--dim)' }}>
        Three is enough to start. The full editor has photos, sizes and translations.
      </p>
      <div className="card p-4">
        <div className="hidden sm:grid grid-cols-[1fr_120px_160px] gap-2 mb-2 px-1">
          <span className="eyebrow">Dish</span><span className="eyebrow">Price</span><span className="eyebrow">Category</span>
        </div>
        <div className="grid gap-2">
          {rows.map((r, i) => (
            <div key={i} className="grid sm:grid-cols-[1fr_120px_160px] gap-2">
              <input value={r.name} placeholder="Khachapuri" autoFocus={i === 0} onChange={e => set(i, { name: e.target.value })} />
              <input value={r.price} placeholder="18" inputMode="decimal" onChange={e => set(i, { price: e.target.value })} />
              <input value={r.category} placeholder="Starters" list="cats" onChange={e => set(i, { category: e.target.value })} />
            </div>
          ))}
        </div>
        <datalist id="cats">
          {[...new Set(rows.map(r => r.category.trim()).filter(Boolean))].map(c => <option key={c} value={c} />)}
        </datalist>
        <button className="btn btn-ghost btn-sm mt-3" onClick={() => setRows(rs => [...rs, { name: '', price: '', category: '' }])}>
          + Another dish
        </button>
      </div>
      <div className="flex items-center gap-3 mt-5 flex-wrap">
        <button className="btn btn-primary" onClick={save} disabled={saving || !filled}>
          {saving ? 'Saving…' : `Save ${filled || ''} and finish`}
        </button>
        <button className="btn btn-ghost" onClick={onNext}>Skip for now</button>
        <span className="ml-auto text-xs" style={{ color: 'var(--dim)' }}>
          Import from a file · coming soon
        </span>
      </div>
    </div>
  )
}

// ── done ─────────────────────────────────────────────────────────────────────

function Done({ plan, landed, building, onFinish }: {
  plan: ReturnType<typeof usePlan>
  landed: TenantModel | null
  building: ModelRequest | null
  onFinish: () => void
}) {
  const url = `${MENU_ORIGIN}/${plan.restaurantSlug}`
  const q = `?tenant=${plan.restaurantSlug}`
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_260px] items-start">
      <div>
        <h1 className="text-2xl font-bold mb-1">Your menu is live.</h1>
        <p className="text-sm mb-5" style={{ color: 'var(--dim)' }}>
          Anyone who scans the code, or opens the address, sees it now.
        </p>

        {landed ? (
          <div className="card p-5 mb-4 flex items-center gap-4">
            <span className="pill pill-on">ready</span>
            <div className="flex-1">
              <div className="font-semibold">Your first 3D model is ready.</div>
              <p className="text-xs" style={{ color: 'var(--dim)' }}>
                Turn it around, check the size, approve it.
              </p>
            </div>
            <a href={`/models${q}`} className="btn btn-primary btn-sm">See it</a>
          </div>
        ) : building ? (
          <div className="card p-5 mb-4 grid gap-4 md:grid-cols-[140px_1fr] items-center">
            <SampleDish height={120} />
            <div>
              <div className="font-semibold">Your first model is still building.</div>
              <p className="text-xs" style={{ color: 'var(--dim)' }}>
                A few more minutes. It will be in the 3D Studio, waiting for you.
              </p>
            </div>
          </div>
        ) : null}

        <div className="card p-4 mb-4">
          <div className="eyebrow mb-1">Address</div>
          <a href={url} target="_blank" rel="noreferrer" className="text-sm font-semibold break-all" style={{ color: 'var(--gold)' }}>{url}</a>
        </div>
        <button className="btn btn-primary" onClick={onFinish}>Go to my menu</button>
      </div>
      <div className="card p-4 text-center">
        <QrCode value={url} size={200} label={plan.restaurantSlug} />
        <p className="text-xs mt-3" style={{ color: 'var(--dim)' }}>Print sizes are under QR &amp; share.</p>
      </div>
    </div>
  )
}
