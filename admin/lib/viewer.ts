// model-viewer, loaded once, from the CDN, pinned to the version production ships.
//
// Not an npm dependency: it wants a three.js peer that fights everything else in the
// tree, and the admin needs it on three screens, not in its bundle. 3.4.0 because that is
// what a diner's page loads, so the admin frames a dish exactly the way a diner will see
// it. Loaded when something first asks, never on page load.

export const VIEWER_SRC =
  'https://cdnjs.cloudflare.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js'

let ready: Promise<void> | null = null

export function ensureViewer(): Promise<void> {
  if (ready) return ready
  ready = new Promise<void>(resolve => {
    if (typeof window === 'undefined') return resolve()
    if (customElements.get('model-viewer')) return resolve()
    const tag = document.createElement('script')
    tag.type = 'module'
    tag.src = VIEWER_SRC
    // Resolves either way: a blocked CDN must leave the rest of the screen working with
    // an empty panel, not hanging on a promise that never settles.
    tag.onload = () => resolve()
    tag.onerror = () => resolve()
    document.head.appendChild(tag)
  })
  return ready
}

/** The sample dishes: the ones that rotate while a model builds, on the signup page, and
 *  in every empty state. The product, always visible, never described.
 *
 *  A list so they can cycle. The first is the Druidi burger from 3darmenu.pages.dev,
 *  Draco-compressed by our own optimiser to 220 KB. Add more here; nothing else changes. */
export const SAMPLES = [
  {
    id: 'druidi',
    name: 'Druidi burger',
    glb: '/a/catalog/samples/druidi/model_draco.glb',
    usdz: '/a/catalog/samples/druidi/model.usdz',
    // A burger reads best slightly from above and turned a touch off-centre.
    orbit: '30deg 70deg 105%',
  },
]

export function sampleUrl(path: string) {
  return `${process.env.NEXT_PUBLIC_MENU_ORIGIN || ''}${path}`
}
