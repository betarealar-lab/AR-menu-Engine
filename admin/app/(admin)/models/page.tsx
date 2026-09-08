'use client'
// The 3D Studio. The product.
//
// Scan Studio, for one restaurant, with everything it can do: the photo library, the
// plate, multiview, size, variants, build again, resize, cancel, approve, reject, rename,
// hide, attach, starting angle. What stays ours - engine choice, optimise targets, fault
// tags, the credit balance - is every knob on how much we spend.
//
// This is the first screen designed properly rather than ported, and it sets the pattern
// the others follow:
//
//   One page, three views: Library, Photos, New. Never a modal for a whole task.
//   A header that says the one number that matters and holds the one primary action.
//   Cards with an eyebrow, a title, and one job each. Status is a pill, never a sentence.
//   The primary button is gold and there is one of it. Everything else is quiet.
//   Empty states say what to do next, not that there is nothing.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlan } from '@/lib/usePlan'
import Plate from '@/components/Plate'
import {
  loadLibrary, setVerdict, renameModel, setOrbit, attachModel, cancelRequest,
  type TenantModel, type ModelRequest,
} from '@/lib/data/models'
import { loadCaptures, requestRescale, setArchived, hasDims, type Capture, type Dims } from '@/lib/data/studio'
import SizeInput from '@/components/SizeInput'
import SampleDish from '@/components/SampleDish'
import QrCode from '@/components/QrCode'
import { ensureViewer } from '@/lib/viewer'
import { sizeInWords, type Axis } from '@/lib/size'

const MENU_ORIGIN = process.env.NEXT_PUBLIC_MENU_ORIGIN || ''

type View = 'library' | 'photos' | 'new'
type Dish = { id: string; name: string; model_id: string | null }

const WAITING: Record<string, string> = {
  pending: 'waiting for us', approved: 'queued', running: 'building', failed: 'did not work',
}

export default function StudioPage() {
  const plan = usePlan()
  const [view, setView] = useState<View>('library')
  const [models, setModels] = useState<TenantModel[]>([])
  const [requests, setRequests] = useState<ModelRequest[]>([])
  const [captures, setCaptures] = useState<Capture[]>([])
  const [dishes, setDishes] = useState<Dish[]>([])
  const [quota, setQuota] = useState(0)
  const [used, setUsed] = useState(0)
  // `loading` is DERIVED, not set inside the effect. Every one of these screens used to
  // open with `setLoading(plan.loading)` in the effect body, which is a synchronous state
  // write during an effect and so a second render before the first has painted - on every
  // screen, on every navigation. Tracking which restaurant the data belongs to says the
  // same thing without the extra render, and correctly shows loading again when somebody
  // switches restaurant.
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const loading = plan.loading || (!!plan.restaurantId && loadedFor !== plan.restaurantId)
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null)
  const [plateFor, setPlateFor] = useState<{ dish: string; variant: string; title: string } | null>(null)

  const say = (text: string, bad = false) => {
    setToast({ text, bad })
    setTimeout(() => setToast(null), bad ? 6000 : 3500)
  }

  const load = useCallback(async () => {
    if (plan.loading || !plan.restaurantId) return
    const [lib, caps] = await Promise.all([loadLibrary(plan.restaurantId), loadCaptures(plan.restaurantId)])
    setModels(lib.models)
    setRequests(lib.requests)
    setDishes(lib.dishes)
    setQuota(lib.quota)
    setUsed(lib.used)
    setCaptures(caps)
    setLoadedFor(plan.restaurantId)
  }, [plan.loading, plan.restaurantId])

  useEffect(() => { void load() }, [load])

  // Something is being built: the library will change without anyone touching it. Polled,
  // because a generation takes minutes and a socket to save a request every half minute
  // is machinery for its own sake.
  useEffect(() => {
    if (!requests.some(r => ['running', 'approved', 'pending'].includes(r.state))) return
    const id = setInterval(() => { void load() }, 30_000)
    return () => clearInterval(id)
  }, [requests, load])

  const left = Math.max(0, quota - used)
  const waiting = models.filter(m => m.state === 'draft' && !m.archived).length
  const building = requests.filter(r => r.state !== 'failed').length

  if (!plan.loading && !plan.restaurantId) {
    return <div className="card p-6 text-sm" style={{ color: 'var(--dim)' }}>Pick a restaurant first.</div>
  }

  return (
    <div className="page-content">
      {/* ── header: the number, the views, the action ──────────────────── */}
      <div className="flex items-center gap-3 flex-wrap mb-5">
        <div className="mr-auto">
          <h1 className="page-title">3D Studio</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--dim)' }}>
            {left} of {quota} free models left
            {waiting > 0 && <> · <span style={{ color: 'var(--gold)' }}>{waiting} waiting for you</span></>}
            {building > 0 && <> · {building} building</>}
          </p>
        </div>

        <div className="flex rounded-lg p-0.5" style={{ background: 'var(--card2)' }}>
          {([['library', 'Library'], ['photos', 'Photos']] as [View, string][]).map(([id, label]) => (
            <button key={id} onClick={() => { setView(id); setPlateFor(null) }}
                    className="px-3.5 py-1.5 rounded-md text-sm font-semibold transition-colors"
                    style={{ background: view === id ? 'var(--card)' : 'transparent',
                             color: view === id ? 'var(--text)' : 'var(--dim)',
                             boxShadow: view === id ? 'var(--shadow)' : 'none' }}>
              {label}
            </button>
          ))}
        </div>

        {view !== 'new' && (
          <button className="btn btn-primary" onClick={() => { setPlateFor(null); setView('new') }}>
            New model
          </button>
        )}
      </div>

      {toast && (
        <div className="card px-4 py-3 mb-4 text-sm"
             style={{ color: toast.bad ? 'var(--danger)' : 'var(--text)',
                      borderColor: toast.bad ? 'var(--danger)' : undefined }}>
          {toast.text}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map(i => <div key={i} className="card h-40 animate-pulse" />)}
        </div>
      ) : view === 'new' ? (
        <div>
          <button className="btn btn-ghost btn-sm mb-4" onClick={() => setView('library')}>‹ Back to the library</button>
          <Plate tenantId={plan.restaurantId!} dishes={dishes} left={left} quota={quota}
                 forDish={plateFor ?? undefined}
                 onError={m => say(m, true)}
                 onSent={state => {
                   say(state === 'pending' ? 'Sent. We will approve it shortly.'
                                           : 'Building. It will be in your library in a few minutes.')
                   setView('library')
                   void load()
                 }} />
        </div>
      ) : view === 'photos' ? (
        <PhotoLibrary captures={captures} dishes={dishes} models={models}
                      onContinue={(dish, variant, title) => { setPlateFor({ dish, variant, title }); setView('new') }} />
      ) : (
        <Library models={models} requests={requests} dishes={dishes}
                 onChanged={load} onSay={say} onStart={() => setView('new')} />
      )}
    </div>
  )
}

// ── the photo library ────────────────────────────────────────────────────────

function PhotoLibrary({ captures, dishes, models, onContinue }: {
  captures: Capture[]
  dishes: Dish[]
  models: TenantModel[]
  onContinue: (dish: string, variant: string, title: string) => void
}) {
  // Grouped by dish and variant, newest first. A group is one plate's worth of photos.
  const groups = useMemo(() => {
    const map = new Map<string, Capture[]>()
    for (const c of captures) {
      const k = `${c.dish} ${c.variant}`
      map.set(k, [...(map.get(k) || []), c])
    }
    return [...map.entries()].map(([k, list]) => {
      const [dish, variant] = k.split(' ')
      const item = dishes.find(d => d.id === dish)
      const model = models.find(m => m.dish === dish && m.variant === variant)
      return { dish, variant, title: item?.name || model?.title || 'Untitled dish',
               frames: list.sort((a, b) => a.slot - b.slot), hasModel: !!model,
               latest: list.reduce((t, c) => (c.created_utc > t ? c.created_utc : t), '') }
    }).sort((a, b) => (a.latest < b.latest ? 1 : -1))
  }, [captures, dishes, models])

  if (groups.length === 0) {
    return (
      <div className="card p-10 text-center">
        <p className="font-semibold mb-1">No photos yet.</p>
        <p className="text-sm" style={{ color: 'var(--dim)' }}>
          Every photo you take for a model is kept here, by dish, so you can come back and
          finish, or build again with better ones.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' }}>
      {groups.map(g => (
        <div key={`${g.dish}/${g.variant}`} className="card overflow-hidden">
          <div className="grid grid-cols-4 gap-px" style={{ background: 'var(--border)' }}>
            {[0, 1, 2, 3].map(slot => {
              const f = g.frames.find(c => c.slot === slot)
              return (
                <div key={slot} className="aspect-square relative" style={{ background: 'var(--card2)' }}>
                  {f ? <img src={f.url} alt="" loading="lazy" className="w-full h-full object-cover" />
                     : <span className="absolute inset-0 flex items-center justify-center text-[10px]"
                             style={{ color: 'var(--dim)' }}>{['front', 'right', 'back', 'left'][slot]}</span>}
                  {f?.generated && (
                    <span className="absolute bottom-1 left-1 pill pill-mute" style={{ fontSize: 9, padding: '1px 6px' }}>predicted</span>
                  )}
                </div>
              )
            })}
          </div>
          <div className="p-4 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-semibold truncate">{g.title}</div>
              <div className="text-xs" style={{ color: 'var(--dim)' }}>
                {g.variant !== 'default' ? `${g.variant} · ` : ''}{g.frames.length} of 4
                {g.hasModel ? ' · has a model' : ''}
              </div>
            </div>
            <button className="btn btn-sm" onClick={() => onContinue(g.dish, g.variant, g.title)}>
              {g.hasModel ? 'Build again' : 'Continue'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── the library ──────────────────────────────────────────────────────────────

function Library({ models, requests, dishes, onChanged, onSay, onStart }: {
  models: TenantModel[]
  requests: ModelRequest[]
  dishes: Dish[]
  onChanged: () => void
  onSay: (m: string, bad?: boolean) => void
  onStart: () => void
}) {
  const [filter, setFilter] = useState<'all' | 'draft' | 'approved' | 'rejected' | 'hidden'>('all')

  const shown = models.filter(m => filter === 'hidden' ? m.archived
    : !m.archived && (filter === 'all' || m.state === filter))
  const hiddenCount = models.filter(m => m.archived).length

  return (
    <div className="grid gap-4">
      {requests.length > 0 && (
        <div className="card p-5 grid gap-4 md:grid-cols-[180px_1fr] items-center">
          {/* A finished dish instead of a spinner. Unlabelled on purpose. */}
          <SampleDish height={160} />
          <div>
          <div className="eyebrow mb-3">Building</div>
          <div className="grid gap-2">
            {requests.map(r => (
              <div key={r.id} className="flex items-center gap-3 text-sm">
                {r.state === 'running' && (
                  <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--gold)' }} />
                )}
                <span className="flex-1 truncate">
                  {r.title || 'Dish'}{r.variant !== 'default' ? ` · ${r.variant}` : ''}
                  {r.kind === 'rescale' ? ' · resizing' : ''}
                </span>
                <span className={`pill ${r.state === 'failed' ? 'pill-off' : r.state === 'running' ? 'pill-wait' : 'pill-mute'}`}>
                  {WAITING[r.state]}
                </span>
                {r.state === 'failed' && r.note && (
                  <span className="text-xs hidden md:inline" style={{ color: 'var(--dim)' }}>{r.note}</span>
                )}
                {r.state !== 'failed' && (
                  <button className="btn btn-sm btn-ghost"
                          onClick={async () => {
                            const err = await cancelRequest(r.id)
                            if (err) onSay(err.message, true); else onChanged()
                          }}>Cancel</button>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] mt-3" style={{ color: 'var(--dim)' }}>
            A few minutes. Nothing goes on the menu until you approve it.
          </p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {(['all', 'draft', 'approved', 'rejected', 'hidden'] as const).map(f => {
          const n = f === 'all' ? models.filter(m => !m.archived).length
            : f === 'hidden' ? hiddenCount
            : models.filter(m => !m.archived && m.state === f).length
          if (f === 'hidden' && n === 0) return null
          return (
            <button key={f} onClick={() => setFilter(f)}
                    className="pill transition-colors"
                    style={{ background: filter === f ? 'var(--gold)' : 'var(--card2)',
                             color: filter === f ? 'var(--gold-ink)' : 'var(--dim)',
                             padding: '5px 12px', fontSize: 12 }}>
              {f === 'draft' ? 'waiting' : f} · {n}
            </button>
          )
        })}
      </div>

      {shown.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-semibold mb-1">
            {filter === 'all' ? 'No models yet.' : `Nothing ${filter === 'draft' ? 'waiting' : filter}.`}
          </p>
          {filter === 'all' && (
            <>
              <SampleDish height={240} className="max-w-sm mx-auto my-4" />
              <p className="text-sm mb-4" style={{ color: 'var(--dim)' }}>
                Four photos of a dish, and a few minutes. The first three are free.
              </p>
              <button className="btn btn-primary" onClick={onStart}>Build your first model</button>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))' }}>
          {shown.map(m => (
            <ModelCard key={m.id} model={m} dishes={dishes} onChanged={onChanged} onSay={onSay} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── one model ────────────────────────────────────────────────────────────────

function ModelCard({ model: m, dishes, onChanged, onSay }: {
  model: TenantModel
  dishes: Dish[]
  onChanged: () => void
  onSay: (m: string, bad?: boolean) => void
}) {
  const plan = usePlan()
  const [name, setName] = useState(m.title)
  const [panel, setPanel] = useState<null | 'angle' | 'size' | 'table'>(null)
  // Drafts open in 3D straight away: the owner's verdict is the point of a draft, and a
  // verdict from a still image is the wrong verdict. Everything else waits for a tap.
  const [live, setLive] = useState(m.state === 'draft' && !m.archived && !!m.glb)
  const [dims, setDims] = useState<Dims>({
    width: m.width_cm ?? (m.scale_axis === 'width' ? m.scale_cm : null),
    length: m.length_cm ?? (m.scale_axis === 'length' ? m.scale_cm : null),
    height: m.height_cm ?? (m.scale_axis === 'height' ? m.scale_cm : null),
  })

  const pill = m.state === 'approved' ? 'pill-on' : m.state === 'rejected' ? 'pill-off' : 'pill-wait'

  async function run(fn: () => Promise<{ message: string } | null | undefined>, ok?: string) {
    const err = await fn()
    if (err) return onSay(err.message, true)
    if (ok) onSay(ok)
    onChanged()
  }

  return (
    <div className="card overflow-hidden flex flex-col" style={{ opacity: m.archived ? .6 : 1 }}>
      <Preview model={m} pill={pill} open={live} onOpen={() => setLive(true)} />

      <div className="p-4 flex-1 flex flex-col gap-2.5">
        <input value={name} onChange={e => setName(e.target.value)}
               onBlur={() => { if (name.trim() !== m.title) run(() => renameModel(m.id, name)) }}
               className="font-semibold bg-transparent border-0 p-0 rounded-none text-[15px]"
               style={{ boxShadow: 'none' }} aria-label="Name" />

        <div className="flex items-center gap-2 text-xs flex-wrap" style={{ color: 'var(--dim)' }}>
          {m.variant !== 'default' && <span>{m.variant}</span>}
          {m.scale_cm
            ? <span title={`${[m.width_cm, m.length_cm, m.height_cm].filter(v => v != null).join(' × ')} cm`}>
                {/* The axis matters now that a dish can be sized by height alone:
                    the word anchors are WIDTHS, so a 12 cm-tall burger described as
                    'about a phone' is simply wrong. */}
                {sizeInWords(m.width_cm ?? m.scale_cm, m.height_cm,
                             (m.scale_axis as Axis) || 'width')}
              </span>
            : <span style={{ color: 'var(--gold)' }}>no size set</span>}
          <span>·</span>
          <span>{m.usedBy ? `on ${m.usedBy.name}` : 'not on a dish'}</span>
        </div>

        {m.state === 'draft' && !m.archived && (
          <>
            <p className="text-[11px]" style={{ color: 'var(--dim)' }}>
              Turn it around, and check the size on a real table before deciding.
            </p>
            <button className="btn btn-sm" onClick={() => setPanel(panel === 'table' ? null : 'table')}>
              {panel === 'table' ? 'Close' : 'Check it on your table'}
            </button>
          </>
        )}

        {panel === 'table' && (
          <div className="rounded-lg p-3 text-center" style={{ background: 'var(--card2)' }}>
            {/* The one size check that works. A number is abstract and a laptop screen has
                no scale; a phone puts the model on the table it will be served on, at the
                size it will ship at, and a boat looks like a boat. */}
            <QrCode size={150} label={`${m.title}-ar`}
                    value={`${MENU_ORIGIN}/ar?g=${encodeURIComponent(m.glb.split('/a/')[1] || '')}` +
                           `&u=${encodeURIComponent(m.usdz.split('/a/')[1] || '')}` +
                           `&n=${encodeURIComponent(m.title)}` +
                           `&s=${encodeURIComponent(m.scale_cm ? sizeInWords(m.width_cm ?? m.scale_cm, m.height_cm,
                             (m.scale_axis as Axis) || 'width') : '')}`} />
            <p className="text-[11px] mt-2" style={{ color: 'var(--dim)' }}>
              Scan with your phone. It appears on your table at the size it will ship at.
              Wrong? Resize below — that is free.
            </p>
          </div>
        )}
        {m.state === 'draft' && !m.archived && (
          <div className="flex gap-2 mt-1">
            <button className="btn btn-primary btn-sm flex-1" onClick={() => run(() => setVerdict(m.id, 'approved'), 'Approved')}>Approve</button>
            <button className="btn btn-sm flex-1" onClick={() => run(() => setVerdict(m.id, 'rejected'))}>Reject</button>
          </div>
        )}

        {m.state === 'approved' && !m.archived && (
          <select value={m.usedBy?.id ?? ''} className="text-xs"
                  onChange={async e => {
                    // Clear first, or a dish briefly points at a model another dish also
                    // points at.
                    if (m.usedBy) await attachModel(m.usedBy.id, null)
                    if (e.target.value) await attachModel(e.target.value, m.id)
                    onChanged()
                  }}>
            <option value="">Not on a dish</option>
            {dishes.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}

        <div className="flex gap-3 text-[11px] mt-auto pt-1 flex-wrap" style={{ color: 'var(--dim)' }}>
          {m.glb && m.state !== 'rejected' && (
            <button className="underline" onClick={() => setPanel(panel === 'angle' ? null : 'angle')}>starting angle</button>
          )}
          {m.glb && (
            <button className="underline" onClick={() => setPanel(panel === 'size' ? null : 'size')}>size</button>
          )}
          <button className="underline ml-auto"
                  onClick={() => run(() => setArchived(m.id, !m.archived), m.archived ? 'Back in the library' : 'Hidden')}>
            {m.archived ? 'show' : 'hide'}
          </button>
        </div>

        {panel === 'angle' && <Angle model={m} onSay={onSay} onChanged={onChanged} />}

        {panel === 'size' && (
          <div className="rounded-lg p-3 grid gap-3" style={{ background: 'var(--card2)' }}>
            <p className="text-[11px]" style={{ color: 'var(--dim)' }}>
              Resizing is free and takes a few seconds. It does not use a model.
            </p>
            <SizeInput value={dims} onChange={setDims} compact />
            <button className="btn btn-sm btn-primary" disabled={!hasDims(dims)}
                    onClick={() => run(() => requestRescale({
                      tenantId: plan.restaurantId!, dish: m.dish, variant: m.variant,
                      itemId: m.usedBy?.id ?? null, title: m.title, dims,
                    }), 'Resizing — a few seconds')}>
              Resize
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── the preview ──────────────────────────────────────────────────────────────

/** The OPTIMISED model, live, on tap. Never the master.
 *
 *  The master is 60-100 MB and two million triangles: a minute to download on a phone and
 *  a crash on an integrated GPU. It never ships to a diner, so optimising it is not
 *  optional and previewing it saves nothing - and approving from it would be approving
 *  something nobody will ever see. What is shown here is exactly what a diner gets. */
function Preview({ model: m, pill, open, onOpen }: {
  model: TenantModel; pill: string; open: boolean; onOpen: () => void
}) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !m.glb || !host.current) return
    let dead = false
    const mount = host.current
    ;(async () => {
      await ensureViewer()
      if (dead || mount.querySelector('model-viewer')) return
      const el = document.createElement('model-viewer')
      el.setAttribute('src', m.glb)
      el.setAttribute('camera-controls', '')
      el.setAttribute('auto-rotate', '')
      el.setAttribute('auto-rotate-delay', '0')
      el.setAttribute('rotation-per-second', '20deg')
      el.setAttribute('touch-action', 'pan-y')
      el.setAttribute('interaction-prompt', 'none')
      el.setAttribute('shadow-intensity', '0.6')
      if (m.poster) el.setAttribute('poster', m.poster)
      if (m.view_orbit) {
        const p = m.view_orbit.trim().split(/\s+/).map(Number)
        if (p.length === 3 && p.every(Number.isFinite)) el.setAttribute('camera-orbit', `${p[0]}deg ${p[1]}deg ${p[2]}%`)
      }
      el.style.cssText = 'width:100%;height:100%;background:var(--card2)'
      mount.appendChild(el)
    })()
    return () => { dead = true }
  }, [open, m.glb, m.poster, m.view_orbit])

  return (
    <div className="aspect-square relative" style={{ background: 'var(--card2)' }}>
      <div ref={host} className="absolute inset-0" />
      {!open && (
        m.poster
          ? <img src={m.poster} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
          : <span className="absolute inset-0 flex items-center justify-center text-xs" style={{ color: 'var(--dim)' }}>
              {m.glb ? '' : 'no preview yet'}
            </span>
      )}
      {!open && m.glb && (
        <button type="button" onClick={onOpen}
                className="absolute inset-0 flex items-end justify-center pb-3 group">
          <span className="btn btn-sm" style={{ background: 'rgba(0,0,0,.6)', borderColor: 'transparent', color: '#fff' }}>
            Turn it around
          </span>
        </button>
      )}
      <span className={`pill ${pill} absolute top-2 left-2`}>
        {m.state === 'draft' ? 'waiting for you' : m.state}
      </span>
    </div>
  )
}

// ── starting angle ───────────────────────────────────────────────────────────

/** Turn the dish to how it should first appear, then save it. Not three number inputs:
 *  a bowl framed from its own rim is an empty ellipse, and nobody types the right three. */
function Angle({ model: m, onSay, onChanged }: {
  model: TenantModel; onSay: (m: string, bad?: boolean) => void; onChanged: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<HTMLElement | null>(null)
  const framed = useRef(0)

  useEffect(() => {
    let dead = false
    ;(async () => {
      // Pinned to 3.4.0, the version production ships, so the admin frames a dish the way
      // a diner will see it. Loaded only when this panel opens.
      await ensureViewer()
      if (dead || !host.current || viewer.current) return
      const el = document.createElement('model-viewer')
      el.setAttribute('src', m.glb)
      el.setAttribute('camera-controls', '')
      el.setAttribute('touch-action', 'pan-y')
      el.setAttribute('interaction-prompt', 'none')
      el.setAttribute('loading', 'eager')
      el.style.cssText = 'width:100%;height:200px;background:var(--card2);border-radius:8px'
      if (m.view_orbit) {
        const p = m.view_orbit.trim().split(/\s+/).map(Number)
        if (p.length === 3 && p.every(Number.isFinite)) el.setAttribute('camera-orbit', `${p[0]}deg ${p[1]}deg ${p[2]}%`)
      }
      el.addEventListener('load', () => {
        const o = (el as unknown as { getCameraOrbit(): { radius: number } }).getCameraOrbit()
        const saved = m.view_orbit ? Number(m.view_orbit.trim().split(/\s+/)[2]) / 100 : 1
        framed.current = o.radius / (saved || 1)
      }, { once: true })
      host.current.appendChild(el)
      viewer.current = el
    })()
    return () => { dead = true }
  }, [m.glb, m.view_orbit])

  async function use() {
    const el = viewer.current as unknown as { getCameraOrbit(): { theta: number; phi: number; radius: number } } | null
    if (!el || !framed.current) return onSay('Give it a moment to load', true)
    const o = el.getCameraOrbit()
    const deg = (rad: number) => Math.round((rad * 180) / Math.PI)
    const h = Math.max(-360, Math.min(360, deg(o.theta)))
    const v = Math.max(0, Math.min(85, deg(o.phi)))
    const zoom = Math.max(30, Math.min(300, Math.round((o.radius / framed.current) * 100)))
    const err = await setOrbit(m.id, `${h} ${v} ${zoom}`)
    if (err) onSay(err.message, true); else { onSay('Angle saved'); onChanged() }
  }

  return (
    <div className="rounded-lg p-2" style={{ background: 'var(--card2)' }}>
      <div ref={host} />
      <div className="flex gap-2 mt-2">
        <button className="btn btn-primary btn-sm flex-1" onClick={use}>Use this angle</button>
        <button className="btn btn-sm" onClick={async () => {
          const err = await setOrbit(m.id, null)
          if (err) onSay(err.message, true); else { onSay('Back to the default'); onChanged() }
        }}>Default</button>
      </div>
    </div>
  )
}
