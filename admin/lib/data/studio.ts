// The 3D studio's data layer: the photo library, and everything the plate does.
//
// Sits beside models.ts (the library of finished models) rather than inside it, because
// the two halves change for different reasons: this one follows what Scan Studio can do
// with photos, that one follows what a diner's page needs from a model.
//
// Nothing here has heard of Meshy, credits, or an engine name. Multiview is a row the
// bridge picks up; a rescale is a request with kind 'rescale'; the cost of either is the
// engine's business and stays on that side.

import { createClient } from '@/lib/supabase/client'

export type Capture = {
  id: string
  dish: string
  variant: string
  slot: number
  key: string
  url: string
  generated: boolean
  created_utc: string
}

export type CaptureTask = {
  id: string
  dish: string
  variant: string
  state: 'queued' | 'running' | 'done' | 'failed'
  note: string
}

/** The plate sizes, from dataset.SHAPES. One real-world dimension is enough: the model
 *  supplies the aspect ratio for the others. "Flat plated, 28 cm" is what most dishes are,
 *  and it is the answer an owner can give without a tape measure. */
export const SHAPES = [
  { id: 'flat-plated',  label: 'Flat plate',          axis: 'width',  cm: 28 },
  { id: 'deep-bowl',    label: 'Bowl',                axis: 'width',  cm: 18 },
  { id: 'wide-flat',    label: 'Sharing platter',     axis: 'width',  cm: 35 },
  { id: 'tall-stacked', label: 'Tall (burger, cake)', axis: 'height', cm: 12 },
] as const

const assetUrl = (key: string) =>
  key.startsWith('http') ? key : `${process.env.NEXT_PUBLIC_MENU_ORIGIN || ''}/a/${key}`

export async function loadCaptures(tenantId: string): Promise<Capture[]> {
  const supabase = createClient()
  const { data } = await supabase.from('captures')
    .select('id, dish, variant, slot, key, generated, created_utc')
    .eq('tenant_id', tenantId).order('created_utc', { ascending: false })
  return ((data || []) as Omit<Capture, 'url'>[]).map(c => ({ ...c, url: assetUrl(c.key) }))
}

/** Put a frame in a slot. An upsert: replacing a photo is the normal case, and the old
 *  key stays in the bucket - the photos outlive everything (0007). */
export async function saveCapture(
  tenantId: string, dish: string, variant: string, slot: number, key: string,
) {
  const supabase = createClient()
  const { data, error } = await supabase.from('captures')
    .upsert({ tenant_id: tenantId, dish, variant, slot, key, generated: false },
            { onConflict: 'tenant_id,dish,variant,slot' })
    .select('id, dish, variant, slot, key, generated, created_utc').single()
  return { capture: data ? { ...data, url: assetUrl(data.key) } as Capture : null, error }
}

export async function removeCapture(id: string) {
  const supabase = createClient()
  const { error } = await supabase.from('captures').delete().eq('id', id)
  return error
}

/** Ask for the other three angles to be predicted from the one that exists. Free, and once
 *  per dish - the unique index in 0012 refuses a second one, failed or not, so the "once"
 *  cannot be worked around by asking again. */
export async function requestMultiview(
  tenantId: string, dish: string, variant: string, sourceSlot: number,
) {
  const supabase = createClient()
  const { error } = await supabase.from('capture_tasks')
    .insert({ tenant_id: tenantId, dish, variant, source_slot: sourceSlot })
  if (error?.code === '23505') {
    return { message: 'The other angles were already predicted for this dish once. ' +
                      'Add real photos for the rest.' }
  }
  return error
}

export async function loadCaptureTasks(tenantId: string): Promise<CaptureTask[]> {
  const supabase = createClient()
  const { data } = await supabase.from('capture_tasks')
    .select('id, dish, variant, state, note').eq('tenant_id', tenantId)
  return (data || []) as CaptureTask[]
}

/** Ask for a model. The size goes with it, so the engine bakes the right one in the
 *  first time - wrong size is the single most common reason a model gets remade. */
export async function requestBuild(args: {
  tenantId: string
  dish: string
  variant: string
  itemId: string | null
  title: string
  photoKeys: string[]
  scaleCm: number | null
  scaleAxis: 'width' | 'height' | 'length' | null
}) {
  const supabase = createClient()
  const { data, error } = await supabase.from('model_requests').insert({
    tenant_id: args.tenantId, item_id: args.itemId, dish: args.dish, variant: args.variant,
    title: args.title.trim(), photo_keys: args.photoKeys, kind: 'generate',
    scale_cm: args.scaleCm, scale_axis: args.scaleAxis,
  }).select('id, state, note').single()
  if (error?.code === '23505') {
    return { data: null, error: { message: 'This dish already has a model on the way.' } }
  }
  return { data, error }
}

/** Resize an existing model. Free - it re-optimises the master rather than regenerating -
 *  and it does not count against the quota (0012: model_requests_used counts only
 *  'generate'). */
export async function requestRescale(args: {
  tenantId: string
  dish: string
  variant: string
  itemId: string | null
  title: string
  scaleCm: number
  scaleAxis: 'width' | 'height' | 'length'
}) {
  const supabase = createClient()
  const { error } = await supabase.from('model_requests').insert({
    tenant_id: args.tenantId, item_id: args.itemId, dish: args.dish, variant: args.variant,
    title: args.title, photo_keys: [], kind: 'rescale',
    scale_cm: args.scaleCm, scale_axis: args.scaleAxis,
  })
  if (error?.code === '23505') {
    return { message: 'This model is already being resized.' }
  }
  return error
}

/** Out of the library without being destroyed. */
export async function setArchived(modelId: string, archived: boolean) {
  const supabase = createClient()
  const { error } = await supabase.from('models').update({ archived }).eq('id', modelId)
  return error
}
