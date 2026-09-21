// The block a restaurant pastes into their own website, and the site list that governs it.
//
// **The block is generated, never hand-written, and that is the whole point.** A cross-origin
// frame only gets AR if the page that holds it grants `xr-spatial-tracking`; a person
// typing an iframe forgets that, and AR silently becomes a 3D preview. Generated, it is
// always there. It is also ONE body-level block with no <head> step, because a head/custom
// code field is the most plan-gated feature on every website builder, while an HTML/embed
// block is on almost all of them. See EMBED.md.
//
// Everything that decides photo-or-3D lives in the menu app (app/src/lib/embed.js); this
// file only writes HTML and cleans a list.

const escAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The menu app's address, without a trailing slash. */
export function menuOrigin(): string {
  return (process.env.NEXT_PUBLIC_MENU_ORIGIN || '').replace(/\/$/, '')
}

/** The dish on its own: a bio, a message, a QR on a delivery bag. */
export function dishLink(itemId: string, origin = menuOrigin()): string {
  return `${origin}/d/${itemId}`
}

/** One self-contained block: a wrapper, the frame, and the optional loader. Works with the
 *  loader stripped (some builders strip scripts) - the frame alone still shows the dish in
 *  3D and still does AR on Android; the loader is what lets an iPhone open AR in place. */
export function embedSnippet(itemId: string, dishName: string, origin = menuOrigin()): string {
  const title = escAttr(`${dishName || 'Dish'} in 3D`)
  return [
    `<div data-betareal-dish="${itemId}" style="position:relative;max-width:560px">`,
    `  <iframe src="${dishLink(itemId, origin)}" title="${title}" loading="lazy"`,
    `          allow="xr-spatial-tracking; fullscreen" allowfullscreen`,
    `          style="display:block;width:100%;aspect-ratio:4/3;border:0;border-radius:12px"></iframe>`,
    `</div>`,
    `<script async src="${origin}/embed.js"></script>`,
  ].join('\n')
}

/** "https://www.Restaurant-X.ge/menu" -> "restaurant-x.ge". The same rule as the menu
 *  app's normalizeSite - kept in step by hand, because the two apps do not share code and
 *  this one only has to produce values that one accepts. */
export function normalizeSite(value: string): string {
  let s = String(value || '').trim().toLowerCase()
  if (!s) return ''
  if (!/^[a-z]+:\/\//.test(s)) s = `https://${s}`
  let host: string
  try { host = new URL(s).hostname } catch { return '' }
  host = host.replace(/^www\./, '').replace(/\.$/, '')
  if (!/^[a-z0-9.-]+$/.test(host) || (!host.includes('.') && host !== 'localhost')) return ''
  return host
}

/** A textarea's worth of sites -> the clean, de-duplicated list that is stored, plus the
 *  lines that were not a site at all, so the screen can say which. */
export function parseSites(text: string): { sites: string[]; rejected: string[] } {
  const sites: string[] = []
  const rejected: string[] = []
  for (const line of String(text || '').split(/[\n,]+/)) {
    const raw = line.trim()
    if (!raw) continue
    const host = normalizeSite(raw)
    if (!host) rejected.push(raw)
    else if (!sites.includes(host)) sites.push(host)
  }
  return { sites, rejected }
}
