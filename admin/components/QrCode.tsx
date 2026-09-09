'use client'
// A QR code, as an SVG.
//
// The physical delivery vehicle. Self-serve does not work if the owner has to work out
// QR generation themselves - the code on the table IS the product as far as a diner is
// concerned, and this is the one thing here that gets printed.
//
// SVG on purpose: it prints sharp at any size, it is a few hundred bytes, and the download
// is the same file the screen shows. The `qrcode` package is 30 KB with no peers.

import { useEffect, useState } from 'react'
import QR from 'qrcode'

export default function QrCode({ value, size = 200, label }: {
  value: string
  size?: number
  label?: string
}) {
  const [svg, setSvg] = useState('')

  useEffect(() => {
    let alive = true
    // Error correction M: a code on a laminated table card gets scratched, and M survives
    // 15% damage while staying small enough to print at business-card size.
    QR.toString(value, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: size })
      .then(s => { if (alive) setSvg(s) })
      .catch(() => { if (alive) setSvg('') })
    return () => { alive = false }
  }, [value, size])

  function download() {
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(label || 'menu').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-qr.svg`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (!svg) return <div style={{ width: size, height: size, background: 'var(--card2)' }} className="mx-auto rounded" />

  return (
    <div className="inline-block">
      <div className="rounded-lg overflow-hidden bg-white p-2 mx-auto" style={{ width: size + 16 }}
           dangerouslySetInnerHTML={{ __html: svg }} />
      <button onClick={download} className="btn btn-sm mt-3 no-print">Download SVG</button>
    </div>
  )
}
