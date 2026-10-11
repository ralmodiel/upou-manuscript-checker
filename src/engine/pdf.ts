// PDF (Adobe Acrobat, Word and Google Docs "Save as PDF", most print-to-PDF drivers) into the
// manuscript model, read with Mozilla's pdf.js. A PDF keeps where every word is printed, not
// paragraphs or styles, so those are worked out from the layout: lines from baselines, paragraphs
// from gaps, indents and line ends, alignment from where lines end, spacing from line gaps.
import type * as PdfJsModule from 'pdfjs-dist'
import type { Box, Doc, Line, Page, Para, Picture, Pixels, Run } from './model.ts'
import { shrink } from './images.ts'

export type PdfJs = typeof PdfJsModule
type Matrix = number[]

// Affine matrices as PDF writes them, [a b c d e f]:  applies m2 first.
const mul = (m1: Matrix, m2: Matrix): Matrix => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
]
const apply = (m: Matrix, x: number, y: number) => [
  x * m[0] + y * m[2] + m[4],
  x * m[1] + y * m[3] + m[5],
]

interface Span {
  text: string
  x0: number
  x1: number
  y: number
  size: number
  font?: string
  bold: boolean
  italic: boolean
}

const BOLD = /bold|black|heavy|semibold|demibold/i
const ITALIC = /italic|oblique/i
// Lines that open a paragraph of their own: list markers, captions, chapter labels.
const OPENER =
  /^(\(?\d{1,2}[.)]\s|\(?[a-z][.)]\s|[•●▪◦‣∙·-]\s|(Table|Figure)\s+\d|chapter\s+[ivxlc\d]+\b|appendix\b|annex\b)/i

/** 'Arial' from 'ABCDEF+Arial-BoldMT', 'Times New Roman' from 'TimesNewRomanPSMT'. */
export function familyOf(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const n = raw
    .replace(/^[A-Z]{6}\+/, '')
    .split(/[-,]/)[0]
    .replace(/(PS)?MT$/, '')
    .replace(/PS$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
  return n || undefined
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
const mode = (xs: number[]) => {
  const count = new Map<number, number>()
  let best = 0
  let most = 0
  for (const x of xs) {
    const k = Math.round(x)
    const c = (count.get(k) ?? 0) + 1
    count.set(k, c)
    if (c > most) {
      most = c
      best = k
    }
  }
  return best
}

export async function readPdf(
  data: Uint8Array,
  pdfjs: PdfJs,
  progress?: (done: number, total: number) => void,
): Promise<Doc> {
  const task = pdfjs.getDocument({
    data,
    // Real font names (for Arial and bold/italic checks) travel only with the extra properties.
    fontExtraProperties: true,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    verbosity: 0,
  })
  let pdf
  try {
    pdf = await task.promise
  } catch (e) {
    const name = (e as { name?: string }).name
    throw new Error(
      name === 'PasswordException'
        ? 'This PDF is password-protected. Save a copy without a password and check that.'
        : 'This file could not be opened as a PDF.',
      { cause: e },
    )
  }

  const { OPS } = pdfjs
  const pages: Page[] = []
  const allLines: Line[][] = []
  const pictures: Picture[] = []
  try {
    for (let n = 0; n < pdf.numPages; n++) {
      const page = await pdf.getPage(n + 1)
      const vp = page.getViewport({ scale: 1 })
      const toView = (x: number, y: number) => apply(vp.transform, x, y)
      const boxOf = (m: Matrix, x0: number, y0: number, x1: number, y1: number): Box => {
        const pts = [
          [x0, y0],
          [x1, y0],
          [x0, y1],
          [x1, y1],
        ].map(([x, y]) => apply(mul(vp.transform, m), x, y))
        const xs = pts.map((p) => p[0])
        const ys = pts.map((p) => p[1])
        return {
          x0: Math.min(...xs),
          y0: Math.min(...ys),
          x1: Math.max(...xs),
          y1: Math.max(...ys),
        }
      }

      const ops = await page.getOperatorList()
      const text = await page.getTextContent()
      const annots = await page.getAnnotations().catch(() => [])

      // Drawing operations: pictures, paths and coloured text, placed by tracking the graphics
      // state (transform and fill colour) through save and restore.
      const images: (Box & { id?: string })[] = []
      const marks: Page['marks'] = []
      const colored: Page['colored'] = []
      let ctm: Matrix = [1, 0, 0, 1, 0, 0]
      let fill = '#000000'
      const stack: { ctm: Matrix; fill: string }[] = []
      for (let k = 0; k < ops.fnArray.length; k++) {
        const fn = ops.fnArray[k]
        const args = ops.argsArray[k] as unknown[]
        if (fn === OPS.save) stack.push({ ctm, fill })
        else if (fn === OPS.restore) ({ ctm, fill } = stack.pop() ?? { ctm, fill })
        else if (fn === OPS.transform) ctm = mul(ctm, args as Matrix)
        else if (fn === OPS.setFillRGBColor && typeof args[0] === 'string') fill = args[0]
        else if (
          (fn === OPS.showText ||
            fn === OPS.showSpacedText ||
            fn === OPS.nextLineShowText ||
            fn === OPS.nextLineSetSpacingShowText) &&
          fill !== '#000000'
        ) {
          const glyphs = args.at(-1)
          const text = Array.isArray(glyphs)
            ? glyphs
                .map((g) => (g && typeof g === 'object' && 'unicode' in g ? String(g.unicode) : ''))
                .join('')
            : ''
          if (text.trim()) {
            const last = colored.at(-1)
            if (last?.color === fill) last.text += text
            else colored.push({ text, color: fill })
          }
        } else if (fn === OPS.paintFormXObjectBegin) {
          stack.push({ ctm, fill })
          if (Array.isArray(args[0]) || ArrayBuffer.isView(args[0]))
            ctm = mul(ctm, Array.from(args[0] as ArrayLike<number>))
        } else if (fn === OPS.paintFormXObjectEnd) ({ ctm, fill } = stack.pop() ?? { ctm, fill })
        else if (
          fn === OPS.paintImageXObject ||
          fn === OPS.paintInlineImageXObject ||
          fn === OPS.paintImageMaskXObject ||
          fn === OPS.paintImageXObjectRepeat
        )
          images.push({
            ...boxOf(ctm, 0, 0, 1, 1),
            id: typeof args[0] === 'string' ? args[0] : undefined,
          })
        else if (fn === OPS.constructPath) {
          const path = (args[1] as (Float32Array | null)[] | undefined)?.[0]
          const mm = args[2] as ArrayLike<number> | null
          if (path && mm)
            marks.push({
              ...boxOf(ctm, mm[0], mm[1], mm[2], mm[3]),
              kind: 'path',
              count: path.length,
            })
        }
      }
      for (const a of annots as { subtype?: string; rect?: number[]; fieldType?: string }[]) {
        if (!a.rect || a.subtype === 'Link' || a.subtype === 'Popup') continue
        marks.push({
          ...boxOf([1, 0, 0, 1, 0, 0], a.rect[0], a.rect[1], a.rect[2], a.rect[3]),
          kind: a.fieldType ? `${a.subtype}:${a.fieldType}` : (a.subtype ?? 'annotation'),
        })
      }

      // Text spans, with each font's real name.
      const fonts = new Map<string, { font?: string; bold: boolean; italic: boolean }>()
      const fontOf = (id: string) => {
        let f = fonts.get(id)
        if (!f) {
          let name: string | undefined
          let bold = false
          let italic = false
          try {
            const obj = page.commonObjs.get(id) as {
              name?: string
              bold?: boolean
              italic?: boolean
            }
            name = obj?.name
            bold = !!obj?.bold || BOLD.test(name ?? '')
            italic = !!obj?.italic || ITALIC.test(name ?? '')
          } catch {
            // Font not loaded: style unknown.
          }
          f = { font: familyOf(name), bold, italic }
          fonts.set(id, f)
        }
        return f
      }
      const spans: Span[] = []
      const glyphs: Page['glyphs'] = []
      for (const item of text.items) {
        if (!('str' in item) || !item.str) continue
        const [a, b, c, d, e, f] = item.transform as Matrix
        // Rotated text (a turned table, a chart label) is not part of the running text.
        if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0) continue
        const [x0, y] = toView(e, f)
        const [x1] = toView(e + item.width, f)
        const size = Math.abs(d) * Math.abs(vp.transform[3] || 1)
        const font = fontOf(item.fontName)
        const span: Span = { text: item.str, x0, x1, y, size, ...font }
        spans.push(span)
        if (item.str.trim().length === 1)
          glyphs.push({ x0, x1, y0: y - size * 0.8, y1: y + size * 0.2, text: item.str.trim() })
      }

      const lines = toLines(spans, n)
      const { body, footer, header } = splitBands(lines, vp.height)
      allLines.push(body)
      pages.push({
        n,
        width: vp.width,
        height: vp.height,
        header: header.map((l) => l.text).join('\n'),
        footer: footer.map((l) => l.text).join('\n'),
        footerLines: footer,
        paras: [],
        images: images.map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 })),
        marks,
        glyphs,
        colored,
      })

      // The title page's picture is kept small, for the seal check.
      if (n === 0 && images.length) {
        const big = images.reduce((p, q) =>
          (q.x1 - q.x0) * (q.y1 - q.y0) > (p.x1 - p.x0) * (p.y1 - p.y0) ? q : p,
        )
        const pixels = big.id ? await imagePixels(page, big.id) : undefined
        pictures.push({
          para: -1,
          width: big.x1 - big.x0,
          height: big.y1 - big.y0,
          pixels: async () => pixels,
        })
      }
      page.cleanup()
      progress?.(n + 1, pdf.numPages)
    }
  } finally {
    await task.destroy()
  }

  const paras = toParas(allLines, pages)
  const notes: string[] = []
  const chars = paras.reduce((s, p) => s + p.text.length, 0)
  if (chars < 200 * pages.length * 0.1)
    notes.push(
      'This PDF has little or no readable text (it may be scanned pages), so most checks cannot run. Check the Word file, or a PDF saved from Word or Google Docs.',
    )
  return { kind: 'pdf', paras, pages, pictures, notes }
}

/** Groups spans that share a baseline into lines, left to right. */
function toLines(spans: Span[], page: number): Line[] {
  const sorted = spans.filter((s) => s.text).sort((a, b) => a.y - b.y || a.x0 - b.x0)
  const groups: Span[][] = []
  for (const s of sorted) {
    const g = groups.at(-1)
    if (g) {
      const anchor = g[0].y
      const size = Math.max(s.size, ...g.map((x) => x.size))
      if (s.y - anchor <= 0.45 * size) {
        g.push(s)
        continue
      }
    }
    groups.push([s])
  }
  const lines: Line[] = []
  for (const g of groups) {
    g.sort((a, b) => a.x0 - b.x0)
    const ink = g.filter((s) => s.text.trim())
    if (!ink.length) continue
    // The baseline and size of the line are those of its longest span (not a superscript).
    const main = ink.reduce((p, q) => (q.text.length * q.size > p.text.length * p.size ? q : p))
    let text = ''
    const runs: Run[] = []
    let prev: Span | undefined
    for (const s of g) {
      let piece = s.text
      // A wide run of spaces (a TOC line, a signature line) reads as a tab.
      if (!piece.trim() && s.x1 - s.x0 > 2 * main.size) piece = '\t'
      if (prev) {
        const gap = s.x0 - prev.x1
        if (gap > 3 * main.size && text.trim()) {
          // A wide gap (table cells, a name and its date): a tab, without the spaces before it.
          piece = '\t' + piece.trimStart()
          text = text.trimEnd()
          const last = runs.at(-1)
          if (last) last.text = last.text.trimEnd()
        } else if (gap > 0.2 * main.size && !/\s$/.test(text) && !/^\s/.test(piece))
          piece = ' ' + piece
      }
      text += piece
      const last = runs.at(-1)
      const style = {
        bold: s.bold,
        italic: s.italic,
        font: s.font,
        size: Math.round(s.size * 2) / 2,
      }
      if (
        last &&
        last.bold === style.bold &&
        last.italic === style.italic &&
        last.font === style.font &&
        last.size === style.size
      )
        last.text += piece
      else runs.push({ text: piece, ...style })
      prev = s
    }
    lines.push({
      page,
      y: main.y,
      x0: ink[0].x0,
      x1: Math.max(...ink.map((s) => s.x1)),
      size: main.size,
      text: text.replace(/\s+$/, ''),
      runs,
      spans: ink.map((s) => ({ text: s.text.trim(), x0: s.x0, x1: s.x1 })),
    })
  }
  return lines
}

/** Footer (and header) lines: in the outer inch, set apart from the body or shaped like a page number. */
function splitBands(lines: Line[], height: number) {
  const footer: Line[] = []
  const header: Line[] = []
  const body: Line[] = []
  const looksLikeNumber = (t: string) =>
    /(…|\.{2,}|\.\s\.\s\.)\s*\S+\s*$|^\s*([ivxlcdm]+|\d+)\s*$/i.test(t)
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k]
    const above = lines[k - 1]
    const below = lines[k + 1]
    if (
      l.y > height - 72 &&
      (!above || l.y - above.y >= 18 || looksLikeNumber(l.text) || l.y > height - 50)
    )
      footer.push(l)
    else if (l.y < 54 && (!below || below.y - l.y >= 18)) header.push(l)
    else body.push(l)
  }
  // Once a line is footer, everything under it is too.
  return { body: body.filter((l) => !footer.some((f) => f.y <= l.y)), footer, header }
}

interface Margins {
  left: number
  right: number
}

function marginsOf(lines: Line[], fallback?: Margins): Margins | undefined {
  const long = lines.filter((l) => l.text.length > 40)
  if (long.length < 4) return fallback
  // Ragged-right lines rarely reach the margin; the longest ones (bar a stray) mark it.
  const xs1 = long.map((l) => l.x1).sort((a, b) => a - b)
  return { left: mode(long.map((l) => l.x0)), right: xs1[Math.floor(xs1.length * 0.95)] }
}

/** Width of a line's first word, from its first span; on the generous side (half an em a letter at
 *  least), so a word is never thought to fit where the writer's program found no room. */
const firstWord = (l: Line) => {
  const s = l.spans[0]
  if (!s?.text) return 0
  const word = s.text.split(/\s+/)[0]
  return Math.max((s.x1 - s.x0) * (word.length / s.text.length), word.length * 0.5 * l.size)
}

/** Whether the next line's first word would have fit at the end of `prev`: if it would, the
 *  writer ended the paragraph there (a wrapped line takes every word that fits). */
const roomFor = (prev: Line, next: Line, right: number) =>
  prev.x1 + 0.25 * next.size + firstWord(next) < right - 1

/** Lines into paragraphs, carrying a paragraph across a page break when its line ran full. */
function toParas(pagesLines: Line[][], pages: Page[]): Para[] {
  const docMargins = marginsOf(pagesLines.flat()) ?? { left: 72, right: 523 }
  const margins = pagesLines.map((ls) => marginsOf(ls, docMargins) ?? docMargins)
  const paras: Para[] = []
  let draft: Line[] = []
  let cont: number | undefined // x0 of the second line
  // How the paragraph being built sits: centred and right-aligned lines stack differently.
  let kind: 'left' | 'center' | 'right' = 'left'
  // The paragraph before had a hanging indent (a reference list): an unindented second line is a new entry.
  let lastHanging = false

  const kindOf = (l: Line, m: Margins): typeof kind => {
    const width = m.right - m.left
    if (
      Math.abs((l.x0 + l.x1) / 2 - (m.left + m.right) / 2) < 8 &&
      l.x0 > m.left + 12 &&
      l.x1 < m.right - 12
    )
      return 'center'
    if (Math.abs(l.x1 - m.right) < 3 && l.x0 > m.left + 0.3 * width) return 'right'
    return 'left'
  }
  const flush = () => {
    if (draft.length) {
      const para = toPara(draft, paras.length, margins[draft[0].page], kind === 'center')
      paras.push(para)
      lastHanging = draft.length > 1 && (para.indent?.firstLine ?? 0) < -18
    }
    draft = []
    cont = undefined
  }

  for (let p = 0; p < pagesLines.length; p++) {
    const m = margins[p]
    const width = m.right - m.left
    for (let k = 0; k < pagesLines[p].length; k++) {
      const c = pagesLines[p][k]
      const prev = draft.at(-1)
      let split = !prev
      if (prev) {
        const pm = margins[prev.page]
        // Bold may change mid-paragraph (a bold title in a sentence); a size change may not.
        const sameSize = Math.abs(prev.size - c.size) <= 0.6
        const ended = roomFor(prev, c, pm.right)
        const offCont = cont !== undefined && Math.abs(c.x0 - cont) > 8
        const newEntry = lastHanging && draft.length === 1 && Math.abs(c.x0 - prev.x0) <= 3
        if (prev.page !== c.page) {
          // A new page: the paragraph goes on only if its last line ran full.
          const aligned =
            cont !== undefined ? !offCont : c.x0 < draft[0].x0 - 8 || Math.abs(c.x0 - m.left) <= 3
          split =
            kind !== 'left' ||
            ended ||
            !sameSize ||
            !aligned ||
            OPENER.test(c.text) ||
            kindOf(c, m) !== 'left'
        } else {
          const gap = c.y - prev.y
          const gaps = draft.slice(1).map((l, i) => l.y - draft[i].y)
          const apart =
            gap <= 0 || (gaps.length ? gap > 1.35 * median(gaps) : gap > 2.6 * prev.size)
          const tabular = prev.text.includes('\t') || c.text.includes('\t')
          if (apart || !sameSize || tabular) split = true
          // Stacked centred or right-aligned lines are one paragraph only when the line above ran wide.
          else if (kind !== 'left')
            split = kindOf(c, m) !== kind || prev.x1 - prev.x0 < 0.75 * width
          // A left or justified paragraph goes on while its lines run full and keep their indent
          // (its last line may happen to look centred).
          else split = ended || OPENER.test(c.text) || offCont || newEntry
        }
        if (!split && draft.length === 1) cont = c.x0
      }
      if (split) {
        flush()
        kind = kindOf(c, m)
      }
      draft.push(c)
    }
  }
  flush()

  for (const para of paras) {
    const first = para.lines![0]
    pages[first.page].paras.push(para.i)
    para.page = first.page
    para.newPage = pagesLines[first.page][0] === first
  }
  return paras
}

function toPara(lines: Line[], i: number, m: Margins, centered: boolean): Para {
  const runs: Run[] = []
  for (const l of lines) {
    if (runs.length) runs.push({ ...runs.at(-1)!, text: ' ' })
    runs.push(...l.runs.map((r) => ({ ...r })))
  }
  const para: Para = { i, text: lines.map((l) => l.text).join(' '), runs, lines }
  const width = m.right - m.left
  const body = lines.slice(0, -1)
  if (centered) para.align = 'center'
  else if (body.length >= 1) {
    const full = body.filter((l) => l.x1 >= m.right - 2.5).length
    const flushRight = lines.every((l) => l.x1 >= m.right - 2.5)
    if (flushRight && lines.some((l) => l.x0 > m.left + 0.3 * width)) para.align = 'right'
    else para.align = full / body.length >= 0.85 ? 'justify' : 'left'
  } else if (lines[0].x1 >= m.right - 2.5 && lines[0].x0 > m.left + 0.3 * width)
    para.align = 'right'
  const gaps = lines
    .slice(1)
    .map((l, k) => (l.page === lines[k].page ? l.y - lines[k].y : 0))
    .filter((g) => g > 0)
  if (gaps.length) para.spacing = median(gaps) / (1.15 * lines[0].size)
  const cont = lines[1]?.x0 ?? m.left
  para.indent = { left: cont - m.left, firstLine: lines[0].x0 - cont }
  return para
}

/** Decoded pixels of a painted image object (RGBA, shrunk to at most 64 px a side). */
async function imagePixels(
  page: {
    objs: { get(id: string, cb: (v: unknown) => void): void }
    commonObjs: { get(id: string, cb: (v: unknown) => void): void }
  },
  id: string,
): Promise<Pixels | undefined> {
  const store = id.startsWith('g_') ? page.commonObjs : page.objs
  const obj = await new Promise<unknown>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 2000)
    try {
      store.get(id, (v) => {
        clearTimeout(timer)
        resolve(v)
      })
    } catch {
      clearTimeout(timer)
      resolve(undefined)
    }
  })
  const img = obj as {
    width?: number
    height?: number
    kind?: number
    data?: Uint8Array | Uint8ClampedArray
    bitmap?: ImageBitmap
  }
  if (!img?.width || !img.height) return undefined
  const { width, height } = img
  if (img.bitmap && typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.drawImage(img.bitmap, 0, 0)
    return shrink({ width, height, data: ctx.getImageData(0, 0, width, height).data }, 64)
  }
  if (!img.data) return undefined
  // pdf.js image kinds: 1 = 1 bit grey, 2 = RGB, 3 = RGBA.
  const rgba = new Uint8ClampedArray(width * height * 4)
  if (img.kind === 3) rgba.set(img.data.subarray(0, rgba.length))
  else if (img.kind === 2)
    for (let p = 0, q = 0; p < width * height; p++, q += 3) {
      rgba[p * 4] = img.data[q]
      rgba[p * 4 + 1] = img.data[q + 1]
      rgba[p * 4 + 2] = img.data[q + 2]
      rgba[p * 4 + 3] = 255
    }
  else return undefined
  return shrink({ width, height, data: rgba }, 64)
}
