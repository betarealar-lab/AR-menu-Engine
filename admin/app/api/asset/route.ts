// Uploading a file: a dish photo, a hero image, a logo, a model, a hero video.
//
// Replaces the platform's `/api/r2-presign`. Same rules, different plumbing.
//
// **The rules are kept because they are right**, and the reasoning is the platform's own:
// a photo the browser re-encodes to WebP before upload cannot be much larger than the hero
// it replaces, but a video straight off a phone is tens of megabytes at the top of the
// page and nothing in the browser trims it. Models are produced by us and are the one
// thing an owner cannot re-make if they break it. So photos are an owner's to upload;
// models and videos are ours.
//
// **The plumbing changed because presigning does not fit our buckets.** The platform's
// bucket is public and its route hands the browser a presigned PUT. Ours are private and
// served by the menu app (MENU-PLATFORM §2.6), and a browser PUT straight to R2 needs CORS
// configured on the bucket - infrastructure that has to be right in three environments
// before an upload works anywhere. One-step through here needs none of that, and it is one
// round trip instead of two.

import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { createClient } from '@/lib/supabase/server'

type Kind = 'photo' | 'hero' | 'logo' | 'glb' | 'usdz' | 'video'

const RULES: Record<Kind, { ext: string; type: string; bucket: 'photos' | 'models'
                            ours: boolean; max: number }> = {
  photo: { ext: 'webp', type: 'image/webp',           bucket: 'photos', ours: false, max: 4  },
  hero:  { ext: 'webp', type: 'image/webp',           bucket: 'photos', ours: false, max: 6  },
  logo:  { ext: 'webp', type: 'image/webp',           bucket: 'photos', ours: false, max: 2  },
  glb:   { ext: 'glb',  type: 'model/gltf-binary',    bucket: 'models', ours: true,  max: 40 },
  usdz:  { ext: 'usdz', type: 'model/vnd.usdz+zip',   bucket: 'models', ours: true,  max: 40 },
  video: { ext: 'mp4',  type: 'video/mp4',            bucket: 'models', ours: true,  max: 60 },
}

function bucketName(which: 'photos' | 'models') {
  return which === 'models'
    ? process.env.R2_BUCKET_MODELS || 'betareal-models'
    : process.env.R2_BUCKET_PHOTOS || 'betareal-photos'
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const form = await req.formData()
  const file = form.get('file')
  const kind = String(form.get('kind') || '') as Kind
  const tenantId = String(form.get('tenantId') || '')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file' }, { status: 400 })
  }
  const rule = RULES[kind]
  if (!rule) return NextResponse.json({ error: 'Unknown kind of file' }, { status: 400 })
  if (file.size > rule.max * 1024 * 1024) {
    return NextResponse.json({ error: `That file is over ${rule.max} MB` }, { status: 413 })
  }

  // Membership is checked by asking for the restaurant AS the user. RLS answers, so an id
  // somebody else owns simply comes back empty and there is no second rule here that could
  // disagree with the policy.
  const { data: tenant } = await supabase
    .from('tenants').select('id').eq('id', tenantId).maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'Restaurant not found' }, { status: 403 })

  if (rule.ours) {
    const { data: isSuper } = await supabase
      .from('super_admins').select('user_id').maybeSingle()
    if (!isSuper) {
      return NextResponse.json(
        { error: kind === 'video'
            ? 'Hero videos are uploaded by BetaReal - send us the file'
            : 'BetaReal builds the 3D models. Use "Make a 3D model" instead.' },
        { status: 403 },
      )
    }
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  // Content-addressed, so re-uploading the same file makes no second copy and a rename
  // never rots a URL. Keyed on the tenant UUID, never the slug: the slug is an address,
  // and a prefix carrying it spreads a restaurant's files over two places after a rename.
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('')
  const key = `t/${tenantId}/${kind}/${hash}.${rule.ext}`

  const s3 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
  await s3.send(new PutObjectCommand({
    Bucket: bucketName(rule.bucket), Key: key, Body: bytes, ContentType: rule.type,
  }))

  // The buckets are private and ONE service serves them - the menu app, which already has
  // the route, the cache headers and the CORS a 3D viewer needs. The admin points at it
  // rather than growing a second copy that can disagree about any of those.
  const origin = process.env.NEXT_PUBLIC_MENU_ORIGIN || ''
  return NextResponse.json({ key, url: `${origin}/a/${key}`, publicUrl: `${origin}/a/${key}` })
}
