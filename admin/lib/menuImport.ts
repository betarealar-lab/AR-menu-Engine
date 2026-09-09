// Reading a menu out of a file, when we turn it on.
//
// **Off by default and unreachable without a key.** `ANTHROPIC_API_KEY` is not in `.env`,
// so `menuImportEnabled()` is false, the upload card never renders, and the route below
// answers 501. Nothing here costs anything until somebody sets that variable.
//
// It is written now rather than later because the SHAPE is the decision, and the shape is
// the same whichever model reads the file:
//
//     a file  ->  rows  ->  a screen where the owner fixes what came out wrong  ->  saved
//
// Everything upstream of `DraftRow[]` is interchangeable - a spreadsheet parser, a PDF
// text layer, a vision model, or a person typing. Everything downstream is the same code.
// That is why the manual path and the AI path are one feature and not two.
//
// **What it costs, so the decision is a number.** A menu photo is about 4,200 tokens.
// Monday Greens' 170 dishes across eight photographed pages is roughly 35,000 tokens in
// and 12,000 out - about $0.19 on Sonnet 5, once, for the whole menu. Against ₾300 setup
// and 30 credits per 3D model that is noise, but it is a real line and it is Temo's call.

import type { Choice } from '@/lib/data/menu'

/** One dish, as it comes out of a file and before anybody has checked it. */
export type DraftRow = {
  /** The dish name, per language code - `{ en: 'Khachapuri', ka: 'ხაჭაპური' }`. */
  name: Record<string, string>
  description: Record<string, string>
  /** As written on the menu: "18", "18 ₾", "16 / 70 ₾". Resolved on save, not here. */
  price: string
  /** The category heading it sat under. Created if it does not exist yet. */
  category: string
  /** Glass / Bottle and friends, in the same shape the menu already stores. */
  variants: Choice[]
  addons: Choice[]
  /** What the reader was unsure about. Shown on the row so the eye goes there first. */
  warnings: string[]
}

export type ImportResult = {
  rows: DraftRow[]
  /** Languages actually seen in the file, so the review screen shows the right columns. */
  languages: string[]
  /** Currency symbol found on the page, if any. */
  currency: string | null
}

/** Is the AI path switched on for this deployment?
 *
 *  A single question with a single answer, so no screen has to guess. It is a build-time
 *  public flag rather than a check for the key itself, because the key must never be
 *  readable from the browser - the server holds it, the browser only learns whether the
 *  feature exists. */
export function menuImportEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MENU_IMPORT === 'on'
}

/** What we would accept, once it is on. Kept here so the upload control and the route
 *  cannot disagree about it. */
export const IMPORT_ACCEPT = '.xlsx,.xls,.csv,.pdf,image/*'

/** Send a file to be read. Throws with a readable message; the caller shows it. */
export async function readMenuFile(file: File): Promise<ImportResult> {
  const body = new FormData()
  body.append('file', file)
  const res = await fetch('/api/menu-import', { method: 'POST', body })
  if (res.status === 501) {
    throw new Error('Menu import is not switched on for this deployment.')
  }
  if (!res.ok) {
    const said = await res.text().catch(() => '')
    throw new Error(said || `That file could not be read (HTTP ${res.status}).`)
  }
  return res.json() as Promise<ImportResult>
}
