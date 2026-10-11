// What the browser lends the engine: pdf.js with its worker, an image decoder for the seal check,
// and saving a generated file. Nothing here makes a network request.
import type { PdfJs } from '../engine/pdf'
import type { Pixels } from '../engine/model'
import { canvasReadsBack } from '../engine/canvas'
import { FileProblem } from '../engine/problem'

// pdf.js reads a PDF's text with `for await` over a stream, which Safari supports only from 27 (and
// Chrome and Edge from 124): elsewhere every PDF would fail. The worker's own use has a fallback.
if (typeof ReadableStream !== 'undefined' && !(Symbol.asyncIterator in ReadableStream.prototype))
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    async *value(this: ReadableStream) {
      const reader = this.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) return
          yield value
        }
      } finally {
        reader.releaseLock()
      }
    },
  })

let pdfjs: Promise<PdfJs> | undefined
let stale = false

// Vite reports a lazy part of the site that failed to load: after a new version is published, a page
// opened before it asks for code files that no longer exist.
addEventListener('vite:preloadError', () => (stale = true))

/** Whether part of the site failed to load, so the visitor should reload the page. */
export const isStale = () => stale
export const STALE =
  'Part of this page could not be loaded; the site may have been updated since you opened it. Reload the page, then try again.'

/** pdf.js and its worker, loaded on the first PDF (they are the heaviest part of the site). The
 *  legacy build carries the polyfills older phone browsers need. */
export function loadPdfJs(): Promise<PdfJs> {
  // pdf.js 6 also needs these (Chrome and Edge 119, Firefox 122, Safari 17.4): without them it
  // fails, or misreads fonts and gives wrong results. Word files are still checked.
  if (!('withResolvers' in Promise) || !('transferToFixedLength' in ArrayBuffer.prototype))
    return Promise.reject(
      new FileProblem(
        'This browser needs an update to support checking PDF files. Update it, or check the Word file (.docx) instead.',
      ),
    )
  pdfjs ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ])
    .then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default
      return lib
    })
    .catch((e: unknown) => {
      pdfjs = undefined // let the next PDF try again
      throw e
    })
  return pdfjs
}

/** Pixels of a PNG, JPEG, GIF, BMP or WebP image, at most 256 px a side (enough for the seal check). */
export async function decodeImage(bytes: Uint8Array): Promise<Pixels | undefined> {
  // Pixels a privacy setting blanks would make a real seal look missing: none is better.
  if (!canvasReadsBack()) return undefined
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
  // iOS asks before saving: the link must outlive a slow tap.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
