'use client'
// The 3D screen: a restaurant's library, and the plate they build a new model on.
//
// This is Scan Studio, scoped to one restaurant. Same two halves and the same shape - a
// plate of four numbered cells where the first is the primary view, and a library grid of
// cards with a preview, a state and its actions - because that tool works and rebuilding a
// worse one from memory is how the last week went.
//
// What is deliberately NOT here, and why:
//
//   Engine choice. A restaurant picking between engines is a restaurant picking how much
//   we spend on them.
//   Optimise targets. Triangles and texture size are ours to get right; an owner cannot
//   tell 40k from 80k by looking and both of them ship.
//   Fault tags. DECISIONS §9.4 - "this does not look like my dish" is the owner's
//   sentence, and it is a different sentence from "the bake is broken". Keeping them
//   apart is the only reason our fault data means anything.
//   Credits. They see models left, not what a model costs.

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePlan } from '@/lib/usePlan'
import { useLang } from '@/lib/useLang'
import { uploadAsset } from '@/lib/upload'
import {
  loadLibrary, setVerdict, renameModel, setOrbit, attachModel, requestModel,
  cancelRequest, type TenantModel, type ModelRequest,
} from '@/lib/data/models'

// dataset.SLOTS, in the engine's order, with dataset.SLOT_ROLE's reason for each. The
// order is not cosmetic: the first frame is what the generator reconstructs from, and
// four photos of the same side make a confident, wrong model.
const SLOTS = [
  { key: 'front', label: 'Front',
    help: 'Straight on, at about the height a diner sees it. The model is built from this one first.' },
  { key: 'right', label: 'Right', help: 'A quarter turn clockwise. Same distance, same light.' },
  { key: 'back',  label: 'Back',
    help: 'The opposite side. Even if it looks the same — it is what stops the far side being invented.' },
  { key: 'left',  label: 'Left',  help: 'A quarter turn the other way, and you are done.' },
]

const WAITING: Record<string, string> = {
  pending:  'Waiting for us to approve it',
  approved: 'In the queue',
  running:  'Being built now',
  failed:   'Did not work',
}

export default function ModelsPage() {
  const plan = usePlan()
  const [T] = useLang()
  const [tab, setTab] = useState<'library' | 'new'>('library')
  const [models, setModels] = useState<TenantModel[]>([])
  const [requests, setRequests] = useState<ModelRequest[]>([])
  const [dishes, setDishes] = useState<{ id: string; name: string; model_id: string | null }[]>([])
  const [quota, setQuota] = useState(0)
  const [used, setUsed] = useState(0)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  // The plate. Four slots, each either empty or holding an uploaded key.
  const [frames, setFrames] = useState<(string | null)[]>([null, null, null, null])
  const [previews, setPreviews] = useState<(string | null)[]>([null, null, null, null])
  const [busySlot, setBusySlot] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [forItem, setForItem] = useState('')
  const [sending, setSending] = useState(false)
  const fileRefs = useRef<(HTMLInputElement | null)[]>([])

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 4000) }

  const load = useCallback(async () => {
    if (plan.loading || !plan.restaurantId) { setLoading(plan.loading); return }
    setLoading(true)
    const data = await loadLibrary(plan.restaurantId)
    setModels(data.models)
    setRequests(data.requests)
    setDishes(data.dishes)
    setQuota(data.quota)
    setUsed(data.used)
    setLoading(false)
  }, [plan.loading, plan.restaurantId])

  useEffect(() => { void load() }, [load])

  // Something is in flight, so the library will change without anyone touching it. Polled
  // rather than pushed because a generation takes minutes, not seconds - a websocket for
  // this would be machinery to save a request every half minute.
  useEffect(() => {
    if (!requests.some(r => r.state === 'running' || r.state === 'approved')) return
    const id = setInterval(() => { void load() }, 30_000)
    return () => clearInterval(id)
  }, [requests, load])

  async function shrink(file: File): Promise<Blob> {
    // 2048px, JPEG, quality high. Bigger than a menu photo on purpose: this is engine
    // input, and whatever detail is thrown away here is the ceiling on the model forever.
    // Still resized, because a modern phone hands over 12 MB and none of it past 2048
    // reaches the generator.
    const bmp = await createImageBitmap(file)
    const w = Math.min(2048, bmp.width)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = Math.round(bmp.height * (w / bmp.width))
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not read that photo'))),
                    'image/jpeg', 0.92))
  }

  async function putFrame(slot: number, file: File) {
    setBusySlot(slot)
    try {
      const blob = await shrink(file)
      // The slot name is in the filename so a frame is identifiable on its own in a bucket
      // listing - which is what you want when a model came out wrong and the question is
      // which photo it came from.
      const url = await uploadAsset(blob, 'photo', plan.restaurantId,
                                    `${SLOTS[slot].key}.jpg`)
      const key = url.split('/a/')[1] || url
      setFrames(f => { const next = [...f]; next[slot] = key; return next })
      setPreviews(p => { const next = [...p]; next[slot] = url; return next })
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e))
    }
    setBusySlot(null)
  }

  function clearFrame(slot: number) {
    setFrames(f => { const next = [...f]; next[slot] = null; return next })
    setPreviews(p => { const next = [...p]; next[slot] = null; return next })
  }

  const filled = frames.filter(Boolean).length
  const left = Math.max(0, quota - used)

  async function send() {
    if (!filled) return flash('Add at least one photo of the dish')
    setSending(true)
    const name = title.trim() || dishes.find(d => d.id === forItem)?.name || ''
    const { data, error } = await requestModel(
      plan.restaurantId!, frames.filter(Boolean) as string[], name, forItem || null)
    setSending(false)
    if (error) return flash(error.message)
    setFrames([null, null, null, null])
    setPreviews([null, null, null, null])
    setTitle(''); setForItem('')
    flash(data?.state === 'pending'
      ? 'Sent. We will approve it shortly.'
      : 'Sent. It is being built now.')
    setTab('library')
    void load()
  }

  if (!plan.loading && !plan.restaurantId) {
    return (
      <div className="max-w-xl rounded-xl p-6"
           style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <h1 className="text-xl font-bold" style={{ color: 'var(--gold)' }}>
          {T.noRestaurantMapped}
        </h1>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-5">
        <h1 className="text-xl md:text-2xl font-bold page-title mr-auto"
            style={{ color: 'var(--gold)' }}>3D models</h1>
        <span className="text-xs" style={{ color: 'var(--dim)' }}>
          {left} of {quota} left
        </span>
        <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {(['library', 'new'] as const).map(id => (
            <button key={id} onClick={() => setTab(id)} className="px-4 py-2 text-sm"
                    style={{ background: tab === id ? 'var(--gold)' : 'transparent',
                             color: tab === id ? '#000' : 'var(--dim)' }}>
              {id === 'library' ? 'Library' : 'New model'}
            </button>
          ))}
        </div>
      </div>

      {msg && (
        <div className="mb-4 rounded-lg px-4 py-3 text-sm"
             style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>{msg}</div>
      )}

      {tab === 'new' ? (
        <NewModel
          slots={SLOTS} previews={previews} busySlot={busySlot} filled={filled}
          fileRefs={fileRefs} onPick={putFrame} onClear={clearFrame}
          title={title} setTitle={setTitle}
          dishes={dishes} forItem={forItem} setForItem={setForItem}
          left={left} sending={sending} onSend={send}
        />
      ) : (
        <Library
          loading={loading} models={models} requests={requests} dishes={dishes}
          onChanged={load} onFlash={flash} onStart={() => setTab('new')}
        />
      )}
    </div>
  )
}

// ── the plate ────────────────────────────────────────────────────────────────

function NewModel(props: {
  slots: typeof SLOTS
  previews: (string | null)[]
  busySlot: number | null
  filled: number
  fileRefs: React.RefObject<(HTMLInputElement | null)[]>
  onPick: (slot: number, file: File) => void
  onClear: (slot: number) => void
  title: string; setTitle: (v: string) => void
  dishes: { id: string; name: string }[]
  forItem: string; setForItem: (v: string) => void
  left: number; sending: boolean; onSend: () => void
}) {
  const { slots, previews, busySlot, filled, fileRefs, onPick, onClear } = props
  const card = { background: 'var(--card)', border: '1px solid var(--border)' }

  return (
    <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
      <div className="rounded-xl p-5" style={card}>
        <div className="flex items-baseline gap-3 mb-1">
          <h2 className="font-semibold">The plate</h2>
          <span className="text-xs ml-auto" style={{ color: 'var(--dim)' }}>
            {filled === 0 ? 'need at least one'
              : filled < 4 ? `${filled} of 4 — more frames, better model`
              : 'ready'}
          </span>
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--dim)' }}>
          Even light, no hands in shot, the plate filling most of the frame.
        </p>

        <div className="grid grid-cols-2 gap-3">
          {slots.map((slot, i) => (
            <div key={slot.key} className="rounded-lg overflow-hidden relative"
                 style={{ border: i === 0 ? '1px solid var(--gold)' : '1px solid var(--border)',
                          background: 'var(--bg)' }}>
              <div className="flex items-center gap-2 px-3 pt-2 text-[11px]"
                   style={{ color: i === 0 ? 'var(--gold)' : 'var(--dim)' }}>
                <span className="font-mono">0{i + 1}</span>
                <span className="uppercase tracking-wide">
                  {slot.label}{i === 0 ? ' · primary' : ''}
                </span>
              </div>

              <button type="button"
                      onClick={() => fileRefs.current?.[i]?.click()}
                      className="w-full aspect-[4/3] flex items-center justify-center text-xs"
                      style={{ color: 'var(--dim)' }}>
                {busySlot === i ? 'Uploading…'
                  : previews[i]
                    ? <img src={previews[i]!} alt="" className="w-full h-full object-cover" />
                    : 'add photo'}
              </button>

              <input ref={el => { if (fileRefs.current) fileRefs.current[i] = el }}
                     type="file" accept="image/*" capture="environment" className="hidden"
                     onChange={e => { const f = e.target.files?.[0]; if (f) onPick(i, f) }} />

              {previews[i] && (
                <button type="button" onClick={() => onClear(i)}
                        className="absolute top-8 right-2 text-[11px] px-2 py-1 rounded"
                        style={{ background: 'rgba(0,0,0,.6)', color: '#fff' }}>Clear</button>
              )}
              <p className="px-3 pb-3 text-[11px] leading-4" style={{ color: 'var(--dim)' }}>
                {slot.help}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl p-5 h-fit" style={card}>
        <h2 className="font-semibold mb-4">This model</h2>

        <label className="block text-xs mb-1" style={{ color: 'var(--dim)' }}>For which dish</label>
        <select value={props.forItem} onChange={e => props.setForItem(e.target.value)}
                className="w-full mb-4 rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
          <option value="">Not on the menu yet</option>
          {props.dishes.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>

        <label className="block text-xs mb-1" style={{ color: 'var(--dim)' }}>Name</label>
        <input value={props.title} onChange={e => props.setTitle(e.target.value)}
               placeholder="Khachapuri"
               className="w-full mb-4 rounded-lg px-3 py-2 text-sm"
               style={{ background: 'var(--bg)', border: '1px solid var(--border)' }} />

        <button type="button" onClick={props.onSend} disabled={props.sending || !filled}
                className="w-full rounded-lg py-3 text-sm font-semibold disabled:opacity-40"
                style={{ background: 'var(--gold)', color: '#000' }}>
          {props.sending ? 'Sending…' : 'Build it'}
        </button>

        <p className="text-[11px] mt-3 leading-4" style={{ color: 'var(--dim)' }}>
          {props.left > 0
            ? 'A few minutes. It lands in your library for you to approve before any diner sees it.'
            : 'You have used all your models. Send it and we will look at it — it will not start until we say yes.'}
        </p>
      </div>
    </div>
  )
}

// ── the library ──────────────────────────────────────────────────────────────

function Library(props: {
  loading: boolean
  models: TenantModel[]
  requests: ModelRequest[]
  dishes: { id: string; name: string; model_id: string | null }[]
  onChanged: () => void
  onFlash: (m: string) => void
  onStart: () => void
}) {
  const { models, requests, dishes, onChanged, onFlash } = props
  const [filter, setFilter] = useState<'all' | 'draft' | 'approved' | 'rejected'>('all')
  const card = { background: 'var(--card)', border: '1px solid var(--border)' }

  const shown = models.filter(m => filter === 'all' || m.state === filter)
  const waiting = models.filter(m => m.state === 'draft').length

  async function verdict(m: TenantModel, state: 'approved' | 'rejected') {
    const err = await setVerdict(m.id, state)
    if (err) return onFlash(err.message)
    onChanged()
  }

  if (props.loading) return <p style={{ color: 'var(--dim)' }}>Loading…</p>

  return (
    <div className="grid gap-5">
      {requests.length > 0 && (
        <div className="rounded-xl p-5" style={card}>
          <h2 className="font-semibold mb-3">On the way · {requests.length}</h2>
          <div className="grid gap-2">
            {requests.map(r => (
              <div key={r.id} className="flex items-center gap-3 text-sm">
                <span className="flex-1">{r.title || 'Dish'}</span>
                <span className="text-xs" style={{ color: 'var(--dim)' }}>
                  {r.state === 'failed' && r.note ? r.note : WAITING[r.state]}
                </span>
                {r.state !== 'failed' && (
                  <button className="text-xs underline" style={{ color: 'var(--dim)' }}
                          onClick={async () => {
                            const err = await cancelRequest(r.id)
                            if (err) onFlash(err.message); else onChanged()
                          }}>cancel</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl p-5" style={card}>
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <h2 className="font-semibold mr-auto">
            {models.length} model{models.length === 1 ? '' : 's'}
            {waiting > 0 && <span style={{ color: 'var(--gold)' }}> · {waiting} waiting for you</span>}
          </h2>
          {(['all', 'draft', 'approved', 'rejected'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
                    className="text-xs px-3 py-1 rounded-full"
                    style={{ border: '1px solid var(--border)',
                             background: filter === f ? 'var(--gold)' : 'transparent',
                             color: filter === f ? '#000' : 'var(--dim)' }}>
              {f === 'draft' ? 'waiting' : f}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm mb-3" style={{ color: 'var(--dim)' }}>Nothing here yet.</p>
            <button onClick={props.onStart} className="text-sm underline"
                    style={{ color: 'var(--gold)' }}>Build your first model</button>
          </div>
        ) : (
          <div className="grid gap-4"
               style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))' }}>
            {shown.map(m => (
              <ModelCard key={m.id} model={m} dishes={dishes}
                         onVerdict={verdict} onChanged={onChanged} onFlash={onFlash} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ModelCard(props: {
  model: TenantModel
  dishes: { id: string; name: string; model_id: string | null }[]
  onVerdict: (m: TenantModel, state: 'approved' | 'rejected') => void
  onChanged: () => void
  onFlash: (m: string) => void
}) {
  const { model: m, dishes, onChanged, onFlash } = props
  const [name, setName] = useState(m.title)
  const [open, setOpen] = useState(false)

  const pill = m.state === 'approved' ? { bg: '#0f3d2b', fg: '#4ade80' }
    : m.state === 'rejected' ? { bg: '#3d1414', fg: '#f87171' }
    : { bg: '#3d3210', fg: 'var(--gold)' }

  return (
    <div className="rounded-lg overflow-hidden flex flex-col"
         style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
      <div className="aspect-square flex items-center justify-center"
           style={{ background: 'var(--card)' }}>
        {m.poster
          ? <img src={m.poster} alt="" loading="lazy" className="w-full h-full object-cover" />
          : <span className="text-xs" style={{ color: 'var(--dim)' }}>no preview</span>}
      </div>

      <div className="p-3 flex-1 flex flex-col gap-2">
        <input value={name} onChange={e => setName(e.target.value)}
               onBlur={async () => {
                 if (name.trim() === m.title) return
                 const err = await renameModel(m.id, name)
                 if (err) onFlash(err.message); else onChanged()
               }}
               className="text-sm font-semibold bg-transparent w-full" />

        <div className="flex items-center gap-2 text-[11px]">
          <span className="px-2 py-[2px] rounded-full"
                style={{ background: pill.bg, color: pill.fg }}>
            {m.state === 'draft' ? 'waiting for you' : m.state}
          </span>
          {m.scale_cm
            ? <span style={{ color: 'var(--dim)' }}>{m.scale_cm} cm</span>
            : <span style={{ color: 'var(--gold)' }}>no size</span>}
        </div>

        <p className="text-[11px]" style={{ color: 'var(--dim)' }}>
          {m.usedBy ? `on ${m.usedBy.name}` : 'not on any dish'}
        </p>

        {m.state === 'draft' && (
          <div className="flex gap-2 mt-1">
            <button onClick={() => props.onVerdict(m, 'approved')}
                    className="flex-1 rounded py-2 text-xs font-semibold"
                    style={{ background: 'var(--gold)', color: '#000' }}>Approve</button>
            <button onClick={() => props.onVerdict(m, 'rejected')}
                    className="flex-1 rounded py-2 text-xs"
                    style={{ border: '1px solid var(--border)', color: 'var(--dim)' }}>Reject</button>
          </div>
        )}

        {m.state === 'approved' && (
          <>
            <select value={m.usedBy?.id ?? ''} className="text-xs rounded px-2 py-1 mt-1"
                    style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
                    onChange={async e => {
                      // Taking it off one dish and putting it on another is two writes, and
                      // the order matters: clear first, or a dish briefly points at a model
                      // another dish also points at.
                      if (m.usedBy) await attachModel(m.usedBy.id, null)
                      if (e.target.value) await attachModel(e.target.value, m.id)
                      onChanged()
                    }}>
              <option value="">not on a dish</option>
              {dishes.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button onClick={() => setOpen(o => !o)} className="text-[11px] underline text-left"
                    style={{ color: 'var(--dim)' }}>
              {open ? 'close' : 'starting angle'}
            </button>
          </>
        )}

        {open && m.glb && <Angle model={m} onFlash={onFlash} onChanged={onChanged} />}
      </div>
    </div>
  )
}

const VIEWER_SRC =
  'https://cdnjs.cloudflare.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js'
let viewerReady: Promise<void> | null = null

/** One <script> for the whole session, however many panels are opened. */
function ensureViewer(): Promise<void> {
  if (viewerReady) return viewerReady
  viewerReady = new Promise<void>(resolve => {
    if (customElements.get('model-viewer')) return resolve()
    const tag = document.createElement('script')
    tag.type = 'module'
    tag.src = VIEWER_SRC
    // Resolves either way: a blocked CDN must leave the rest of the screen working, with
    // an empty panel, rather than hanging on a promise that never settles.
    tag.onload = () => resolve()
    tag.onerror = () => resolve()
    document.head.appendChild(tag)
  })
  return viewerReady
}

/** Turn the dish to how it should first appear, then save it.
 *
 *  Not three number inputs. The angle is not cosmetic - a bowl framed from its own rim is
 *  an empty ellipse and every diner sees whatever is set - and nobody will ever type the
 *  right three numbers. */
function Angle(props: { model: TenantModel; onFlash: (m: string) => void; onChanged: () => void }) {
  const { model: m } = props
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<HTMLElement | null>(null)
  const framed = useRef(0)

  useEffect(() => {
    let dead = false
    ;(async () => {
      // From the CDN, pinned to 3.4.0 - the exact version production ships, so the admin
      // frames a dish the same way a diner will see it. Not an npm dependency: it wants a
      // three.js peer that fights everything else here, and this is the one screen that
      // needs it.
      //
      // Loaded only when somebody opens this panel. A library of twenty models must not
      // fetch a viewer and twenty GLBs to draw a list.
      await ensureViewer()
      if (dead || !host.current || viewer.current) return
      const el = document.createElement('model-viewer')
      el.setAttribute('src', m.glb)
      el.setAttribute('camera-controls', '')
      el.setAttribute('touch-action', 'pan-y')
      el.setAttribute('interaction-prompt', 'none')
      el.setAttribute('loading', 'eager')
      el.style.cssText = 'width:100%;height:200px;background:var(--card);border-radius:8px'
      if (m.view_orbit) {
        const p = m.view_orbit.trim().split(/\s+/).map(Number)
        if (p.length === 3 && p.every(Number.isFinite)) {
          el.setAttribute('camera-orbit', `${p[0]}deg ${p[1]}deg ${p[2]}%`)
        }
      }
      el.addEventListener('load', () => {
        const o = (el as unknown as { getCameraOrbit(): { radius: number } }).getCameraOrbit()
        // Whatever radius it settles on with no camera-orbit of ours IS 100%, which is what
        // makes a percentage readable back out of a measurement in metres at all.
        const saved = m.view_orbit ? Number(m.view_orbit.trim().split(/\s+/)[2]) / 100 : 1
        framed.current = o.radius / (saved || 1)
      }, { once: true })
      host.current.appendChild(el)
      viewer.current = el
    })()
    return () => { dead = true }
  }, [m.glb, m.view_orbit])

  async function use() {
    const el = viewer.current as unknown as
      { getCameraOrbit(): { theta: number; phi: number; radius: number } } | null
    if (!el || !framed.current) return props.onFlash('Give it a moment to load')
    const o = el.getCameraOrbit()
    const deg = (rad: number) => Math.round((rad * 180) / Math.PI)
    // The renderer's own clamps (viewer.js _itemCameraOrbit), applied here so a saved angle
    // is one that will actually be used rather than silently discarded.
    const h = Math.max(-360, Math.min(360, deg(o.theta)))
    const v = Math.max(0, Math.min(85, deg(o.phi)))
    const zoom = Math.max(30, Math.min(300, Math.round((o.radius / framed.current) * 100)))
    const err = await setOrbit(m.id, `${h} ${v} ${zoom}`)
    if (err) props.onFlash(err.message)
    else { props.onFlash('Angle saved'); props.onChanged() }
  }

  return (
    <div className="mt-2">
      <div ref={host} />
      <div className="flex gap-2 mt-2">
        <button onClick={use} className="flex-1 rounded py-2 text-[11px]"
                style={{ background: 'var(--gold)', color: '#000' }}>Use this angle</button>
        <button onClick={async () => {
                  const err = await setOrbit(m.id, null)
                  if (err) props.onFlash(err.message)
                  else { props.onFlash('Back to the default'); props.onChanged() }
                }}
                className="rounded px-3 py-2 text-[11px]"
                style={{ border: '1px solid var(--border)', color: 'var(--dim)' }}>Default</button>
      </div>
    </div>
  )
}
