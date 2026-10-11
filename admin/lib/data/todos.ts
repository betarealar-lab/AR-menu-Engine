// BetaReal's to-do list (0043): our own ideas, and the restaurants that pressed
// "Need help?". Only super admins can read or change it - the database refuses everyone
// else. An owner reaches it through one door, `request_help`, for their own restaurant.

import { createClient } from '@/lib/supabase/client'

export type Todo = {
  id: string
  kind: 'idea' | 'help'
  title: string
  notes: string
  tenant_id: string | null
  tenant_name: string | null
  tenant_slug: string | null
  requester_email: string | null
  created_utc: string
  updated_utc: string
  done_utc: string | null
}

export async function loadTodos(): Promise<{ rows: Todo[]; error: string }> {
  const { data, error } = await createClient().rpc('admin_todos')
  return { rows: (data as Todo[]) || [], error: error?.message || '' }
}

/** Open help requests, for the badge beside "To-do". */
export async function openHelpCount(): Promise<number> {
  const { count } = await createClient().from('todos')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'help').is('done_utc', null)
  return count || 0
}

export async function addIdea(title: string, notes: string): Promise<string> {
  const { error } = await createClient().from('todos')
    .insert({ kind: 'idea', title: title.trim(), notes: notes.trim() })
  return error?.message || ''
}

export async function setDone(id: string, done: boolean): Promise<string> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('todos').update(done
    ? { done_utc: new Date().toISOString(), done_by: user?.id ?? null }
    : { done_utc: null, done_by: null }).eq('id', id)
  return error?.message || ''
}

export async function removeTodo(id: string): Promise<string> {
  const { error } = await createClient().from('todos').delete().eq('id', id)
  return error?.message || ''
}

// ── The owner's side ───────────────────────────────────────────────

/** When this restaurant's open help request was last sent, or null if none is open. */
export async function helpStatus(tenantId: string): Promise<string | null> {
  const { data } = await createClient().rpc('help_status', { p_tenant: tenantId })
  return (data as string | null) || null
}

/** Press the button. A second press while a request is open adds the message to it. */
export async function requestHelp(tenantId: string, message: string)
  : Promise<{ at: string | null; error: string }> {
  const { data, error } = await createClient().rpc('request_help', {
    p_tenant: tenantId, p_message: message,
  })
  return { at: (data as string | null) || null, error: error?.message || '' }
}

/** "3 min ago", "2 h ago", "4 d ago". */
export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}
