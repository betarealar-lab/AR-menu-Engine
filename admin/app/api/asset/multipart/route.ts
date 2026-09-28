// A model file, in parts. Developers only.
//
// **Why this exists next to /api/asset.** A Meshy master is 60-290 MB. The one-shot route
// reads the whole file into the Worker (`formData()`, then `arrayBuffer()`), and a Worker
// has 128 MB of memory - and before that, Next's proxy buffers only the first 10 MB of any
// request body. So the files a developer most needs to move are exactly the ones that
// route cannot take.
//
// So the browser cuts the file into parts and this route hands each one to an R2
// MULTIPART upload through the binding. No part is ever bigger than PART_MAX, nothing is
// held between requests except R2's own upload id, and - like /api/asset - there is no
// access key, no presigned URL and no bucket CORS to configure. R2 requires every part
// but the last to be at least 5 MiB; the client sends 8 MiB.
//
// Actions, one route:
//   POST { action: 'create', filename, size, purpose } -> { key, uploadId }
//   POST form: action=part, key, uploadId, n, file     -> { partNumber, etag }
//   POST { action: 'complete', key, uploadId, parts }  -> { key }
//   POST { action: 'abort', key, uploadId }
//
// Where it lands, in the PHOTOS bucket (see /api/asset for why there is one):
//   purpose 'optimise' -> lib/raw/<uuid>.glb    an INPUT: the bridge (0030, kind 'upload')
//                                               adopts it as a master and the optimiser
//                                               makes the files that ship
//   purpose 'asis'     -> lib/asis/<uuid>.glb|.usdz   SHIPPED exactly as uploaded
//                                               (2026-09-28: "upload model with no
//                                               optimization option")
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'

// Just under the 10 MB Next's proxy buffers (see lib/data/dev.ts, PART).
const PART_MAX = 9 * 1024 * 1024
const TOTAL_MAX = 400 * 1024 * 1024
const TYPES: Record<string, string> = { glb: 'model/gltf-binary', usdz: 'model/vnd.usdz+zip' }
const PREFIXES = ['lib/raw/', 'lib/asis/']

type Part = { partNumber: number; etag: string }
type Upload = {
  uploadPart(n: number, v: Uint8Array): Promise<Part>
  complete(parts: Part[]): Promise<unknown>
  abort(): Promise<void>
}
type Bucket = {
  createMultipartUpload(k: string, o?: { httpMetadata?: { contentType?: string } }):
    Promise<{ key: string; uploadId: string }>
  resumeMultipartUpload(k: string, id: string): Upload
}

function binding(): Bucket | null {
  try {
    return (getCloudflareContext().env as unknown as Record<string, Bucket>).PHOTOS ?? null
  } catch {
    return null
  }
}

function bucketName() {
  return process.env.R2_BUCKET_PHOTOS || 'betareal-photos'
}

/** Development only - the SDK, imported lazily so it never reaches the Worker bundle. */
async function s3() {
  const sdk = await import('@aws-sdk/client-s3')
  const client = new sdk.S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
  return { sdk, client }
}

async function isSuper() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  // limit(1): a super admin can see every row of super_admins (see /api/asset).
  const { data } = await supabase.from('super_admins').select('user_id').limit(1).maybeSingle()
  return !!data
}

const ours = (key: string) => PREFIXES.some(p => key.startsWith(p))
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

export async function POST(req: NextRequest) {
  if (!(await isSuper())) return bad('Only BetaReal uploads model files', 403)

  const isForm = (req.headers.get('content-type') || '').includes('multipart/form-data')
  if (isForm) {
    const form = await req.formData()
    if (String(form.get('action')) !== 'part') return bad('Unknown action')
    const key = String(form.get('key') || '')
    const uploadId = String(form.get('uploadId') || '')
    const n = Number(form.get('n'))
    const file = form.get('file')
    if (!ours(key) || !uploadId || !(n >= 1 && n <= 10000)) return bad('Bad part')
    if (!(file instanceof File)) return bad('No bytes')
    if (file.size > PART_MAX) return bad('Part too large', 413)
    const bytes = new Uint8Array(await file.arrayBuffer())

    const b = binding()
    if (b) {
      const part = await b.resumeMultipartUpload(key, uploadId).uploadPart(n, bytes)
      return NextResponse.json(part)
    }
    const { sdk, client } = await s3()
    const out = await client.send(new sdk.UploadPartCommand({
      Bucket: bucketName(), Key: key, UploadId: uploadId, PartNumber: n, Body: bytes,
    }))
    return NextResponse.json({ partNumber: n, etag: out.ETag || '' })
  }

  const body = await req.json().catch(() => ({})) as {
    action?: string; filename?: string; size?: number; purpose?: string
    key?: string; uploadId?: string; parts?: Part[]
  }

  if (body.action === 'create') {
    const ext = (body.filename || '').split('.').pop()?.toLowerCase() || ''
    const purpose = body.purpose === 'asis' ? 'asis' : 'raw'
    // The optimiser reads GLB only; a USDZ is only ever shipped as it is.
    if (!(ext === 'glb' || (ext === 'usdz' && purpose === 'asis'))) {
      return bad(purpose === 'asis' ? 'Only .glb or .usdz files' : 'Only .glb files')
    }
    if ((body.size || 0) > TOTAL_MAX) return bad('That file is over 400 MB', 413)
    const key = `lib/${purpose}/${crypto.randomUUID()}.${ext}`
    const b = binding()
    if (b) {
      const up = await b.createMultipartUpload(key, { httpMetadata: { contentType: TYPES[ext] } })
      return NextResponse.json({ key: up.key, uploadId: up.uploadId })
    }
    const { sdk, client } = await s3()
    const out = await client.send(new sdk.CreateMultipartUploadCommand({
      Bucket: bucketName(), Key: key, ContentType: TYPES[ext],
    }))
    return NextResponse.json({ key, uploadId: out.UploadId })
  }

  if (body.action === 'complete') {
    const { key = '', uploadId = '', parts = [] } = body
    if (!ours(key) || !uploadId || !parts.length) return bad('Bad completion')
    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber)
    const b = binding()
    if (b) {
      await b.resumeMultipartUpload(key, uploadId).complete(sorted)
      return NextResponse.json({ key })
    }
    const { sdk, client } = await s3()
    await client.send(new sdk.CompleteMultipartUploadCommand({
      Bucket: bucketName(), Key: key, UploadId: uploadId,
      MultipartUpload: { Parts: sorted.map(p => ({ PartNumber: p.partNumber, ETag: p.etag })) },
    }))
    return NextResponse.json({ key })
  }

  if (body.action === 'abort') {
    const { key = '', uploadId = '' } = body
    if (!ours(key) || !uploadId) return bad('Bad abort')
    const b = binding()
    if (b) await b.resumeMultipartUpload(key, uploadId).abort()
    return NextResponse.json({ ok: true })
  }

  return bad('Unknown action')
}
