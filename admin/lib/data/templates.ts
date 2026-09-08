// Templates: the shapes a menu can take.
//
// **What a template actually is, because the screen has to be honest about it.** Two
// halves that live in different places:
//
//   the STYLESHEET   shipped in the menu app at `app/src/lib/css/<id>.css`, extracted
//                    verbatim from the platform. It decides the SHAPE - card layout, the
//                    hero band, where a price sits. Adding one is design work and a build,
//                    not a form.
//   the PALETTE      this table's `defaults`: the colours and fonts a NEW restaurant
//                    starts with before anyone opens the theme editor. Data, editable
//                    here, and safe to change because it only ever seeds.
//
// So a template can be created from this screen and it will be a real, usable template -
// as long as it reuses a stylesheet that exists. One with an id no stylesheet matches
// falls back to Monday Greens in the renderer (`SHEETS` in app/src/pages/[slug].astro),
// silently. The screen says which ids have a sheet rather than letting somebody find that
// out from a client's menu.
//
// Permission is the database's: `templates_read` is `listed or is_super_admin()` and
// `templates_write` is `is_super_admin()`. 0021 added the grant those policies needed -
// until then the write policy could not fire for anybody.

import { createClient } from '@/lib/supabase/client'

export type Template = {
  id: string
  name: string
  /** Whether an owner may choose it in the theme editor. */
  listed: boolean
  /** The palette a new restaurant starts with. Keys are theme keys, e.g. `day_bg`. */
  defaults: Record<string, string>
  created_utc: string
  /** Filled in here, not stored: how many restaurants are on it. */
  used: number
}

/** The stylesheets the menu app ships. A template whose id is not in here renders as
 *  Monday Greens - see the header. Kept as a list rather than read from the filesystem
 *  because the admin is a separate app and cannot see the menu app's files. */
export const SHIPPED_STYLESHEETS = ['monday_greens', 'elegant_black'] as const

export async function loadTemplates(): Promise<Template[]> {
  const supabase = createClient()
  const [{ data: rows }, { data: tenants }] = await Promise.all([
    supabase.from('templates').select('id, name, listed, defaults, created_utc').order('id'),
    supabase.from('tenants').select('template_id'),
  ])
  const used = new Map<string, number>()
  for (const t of (tenants || []) as { template_id: string | null }[]) {
    if (t.template_id) used.set(t.template_id, (used.get(t.template_id) ?? 0) + 1)
  }
  return ((rows || []) as Template[]).map(r => ({
    ...r,
    defaults: (r.defaults ?? {}) as Record<string, string>,
    used: used.get(r.id) ?? 0,
  }))
}

export async function saveTemplate(id: string, patch: Partial<Template>) {
  const supabase = createClient()
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.listed !== undefined) row.listed = patch.listed
  if (patch.defaults !== undefined) row.defaults = patch.defaults
  const { error } = await supabase.from('templates').update(row).eq('id', id)
  return error
}

export async function createTemplate(args: {
  id: string; name: string; basedOn?: string | null
}) {
  const supabase = createClient()
  // A new template starts from an existing one's palette rather than from nothing: an
  // empty `defaults` is legal and means "whatever the stylesheet says", which is a fine
  // default but a poor starting point for someone who wanted to tweak a palette.
  let defaults: Record<string, string> = {}
  if (args.basedOn) {
    const { data } = await supabase.from('templates')
      .select('defaults').eq('id', args.basedOn).single()
    defaults = ((data as { defaults?: Record<string, string> } | null)?.defaults ?? {})
  }
  const { error } = await supabase.from('templates').insert({
    id: args.id, name: args.name, listed: false, defaults,
  })
  // Unlisted on purpose: a template nobody has looked at should not appear in an owner's
  // picker the moment it is created.
  return error
}

export async function deleteTemplate(id: string) {
  const supabase = createClient()
  const { error } = await supabase.from('templates').delete().eq('id', id)
  return error
}

/** A template id: lowercase, underscores, matching how the stylesheets are named. */
export function normalizeTemplateId(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
}
