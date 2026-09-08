// Save a file the browser is looking at, with a name a person can read.
//
// **Why not just a link.** The obvious `<a href={m.glb} download>` does not work here: the
// `download` attribute is ignored on a CROSS-ORIGIN href, and the admin and the files are
// two different origins on purpose - the menu Worker serves R2, the admin does not. Chrome
// silently navigates to the model instead of saving it, which on a .glb means a blank tab.
//
// So the bytes are fetched (the Worker sends `Access-Control-Allow-Origin: *`, because a
// diner's model-viewer needs that too) and handed to a blob URL, which IS same-origin and
// where `download` is honoured. The object URL is revoked afterwards; without that the
// whole file stays in memory for the life of the tab, and these are 4 MB each.
//
// The name matters more than it sounds. The stored key is
// `catalog/114ac591-cbe9-4565-9f12-279cbfcc533a/default/model_draco.glb` - fine for a
// bucket, useless in a downloads folder. This saves
// `sushi-spicy-philadelphia.glb`.

/** A filename from a dish's name: lowercase, dashes, no surprises for any OS. */
export function fileName(title: string, variant: string, ext: string): string {
  const base = (title || 'model')
    .toLowerCase()
    .normalize('NFKD')
    // Georgian is not transliterable to something useful, so anything non-ASCII becomes a
    // separator rather than mojibake or an empty name.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'model'
  const v = variant && variant !== 'default'
    ? '-' + variant.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    : ''
  return `${base}${v}.${ext}`
}

/** Fetch and save. Returns an error message, or null when the file is on its way. */
export async function saveAs(url: string, name: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return `The file could not be fetched (HTTP ${res.status}).`
    const blob = await res.blob()
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    // A tick, not immediately: revoking before the browser has started reading the blob
    // cancels the download in Firefox and, intermittently, in Chrome.
    setTimeout(() => URL.revokeObjectURL(href), 10_000)
    return null
  } catch (e) {
    return `The file could not be fetched: ${(e as Error).message}`
  }
}

/** How big it is, without fetching it. `null` when the server will not say. */
export async function sizeOf(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    const n = Number(res.headers.get('content-length'))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function humanSize(bytes: number | null): string {
  if (!bytes) return ''
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`
}
