// Reading a menu out of an uploaded file.
//
// **Switched off.** Without `ANTHROPIC_API_KEY` this answers 501 and nothing else
// happens - no upload is accepted, no model is called, nothing is billed. The route
// exists now so the decision to turn it on is one environment variable and a review of
// this file, rather than a feature built under time pressure later.
//
// It does NOT hold the service key, so it is not on the privileged list in
// `check_admin.py`: it reads a file and calls out, and the only thing it writes is
// nothing. The rows it returns go back to the browser and are saved by the owner through
// the normal menu writers, under their own RLS.
//
// Two rules for when this is finished:
//
//   the key never reaches the browser   which is the whole reason this is a route and not
//                                       a fetch from the client
//   nothing is saved from here          the model's output is a DRAFT. It reaches the
//                                       menu only after a person has looked at it, because
//                                       these are prices going onto a diner's phone with
//                                       no draft step and no undo

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** The biggest file worth trying. A menu photographed at phone resolution is a few MB; a
 *  50 MB scan is somebody uploading the wrong thing. */
const MAX_BYTES = 12 * 1024 * 1024

export async function POST(req: NextRequest) {
  // Signed in first, before anything is read off the wire.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'Menu import is not switched on for this deployment.' },
      { status: 501 },
    )
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'That file is larger than 12 MB.' }, { status: 413 },
    )
  }

  // Deliberately not implemented yet. When it is:
  //
  //   spreadsheet  parse to text in the ROUTE, not the browser, so one code path reads
  //                every format and the review screen never has to know which
  //   pdf          text layer if there is one; a page that yields no text is a scan and
  //                goes down the image path
  //   image        straight to the model as an image block
  //
  // ...then one call with a schema, returning `ImportResult` from `lib/menuImport.ts`.
  // Model: `claude-sonnet-5` is the right tier for reading a menu - about $0.19 for a
  // 170-dish menu across eight pages. Use structured outputs (`output_config.format`) so
  // the rows come back validated rather than parsed out of prose.
  return NextResponse.json(
    { error: 'Menu import is not implemented yet.' }, { status: 501 },
  )
}
