// A QR code as a file someone can print. Shared by the Dish pages screen and the Library
// Studio, so the two can never hand a designer different files for the same address.

import QR from 'qrcode'

/** Filename-safe, keeping Georgian letters: a designer's folder of codes should be
 *  readable in the language the dishes are named in. */
export const safeName = (s: string) =>
  s.replace(/[^a-z0-9ა-ჿ]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'dish'

/** 2048 px with a 4-module quiet zone: sharp on an A3 poster, and the white border a
 *  scanner needs survives a designer cropping close. Error correction M survives a
 *  scratched or folded flyer while keeping the code small. */
export async function downloadQrPng(url: string, name: string) {
  const data = await QR.toDataURL(url, { width: 2048, margin: 4, errorCorrectionLevel: 'M' })
  const a = document.createElement('a'); a.href = data; a.download = `${name}-qr.png`; a.click()
}

export async function downloadQrSvg(url: string, name: string) {
  const svg = await QR.toString(url, { type: 'svg', margin: 4, errorCorrectionLevel: 'M' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  a.download = `${name}-qr.svg`; a.click(); URL.revokeObjectURL(a.href)
}
