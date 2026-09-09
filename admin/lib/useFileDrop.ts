'use client'
// Dropping a file onto the thing it belongs to.
//
// Every upload in the admin was a hidden `<input type="file">` behind a button. That works
// and it is not enough: on a desktop the file is already visible in Explorer or Finder
// next to the browser, and the natural motion is to drag it onto the box that says "add
// photo" - not to click, wait for a dialog, and navigate back to the folder it came from.
//
// **The browser fights you if you only do half of it.** Dropping a file anywhere on a page
// makes the browser NAVIGATE to it - the photo replaces the admin, and whatever was typed
// into the form is gone. So `dragover` has to be cancelled on the drop target AND on the
// window, or a near-miss becomes a lost draft. That window-level guard is the half that is
// easy to forget, and it is why this is a shared hook rather than four hand-rolled
// handlers.
//
// `accept` is checked here rather than trusted from the input's own attribute, because a
// drop bypasses that attribute entirely: an input with `accept=".glb"` will hand you a
// .docx without complaint if it arrives by drag.

import { useCallback, useEffect, useRef, useState } from 'react'
// Plain JS beside its own test: a drop bypasses the input's `accept`
// attribute, so this rule is applied by hand and is worth testing directly.
import { matchesAccept } from '@/lib/acceptMatch'

export type FileDrop = {
  /** Spread onto the element that should accept a drop. */
  dropProps: {
    onDragEnter: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
  /** True while a file is over this element - for the ring that says "let go here". */
  over: boolean
}

export function useFileDrop(
  onFiles: (files: File[]) => void,
  opts: { accept?: string; multiple?: boolean; disabled?: boolean } = {},
): FileDrop {
  const { accept = '', multiple = false, disabled = false } = opts
  const [over, setOver] = useState(false)
  // dragenter/dragleave fire for every child element the pointer crosses, so a plain
  // boolean flickers off the moment the cursor passes over the image inside the box.
  // Counting enters and leaves is the standard fix and the only one that does not need
  // hit-testing.
  const depth = useRef(0)

  // Without this, a file dropped one pixel outside the target navigates the whole tab to
  // it. There is no way to undo that from the page, so it is guarded globally rather than
  // per-target.
  useEffect(() => {
    const swallow = (e: DragEvent) => { e.preventDefault() }
    window.addEventListener('dragover', swallow)
    window.addEventListener('drop', swallow)
    return () => {
      window.removeEventListener('dragover', swallow)
      window.removeEventListener('drop', swallow)
    }
  }, [])

  const has = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types || []).includes('Files')

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (disabled || !has(e)) return
    e.preventDefault(); e.stopPropagation()
    depth.current += 1
    setOver(true)
  }, [disabled])

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (disabled || !has(e)) return
    // Both are required: preventDefault says "I will take this", and the effect is what
    // turns the cursor into a copy arrow instead of the forbidden sign.
    e.preventDefault(); e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }, [disabled])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (disabled) return
    e.preventDefault(); e.stopPropagation()
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setOver(false)
  }, [disabled])

  const onDrop = useCallback((e: React.DragEvent) => {
    if (disabled) return
    e.preventDefault(); e.stopPropagation()
    depth.current = 0
    setOver(false)
    const all = Array.from(e.dataTransfer?.files || [])
    if (!all.length) return
    // An empty list still reaches the caller. Dropping a .docx on an image box and having
    // nothing at all happen is indistinguishable from the drop being broken, so the
    // caller gets `[]` and says "that is not an image" in its own words.
    const good = accept ? all.filter(f => matchesAccept(f, accept)) : all
    onFiles(multiple ? good : good.slice(0, 1))
  }, [disabled, accept, multiple, onFiles])

  return { dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop }, over }
}
