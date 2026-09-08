// One way to put a file somewhere, used by every screen that uploads one.
//
// The platform does this in two steps at seven call sites: ask a route for a presigned
// URL, then PUT to R2 from the browser. Ours is one POST to our own route, because the
// buckets are private and a browser PUT straight to R2 needs CORS configured on the bucket
// in every environment before an upload works anywhere.
//
// Collapsing it here rather than at each call site matters for a duller reason: seven
// copies of "if the response is not ok, throw the right message" is seven chances for one
// of them to swallow a failure and leave an owner looking at a spinner.

export type AssetKind = 'photo' | 'hero' | 'logo' | 'glb' | 'usdz' | 'video'

/** Where the file landed: the R2 KEY and the URL that serves it.
 *
 *  Both, because they are used for different things and returning only one has already
 *  cost something. `models.draco_key` stores a KEY - the admin adds the origin when it
 *  renders - so a caller handed only a URL cannot record what it uploaded. The .glb button
 *  in the item editor did exactly that: the file went to R2, the URL went into local form
 *  state, `saveItem` never persisted it, and the pointer was dropped on save. An upload
 *  that succeeds and is then forgotten is worse than one that fails.
 */
export type Uploaded = { key: string; url: string }

export async function uploadAsset(
  blob: Blob,
  kind: AssetKind,
  tenantId: string | null,
  filename = 'upload',
): Promise<Uploaded> {
  if (!tenantId) throw new Error('No restaurant selected')
  const form = new FormData()
  form.append('file', blob, filename)
  form.append('kind', kind)
  form.append('tenantId', tenantId)

  const res = await fetch('/api/asset', { method: 'POST', body: form })
  if (!res.ok) {
    // The route's own words where it has them: "BetaReal builds the 3D models" is worth
    // showing an owner, and "Server error 403" is not.
    const detail = await res.json().catch(() => ({} as { error?: string }))
    throw new Error(detail.error || `Upload failed (${res.status})`)
  }
  const { key, url } = await res.json()
  return { key: key as string, url: url as string }
}
