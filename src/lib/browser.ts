// What the browser lends the engine: pdf.js with its worker, an image decoder for the seal check,
// and saving a generated file. Nothing here makes a network request.
import type { PdfJs } from '../engine/pdf'
import type { Pixels } from '../engine/model'

let pdfjs: Promise<PdfJs> | undefined

/** pdf.js and its worker, loaded on the first PDF (they are the heaviest part of the site). The
 *  legacy build carries the polyfills older phone browsers need. */
export function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default
    return lib
  })
  return pdfjs
}

/** Pixels of a PNG, JPEG, GIF, BMP or WebP image, at most 256 px a side (enough for the seal check). */
export async function decodeImage(bytes: Uint8Array): Promise<Pixels | undefined> {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
    const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return undefined
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    return { width, height, data: ctx.getImageData(0, 0, width, height).data }
  } catch {
    // EMF/WMF and other formats the browser cannot draw: the check says to look at it by hand.
    return undefined
  }
}

/** Hands a generated file to the browser's own download. */
export function saveFile(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
