'use client'
// Home. The screen an owner sees every time, so it has to say "things are working" in
// two seconds and then get out of the way.
//
// Four things, in the order they matter:
//   is the menu live, and where            the thing they are paying for
//   what is being built right now          the thing they are waiting on
//   the number                             dishes with 3D vs without - the reason to stay
//   three actions                          the things they actually come here to do

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { usePlan } from '@/lib/usePlan'
import { createClient } from '@/lib/supabase/client'
import { loadLibrary, type ModelRequest, type TenantModel } from '@/lib/data/models'
import { useLang } from '@/lib/useLang'
import { text } from '@/lib/i18n'

const MENU_ORIGIN = process.env.NEXT_PUBLIC_MENU_ORIGIN || ''

export default function HomePage() {
  const [T] = useLang()
  const plan = usePlan()
  const router = useRouter()
  const [dishes, setDishes] = useState(0)
  const [with3d, setWith3d] = useState(0)
  const [requests, setRequests] = useState<ModelRequest[]>([])
  const [waiting, setWaiting] = useState<TenantModel[]>([])
  const [opens, setOpens] = useState<{ with3d: number; without: number } | null>(null)
  const [next3d, setNext3d] = useState<{ item_id: string; name: string; opens: number }[]>([])
  // `loading` is DERIVED, not set inside the effect. Every one of these screens used to
  // open with `setLoading(plan.loading)` in the effect body, which is a synchronous state
  // write during an effect and so a second render before the first has painted - on every
  // screen, on every navigation. Tracking which restaurant the data belongs to says the
  // same thing without the extra render, and correctly shows loading again when somebody
  // switches restaurant.
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const loading = plan.loading || (!!plan.restaurantId && loadedFor !== plan.restaurantId)

  const load = useCallback(async () => {
    if (plan.loading || !plan.restaurantId) return
    const supabase = createClient()
    const [{ data: t }, lib, { data: items }, { data: cmp }, { data: top }] = await Promise.all([
      supabase.from('tenants').select('setup_done').eq('id', plan.restaurantId).single(),
      loadLibrary(plan.restaurantId),
      supabase.from('items').select('id, model_id, is_3d, visible').eq('tenant_id', plan.restaurantId),
      supabase.rpc('event_3d_lift', { p_tenant: plan.restaurantId, p_days: 30 }),
      supabase.rpc('event_top_items', { p_tenant: plan.restaurantId, p_days: 30, p_limit: 30 }),
    ])
    // Setup not finished and nothing here yet: this is a brand-new restaurant, and the
    // guided flow is a better first screen than four empty cards.
    if (t && !t.setup_done && (items || []).length === 0) {
      router.replace(`/setup?tenant=${plan.restaurantSlug}`)
      return
    }
    const visible = (items || []).filter(i => i.visible)
    setDishes(visible.length)
    setWith3d(visible.filter(i => i.model_id && i.is_3d).length)
    setRequests(lib.requests.filter(r => r.state !== 'failed'))
    setWaiting(lib.models.filter(m => m.state === 'draft'))
    const row = Array.isArray(cmp) ? cmp[0] : cmp
    setOpens(row ? { with3d: Number(row.with_3d), without: Number(row.without_3d) } : null)
    // The next action, from their own diners: the most-opened dishes that have no 3D yet.
    // A dashboard that says what to do next gets opened; one that reports gets ignored.
    const has3d = new Set((items || []).filter(i => i.model_id && i.is_3d).map(i => i.id))
    setNext3d(((top || []) as { item_id: string; name: string; opens: number }[])
      .filter(x => x.item_id && !has3d.has(x.item_id) && x.opens > 0).slice(0, 3))
    setLoadedFor(plan.restaurantId)
  }, [plan.loading, plan.restaurantId, plan.restaurantSlug, router])

  useEffect(() => { void load() }, [load])

  if (loading) return <p style={{ color: 'var(--dim)' }}>Loading…</p>
  if (!plan.restaurantId) return <p style={{ color: 'var(--dim)' }}>{T.pickRestaurantFirst}</p>

  const url = `${MENU_ORIGIN}/${plan.restaurantSlug}`
  const q = `?tenant=${plan.restaurantSlug}`
  const lift = opens && opens.without > 0 ? opens.with3d / opens.without : null

  return (
    <div className="page-content">
      <h1 className="page-title mb-6">{plan.restaurantName}</h1>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--success)' }} />
            <span className="eyebrow">{T.homeLive}</span>
          </div>
          <a href={url} target="_blank" rel="noreferrer" className="font-semibold break-all"
             style={{ color: 'var(--gold)' }}>{url.replace(/^https?:\/\//, '')}</a>
          <p className="text-xs mt-2" style={{ color: 'var(--dim)' }}>
            {text(T.homeDishCount, { n: dishes, n3d: with3d })}
          </p>
          <Link href={`/share${q}`} className="btn btn-sm mt-4">{T.homeQrCode}</Link>
        </div>

        <div className="card p-5">
          {/* The heading follows what is actually in the list. With a `pending` request
              and nothing else, "Building" is false - that request is over quota and
              waiting on one of us, and no engine has it. Same fix as the Studio's own
              panel; this card lists the states per row, so it was the heading alone that
              was wrong here. */}
          <div className="eyebrow mb-2">
            {requests.length > 0 && requests.every(r => r.state === 'pending')
              ? T.studioWaitingUsHeading : T.studioBuildingHeading}
          </div>
          {requests.length === 0 && waiting.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--dim)' }}>{T.homeNothingInProgress}</p>
          ) : (
            <div className="grid gap-1 text-sm">
              {requests.map(r => (
                <div key={r.id} className="flex gap-2">
                  <span className="flex-1 truncate">{r.title || T.dishWord}</span>
                  <span className="text-xs" style={{ color: 'var(--dim)' }}>
                    {r.state === 'running' ? T.waitRunning
                      : r.state === 'pending' ? T.waitPending : T.waitApproved}
                  </span>
                </div>
              ))}
              {waiting.length > 0 && (
                <Link href={`/models${q}`} className="text-xs mt-1 underline" style={{ color: 'var(--gold)' }}>
                  {text(T.homeReadyToApprove, { n: waiting.length })}
                </Link>
              )}
            </div>
          )}
        </div>

        <div className="card p-5 md:col-span-2">
          <div className="eyebrow mb-2">{T.homeLiftTitle}</div>
          {lift === null ? (
            <p className="text-sm" style={{ color: 'var(--dim)' }}>
              {T.homeLiftEmpty}
            </p>
          ) : (
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-3xl font-bold" style={{ color: 'var(--gold)' }}>
                {lift.toFixed(1)}×
              </span>
              <span className="text-sm">
                {text(T.homeLiftBody, { x: lift.toFixed(1) })}
              </span>
            </div>
          )}
          <p className="text-xs mt-3" style={{ color: 'var(--dim)' }}>
            {T.homeLiftFootnote}{' '}
            <Link href={`/dashboard${q}`} className="underline">{T.homeAllNumbers}</Link>
          </p>
        </div>
      </div>

      {next3d.length > 0 && (
        <div className="card p-5 mt-4">
          <div className="eyebrow mb-2">{T.homeBuildNext}</div>
          <p className="text-sm mb-3">
            {T.homeBuildNextHint}
          </p>
          <div className="flex gap-2 flex-wrap">
            {next3d.map(d => (
              <Link key={d.item_id} href={`/models${q}`} className="btn btn-sm">
                {d.name} <span style={{ color: 'var(--dim)' }}>· {text(T.homeOpens, { n: d.opens })}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3 mt-4">
        <Link href={`/menu${q}`} className="btn">{T.homeEditMenu}</Link>
        <Link href={`/models${q}`} className="btn btn-primary">{T.homeMakeModel}</Link>
        <Link href={`/theme${q}`} className="btn">{T.homeChangeLook}</Link>
      </div>
    </div>
  )
}
