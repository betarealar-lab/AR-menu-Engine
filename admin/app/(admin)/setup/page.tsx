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
import { useLang } from '@/lib/useLang'
import { text, type Translations } from '@/lib/i18n'

const MENU_ORIGIN = process.env.NEXT_PUBLIC_MENU_ORIGIN || ''

type Step = 'model' | 'look' | 'dishes' | 'done'
const ORDER: Step[] = ['model', 'look', 'dishes', 'done']
// A function of T rather than a module constant: the labels have to change language
// with the rest of the screen, and a constant is evaluated once at import.
const labels = (T: Translations): Record<Step, string> =>
  ({ model: T.setupStepModel, look: T.setupStepLook,
     dishes: T.setupStepDishes, done: T.setupStepLive })

export default function SetupPage() {
  const [T] = useLang()
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
      // The error is deliberately not raised. This flag only decides whether the owner is
      // routed back through setup next time; the restaurant, its menu and its model are
      // all already saved. Failing here and refusing to leave would trap somebody on a
      // wizard they have finished, which is a worse outcome than seeing it once more.
      await createClient().from('tenants').update({ setup_done: true }).eq('id', plan.restaurantId)
    }
    router.push(`/home?tenant=${plan.restaurantSlug}`)
  }

  if (plan.loading) return <p style={{ color: 'var(--dim)' }}>{T.loading}</p>
  if (!plan.restaurantId) return <p style={{ color: 'var(--dim)' }}>{T.pickRestaurantFirst}</p>

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
                {labels(T)[s]}
              </span>
              {i < 2 && <span className="w-6 h-px mx-1" style={{ background: 'var(--border)' }} />}
            </div>
          )
        })}
        {building && step !== 'model' && (
          <span className={`pill ml-auto ${building.state === 'pending' ? 'pill-mute' : 'pill-wait'}`}>
            {/* No pulse on a pending request: that dot is the only thing on this pill
                that claims something is happening right now, and nothing is. */}
            {building.state !== 'pending' && (
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--gold)' }} />
            )}
            {building.state === 'pending' ? T.waitPending : T.setupModelBuilding}
          </span>
        )}
        {landed && step !== 'done' && (
          <span className="pill pill-on ml-auto">{T.setupModelReady}</span>
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
  const [T] = useLang()
  const [quota, setQuota] = useState(3)
  const [used, setUsed] = useState(0)
  useEffect(() => {
    loadLibrary(plan.restaurantId!).then(d => { setQuota(d.quota); setUsed(d.used) })
  }, [plan.restaurantId])

  return (
    <div>
      <div className="grid gap-6 lg:grid-cols-[1fr_300px] items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-2">{T.setupFirstModelTitle}</h1>
          <p className="text-sm mb-3" style={{ color: 'var(--dim)' }}>
            {T.setupFirstModelHint}
          </p>
          <ul className="text-sm grid gap-1.5" style={{ color: 'var(--dim)' }}>
            <li>· {text(T.setupFreeModels, { n: String(quota) })}</li>
            <li>· {T.setupNothingUntilApprove}</li>
          </ul>
        </div>
        <div className="card p-3">
          <SampleDish height={200} />
        </div>
      </div>

      <Plate tenantId={plan.restaurantId!} dishes={[]} left={Math.max(0, quota - used)}
             quota={quota} compact
             onError={onSay}
             onSent={() => { onSay(T.setupBuildingWhileYouWork); onSent() }} />

      <div className="mt-5">
        <button className="btn btn-ghost" onClick={onSkip}>{T.skipForNow}</button>
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
  const [T] = useLang()
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
        <h1 className="text-xl font-bold mb-1">{T.setupLookTitle}</h1>
        <p className="text-sm mb-5" style={{ color: 'var(--dim)' }}>
          {T.setupLookHint}
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
        <button className="btn btn-primary w-full mt-5" onClick={onNext}>{T.setupUseThisOne}</button>
      </div>
      <div className="card overflow-hidden" style={{ minHeight: 560 }}>
        <iframe key={nonce} title={T.yourMenu}
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
  const [T] = useLang()
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
      <h1 className="text-xl font-bold mb-1">{T.setupDishesTitle}</h1>
      <p className="text-sm mb-5" style={{ color: 'var(--dim)' }}>
        {T.setupDishesHint}
      </p>
      <div className="card p-4">
        <div className="hidden sm:grid grid-cols-[1fr_120px_160px] gap-2 mb-2 px-1">
          <span className="eyebrow">{T.colDish}</span><span className="eyebrow">{T.colPrice}</span><span className="eyebrow">{T.colCategory}</span>
        </div>
        <div className="grid gap-2">
          {rows.map((r, i) => (
            // On a wide screen the column headings above say what each box is. On a
            // phone the row stacks and those headings are hidden, which left three
            // identical boxes distinguished only by placeholders - and a placeholder is
            // gone the moment somebody types into the row above and looks back. This is
            // the first screen a new restaurant ever fills in, usually on a phone.
            //
            // The labels carry the accessible name in both layouts, so they are not a
            // mobile patch: these inputs had no label of any kind, and a screen reader
            // got "edit text, edit text, edit text".
            <div key={i} className="grid sm:grid-cols-[1fr_120px_160px] gap-2">
              <label className="grid gap-1">
                <span className="eyebrow sm:sr-only">{T.colDish}</span>
                <input value={r.name} placeholder={T.phDish} autoFocus={i === 0} onChange={e => set(i, { name: e.target.value })} />
              </label>
              <label className="grid gap-1">
                <span className="eyebrow sm:sr-only">{T.colPrice}</span>
                <input value={r.price} placeholder="18" inputMode="decimal" onChange={e => set(i, { price: e.target.value })} />
              </label>
              <label className="grid gap-1">
                <span className="eyebrow sm:sr-only">{T.colCategory}</span>
                <input value={r.category} placeholder={T.phCategory} list="cats" onChange={e => set(i, { category: e.target.value })} />
              </label>
            </div>
          ))}
        </div>
        <datalist id="cats">
          {[...new Set(rows.map(r => r.category.trim()).filter(Boolean))].map(c => <option key={c} value={c} />)}
        </datalist>
        <button className="btn btn-ghost btn-sm mt-3" onClick={() => setRows(rs => [...rs, { name: '', price: '', category: '' }])}>
          {T.setupAnotherDish}
        </button>
      </div>
      <div className="flex items-center gap-3 mt-5 flex-wrap">
        <button className="btn btn-primary" onClick={save} disabled={saving || !filled}>
          {saving ? T.saving : text(T.setupSaveAndFinish, { n: String(filled || '') })}
        </button>
        <button className="btn btn-ghost" onClick={onNext}>{T.skipForNow}</button>
        <span className="ml-auto text-xs" style={{ color: 'var(--dim)' }}>
          {T.setupImportSoon}
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
  const [T] = useLang()
  const url = `${MENU_ORIGIN}/${plan.restaurantSlug}`
  const q = `?tenant=${plan.restaurantSlug}`
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_260px] items-start">
      <div>
        <h1 className="text-2xl font-bold mb-1">{T.setupLiveTitle}</h1>
        <p className="text-sm mb-5" style={{ color: 'var(--dim)' }}>
          {T.setupLiveHint}
        </p>

        {landed ? (
          <div className="card p-5 mb-4 flex items-center gap-4">
            <span className="pill pill-on">{T.ready}</span>
            <div className="flex-1">
              <div className="font-semibold">{T.setupModelReadyTitle}</div>
              <p className="text-xs" style={{ color: 'var(--dim)' }}>
                {T.setupModelReadyHint}
              </p>
            </div>
            <a href={`/models${q}`} className="btn btn-primary btn-sm">{T.setupSeeIt}</a>
          </div>
        ) : building ? (
          /* A first model can only be `pending` on a restaurant whose free-model limit we
             have set to zero - rare, and it was still told "a few more minutes", with an
             animated finished dish beside it standing in for progress that does not
             exist. Same defect as the Studio's Building panel, in the one screen a
             restaurant sees exactly once. */
          <div className="card p-5 mb-4 grid gap-4 md:grid-cols-[140px_1fr] items-center">
            {building.state === 'pending' ? <span /> : <SampleDish height={120} />}
            <div>
              <div className="font-semibold">
                {building.state === 'pending' ? T.setupStillPendingTitle : T.setupStillBuildingTitle}
              </div>
              <p className="text-xs" style={{ color: 'var(--dim)' }}>
                {building.state === 'pending' ? T.setupStillPendingHint : T.setupStillBuildingHint}
              </p>
            </div>
          </div>
        ) : null}

        <div className="card p-4 mb-4">
          <div className="eyebrow mb-1">{T.addressLabel}</div>
          <a href={url} target="_blank" rel="noreferrer" className="text-sm font-semibold break-all" style={{ color: 'var(--gold)' }}>{url}</a>
        </div>
        <button className="btn btn-primary" onClick={onFinish}>{T.setupGoToMenu}</button>
      </div>
      <div className="card p-4 text-center">
        <QrCode value={url} size={200} label={plan.restaurantSlug} />
        <p className="text-xs mt-3" style={{ color: 'var(--dim)' }}>{T.setupPrintSizes}</p>
      </div>
    </div>
  )
}
