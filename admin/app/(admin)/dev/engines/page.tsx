'use client'
// Engines: which ones exist, which are switched on, what each costs, and how to swap.
//
// A reference screen, not a control panel. The choice of engine is made per build in the
// Library Studio; this is where a developer sees the whole set and what turning fal on
// would take. The list is `ENGINES` in lib/data/dev.ts, kept in step by hand with
// `engines.REGISTRY` on the Python side - a name here the registry does not have fails
// the job with a sentence, never silently falls back to Meshy.

import { usePlan } from '@/lib/usePlan'
import DevNav from '@/components/DevNav'
import EngineBanner from '@/components/EngineBanner'
import { ENGINES, DEFAULT_ENGINE } from '@/lib/data/dev'

export default function EnginesPage() {
  const plan = usePlan()
  if (!plan.loading && plan.role !== 'super_admin') {
    return <div className="p-6 text-sm" style={{ color: 'var(--dim)' }}>This page is for BetaReal.</div>
  }
  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <DevNav />
      <p className="eyebrow">Developer</p>
      <h1 className="text-2xl font-bold mb-1">Engines</h1>
      <p className="text-sm mb-5" style={{ color: 'var(--dim)' }}>
        Every engine sits behind one interface. The optimiser, the catalogue and the menu never
        know which one made a model. Switching is one name per build.
      </p>
      <EngineBanner />

      <div className="card overflow-hidden mb-6">
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs" style={{ color: 'var(--dim)' }}>
                <th className="p-3">Engine</th><th className="p-3">Via</th>
                <th className="p-3">Photos</th><th className="p-3">Per model</th>
                <th className="p-3">State</th><th className="p-3">Note</th>
              </tr>
            </thead>
            <tbody>
              {ENGINES.map(e => (
                <tr key={e.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="p-3 font-medium whitespace-nowrap">
                    {e.label}{e.id === DEFAULT_ENGINE && <span className="pill pill-wait ml-2">default</span>}
                    <div className="text-[11px] font-normal" style={{ color: 'var(--dim)' }}>{e.id}</div>
                  </td>
                  <td className="p-3">{e.provider === 'meshy' ? 'Meshy API (Pro plan)' : 'fal.ai'}</td>
                  <td className="p-3">up to {e.views}</td>
                  <td className="p-3 whitespace-nowrap">{e.cost}</td>
                  <td className="p-3">
                    <span className={`pill ${e.wired ? 'pill-on' : 'pill-mute'}`}>{e.wired ? 'on' : 'off'}</span>
                  </td>
                  <td className="p-3 text-xs" style={{ color: 'var(--dim)' }}>{e.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-4 text-sm grid gap-2">
          <h2 className="font-semibold">Switching fal on</h2>
          <p style={{ color: 'var(--dim)' }}>
            The adapter is written (<code>engines/fal.py</code>) and off on purpose. On the engine host:
          </p>
          <pre className="text-xs p-3 rounded-lg overflow-x-auto" style={{ background: 'var(--card2)' }}>{`FAL_KEY=...            # fal.ai → API keys
BETAREAL_ENABLE_FAL=1
FAL_WEBHOOK_URL=...    # optional; polling works without it`}</pre>
          <p style={{ color: 'var(--dim)' }}>
            Then flip <code>wired</code> to true for the fal rows in <code>lib/data/dev.ts</code> so they can be picked here.
            Nothing else changes: same queue, same optimiser, same library.
          </p>
        </div>
        <div className="card p-4 text-sm grid gap-2">
          <h2 className="font-semibold">Why it matters</h2>
          <ul className="list-disc pl-5 grid gap-1" style={{ color: 'var(--dim)' }}>
            <li><b>The monthly cap binds first.</b> Meshy Pro is 1,000 credits: about 33 models, or 6–7 restaurants a month. fal bills per use with no cap.</li>
            <li><b>More than four photos.</b> Hunyuan 3.1 Pro takes up to 8 views (top and 45° fronts included). Meshy stops at 4.</li>
            <li><b>Meshy through fal costs twice as much</b> ($1.20 against $0.60). Keep Meshy direct while the plan lasts.</li>
            <li>Meshy 7.1 also added <code>texture_image_urls</code> (separate texture reference photos). Worth one test on a glossy dish.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
