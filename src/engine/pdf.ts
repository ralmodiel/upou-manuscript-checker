// PDF (Adobe Acrobat, Word and Google Docs "Save as PDF", most print-to-PDF drivers) into the
// manuscript model, read with Mozilla's pdf.js. A PDF keeps where every word is printed, not
// paragraphs or styles, so those are worked out from the layout: lines from baselines, paragraphs
// from gaps, indents and line ends, alignment from where lines end, spacing from line gaps.
import type * as PdfJsModule from 'pdfjs-dist'
import type { Box, Doc, Line, Page, Para, Picture, Pixels, Run } from './model.ts'
import { canvasReadsBack } from './canvas.ts'
import { shrink } from './images.ts'
import { FileProblem } from './problem.ts'

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
// Lines that open a paragraph of their own: list markers ("1. ", "a) ", "(A) ", bullets; not "M. ",
// an author's initial carried over to a new line), and caption, chapter and appendix labels
// standing alone or before their title ("Table 1", "Figure 2. Title", "CHAPTER II REVIEW").
const MARKER = /^(\(?\d{1,2}[.)]|\(?[a-z][.)]|\([A-Z]\)|[•●▪◦‣∙·-])\s/
const LABEL =
  /^(Table|TABLE|Fig(ure|\.)?|FIG(URE|\.)?|Chapter|CHAPTER|Appendix|APPENDIX|Annex|ANNEX)(\s*[A-Z]?\d+([.-]\d+)*|\s+[IVXLC]+\b|\s+[A-Z]\b)?\s*[.:–—-]?\s*($|[\p{Lu}(])/u
/** A caption or note line: never a running head, and outside the table above or below it. */
const OUTSIDE = /^(note[.:]|(table|fig(ure)?\.?)\s*\d)/i
/** Whether line `l` opens a paragraph after `prev`. A label opens one only when bold, as the
 *  format sets it, or after a line ending in no letter: a sentence may wrap onto a new line at
 *  "Table 3.1." too. */
const opens = (l: Line, prev: Line) =>
  MARKER.test(l.text) ||
  (LABEL.test(l.text) && (!!l.runs.find((r) => r.text.trim())?.bold || !/\p{L}$/u.test(prev.text)))

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
    throw new FileProblem(
      name === 'PasswordException'
        ? 'This PDF is password-protected. Save a copy without a password and check that.'
        : 'This file could not be opened as a PDF.',
      { cause: e },
    )
  }

  const { OPS } = pdfjs
  // Paths painted with a fill: a box filled in, a word highlighted.
  const FILLS = new Set<number>([
    OPS.fill,
    OPS.eoFill,
    OPS.fillStroke,
    OPS.eoFillStroke,
    OPS.closeFillStroke,
    OPS.closeEOFillStroke,
  ])
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
      // The coloured text being read: black text in between ends it.
      let run: Page['colored'][number] | undefined
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
          fn === OPS.showText ||
          fn === OPS.showSpacedText ||
          fn === OPS.nextLineShowText ||
          fn === OPS.nextLineSetSpacingShowText
        ) {
          if (fill === '#000000') run = undefined
          else {
            const glyphs = args.at(-1)
            const text = Array.isArray(glyphs)
              ? glyphs
                  .map((g) =>
                    g && typeof g === 'object' && 'unicode' in g ? String(g.unicode) : '',
                  )
                  .join('')
              : ''
            // Pieces drawn one by one (letters, kerned parts): their spaces come back from the
            // page's lines below.
            if (!text.trim()) continue
            if (run?.color === fill) run.text += text
            else colored.push((run = { text, color: fill }))
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
              ...(FILLS.has(args[0] as number) ? { fill } : {}),
            })
        }
      }
      for (const a of annots as {
        subtype?: string
        rect?: number[]
        fieldType?: string
        fieldValue?: unknown
        exportValue?: string
        buttonValue?: string
        checkBox?: boolean
        radioButton?: boolean
      }[]) {
        if (!a.rect || a.subtype === 'Link' || a.subtype === 'Popup') continue
        marks.push({
          ...boxOf([1, 0, 0, 1, 0, 0], a.rect[0], a.rect[1], a.rect[2], a.rect[3]),
          kind: a.fieldType ? `${a.subtype}:${a.fieldType}` : (a.subtype ?? 'annotation'),
          // A form field marks only when filled in: a box ticked, a button chosen, text typed.
          ...(a.subtype === 'Widget'
            ? {
                on: a.checkBox
                  ? a.fieldValue === a.exportValue
                  : a.radioButton
                    ? a.fieldValue === a.buttonValue
                    : typeof a.fieldValue === 'string' && a.fieldValue.trim() !== '',
              }
            : {}),
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

      // Text drawn inside a hyperlink's area has the link's colour, not the writer's.
      const links = (annots as { subtype?: string; rect?: number[] }[]).flatMap((a) =>
        a.subtype === 'Link' && a.rect
          ? [boxOf([1, 0, 0, 1, 0, 0], a.rect[0], a.rect[1], a.rect[2], a.rect[3])]
          : [],
      )
      const flat = (t: string) => t.normalize('NFKC').replace(/\s/g, '')
      const linked = links.length
        ? flat(
            spans
              .filter((s) => {
                const x = (s.x0 + s.x1) / 2
                const y = s.y - 0.3 * s.size
                return links.some(
                  (b) => x > b.x0 - 2 && x < b.x1 + 2 && y > b.y0 - 2 && y < b.y1 + 2,
                )
              })
              .map((s) => s.text)
              .join(''),
          )
        : ''
      const lines = toLines(spans, n)
      allLines.push(lines)
      const own = linked ? colored.filter((c) => !linked.includes(flat(c.text))) : colored
      // Coloured text quoted as the page's lines read it, spaces and all.
      const said = own.length
        ? lines
            .map((l) => l.text)
            .join(' ')
            .normalize('NFKC')
        : ''
      const at: number[] = []
      for (let i = 0; i < said.length; i++) if (!/\s/.test(said[i])) at.push(i)
      const bare = at.map((i) => said[i]).join('')
      const readable = (c: Page['colored'][number]) => {
        const t = flat(c.text)
        const k = t ? bare.indexOf(t) : -1
        return k < 0 ? c : { ...c, text: said.slice(at[k], at[k + t.length - 1] + 1) }
      }
      pages.push({
        n,
        width: vp.width,
        height: vp.height,
        header: '',
        footer: '',
        footerLines: [],
        paras: [],
        images: images.map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 })),
        marks,
        glyphs,
        colored: own.map(readable),
        ...(own.length < colored.length ? { linked: true } : {}),
      })

      // The title page's picture is kept small, for the seal check (a cover page may come first).
      if (n < 3 && images.length) {
        // The seal is round: a wider picture larger than it (a signature, a banner) is not the
        // seal, and a tick box is too small to be it.
        const w = (b: Box) => b.x1 - b.x0
        const h = (b: Box) => b.y1 - b.y0
        const round = images.filter(
          (b) => Math.min(w(b), h(b)) >= 36 && Math.max(w(b), h(b)) < 1.5 * Math.min(w(b), h(b)),
        )
        const big = (round.length ? round : images).reduce((p, q) =>
          w(q) * h(q) > w(p) * h(p) ? q : p,
        )
        const pixels = big.id ? await imagePixels(page, big.id) : undefined
        pictures.push({
          para: -1,
          page: n,
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

  // Headers and footers, once every page is read: a running title can only be told by its repeats.
  const running = runningLines(allLines, pages)
  for (const [n, lines] of allLines.entries()) {
    const { body, footer, header } = splitBands(lines, pages[n].height, running)
    allLines[n] = body
    pages[n].header = header.map((l) => l.text).join('\n')
    pages[n].footer = footer.map((l) => l.text).join('\n')
    pages[n].footerLines = footer
  }
  const paras = toParas(allLines, pages, tableLines(allLines, pages))
  const notes: string[] = []
  const chars = paras.reduce((s, p) => s + p.text.length, 0)
  const unreadable = chars < 200 * pages.length * 0.1
  if (unreadable)
    notes.push(
      'This PDF has little or no readable text (it may be scanned pages), so most checks cannot run. Check the Word file, or a PDF saved from Word or Google Docs.',
    )
  return { kind: 'pdf', paras, pages, pictures, notes, unreadable }
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

/** Running heads and feet the outer-inch bands miss (a title set above the page number, higher
 *  than the bottom inch): lines near the top or foot of the page whose words, page number aside,
 *  come back at the same height on many pages and hardly anywhere else. The template's filler
 *  lines repeat too, but all over the page. */
function runningLines(pagesLines: Line[][], pages: Page[]): Set<Line> {
  // Each line's words (numbers masked) and how far it stands from the bottom edge (a footer) or
  // the top one (a header).
  const info = pagesLines
    .flat()
    .map((l) => {
      const h = pages[l.page].height
      const side = l.y > 0.8 * h ? 'f' : l.y < 0.12 * h ? 'h' : ''
      const k = l.text
        .replace(/(…|\.{2,}|\s)\s*([ivxlcdm]+|\d+)\s*$/i, '')
        .replace(/\d+/g, '#')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
      return { l, k, side, d: Math.round(side === 'f' ? h - l.y : l.y) }
    })
    // Words, and not a caption or note: "Table 3" opening page after page is still a caption.
    .filter((x) => /\p{L}/u.test(x.k) && !OUTSIDE.test(x.l.text.trim()))
  const anywhere = new Map<string, Set<number>>()
  const near = new Map<string, Set<number>>()
  const add = (m: Map<string, Set<number>>, k: string, page: number) =>
    m.set(k, (m.get(k) ?? new Set()).add(page))
  for (const x of info) {
    add(anywhere, x.k, x.l.page)
    if (x.side) add(near, `${x.side}${x.d}|${x.k}`, x.l.page)
  }
  const min = Math.max(3, Math.ceil(pages.length / 4))
  const out = new Set<Line>()
  for (const x of info) {
    if (!x.side) continue
    // At about the same height: a footer moves a little with the size of its page number.
    const at = new Set<number>()
    for (let d = x.d - 2; d <= x.d + 2; d++)
      for (const p of near.get(`${x.side}${d}|${x.k}`) ?? []) at.add(p)
    if (at.size >= min && at.size >= 0.8 * anywhere.get(x.k)!.size) out.add(x.l)
  }
  return out
}

/** Footer (and header) lines: in the outer inch, set apart from the body or shaped like a page
 *  number, or a running head or foot. */
function splitBands(lines: Line[], height: number, running: Set<Line>) {
  const footer: Line[] = []
  const header: Line[] = []
  const body: Line[] = []
  const looksLikeNumber = (t: string) =>
    /(…|\.{2,}|\.\s\.\s\.)\s*\S+\s*$|^\s*([ivxlcdm]+|\d+)\s*$/i.test(t)
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k]
    const above = lines[k - 1]
    const below = lines[k + 1]
    if (running.has(l)) (l.y > height / 2 ? footer : header).push(l)
    else if (
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

/** Lines inside ruled tables: between the first and the last of two or more horizontal rules of
 *  one length, one above the other, with no caption or note between them. Underlines (a rule just
 *  under a line's own words), signature lines (short) and a header's rule (at the same height on
 *  most pages) are not table borders. */
function tableLines(pagesLines: Line[][], pages: Page[]): Set<Line> {
  type Rule = { y: number; x0: number; x1: number }
  const rules = pages.map((pg, n) => {
    const rows: Rule[] = []
    for (const m of pg.marks) {
      if (m.kind !== 'path' || m.y1 - m.y0 > 2) continue
      const y = (m.y0 + m.y1) / 2
      const row = rows.find((r) => Math.abs(r.y - y) < 1.5)
      if (row) {
        row.x0 = Math.min(row.x0, m.x0)
        row.x1 = Math.max(row.x1, m.x1)
      } else rows.push({ y, x0: m.x0, x1: m.x1 })
    }
    const underline = (r: Rule) =>
      pagesLines[n].some(
        (l) => r.y >= l.y && r.y - l.y < 0.35 * l.size && r.x0 >= l.x0 - 2 && r.x1 <= l.x1 + 2,
      )
    return rows
      .filter((r) => r.x1 - r.x0 >= 0.3 * pg.width && !underline(r))
      .sort((a, b) => a.y - b.y)
  })
  const seen = new Map<number, number>()
  for (const rs of rules)
    for (const y of new Set(rs.map((r) => Math.round(r.y)))) seen.set(y, (seen.get(y) ?? 0) + 1)
  const running = (r: Rule) => (seen.get(Math.round(r.y)) ?? 0) >= Math.max(3, pages.length / 2)
  const out = new Set<Line>()
  for (const [n, rs] of rules.entries()) {
    const lines = pagesLines[n]
    let chain: Rule[] = []
    const close = () => {
      if (chain.length >= 2)
        for (const l of lines) if (l.y > chain[0].y && l.y < chain.at(-1)!.y) out.add(l)
      chain = []
    }
    for (const r of rs.filter((r) => !running(r))) {
      const first = chain[0]
      const same = first && Math.abs(r.x0 - first.x0) <= 3 && Math.abs(r.x1 - first.x1) <= 3
      // A rule under some of the cells only: inside the table, neither ending nor extending it.
      if (first && !same && r.x0 >= first.x0 - 3 && r.x1 <= first.x1 + 3) continue
      const last = chain.at(-1)
      if (!same || lines.some((l) => l.y > last!.y && l.y < r.y && OUTSIDE.test(l.text.trim())))
        close()
      chain.push(r)
    }
    close()
  }
  return out
}

interface Margins {
  left: number
  right: number
  /** Most long lines run to the right margin: the page's text is justified. */
  justified?: boolean
}

/** Text margins from long lines in the text's size (`size`), not table rows or smaller notes. */
function marginsOf(lines: Line[], size: number, fallback?: Margins): Margins | undefined {
  const long = lines.filter(
    (l) => l.text.length > 40 && !l.text.includes('\t') && Math.abs(l.size - size) < 0.6,
  )
  if (long.length < 4) return fallback
  const left = mode(long.map((l) => l.x0))
  // Centred lines (a title page) share no left edge: that page keeps the document's margins.
  if (fallback && long.filter((l) => Math.round(l.x0) === left).length < 3) return fallback
  // Ragged-right lines rarely reach the margin; the longest ones (bar a stray) mark it.
  const xs1 = long.map((l) => l.x1).sort((a, b) => a - b)
  const right = xs1[Math.floor(xs1.length * 0.95)]
  const full = long.filter((l) => l.x1 >= right - 2.5).length
  // Most lines may start at an indent (short paragraphs, a reference list's hanging lines), never
  // left of the margin: the page's margin is not right of the document's.
  return {
    left: fallback ? Math.min(left, fallback.left) : left,
    right,
    justified: full >= 0.5 * long.length,
  }
}

/** 1 when every word of a line is bold, 0 when none is (a bold title and "Thesis Adviser:"). */
const boldness = (l: Line) => {
  const runs = l.runs.filter((r) => r.text.trim())
  return runs.filter((r) => r.bold).length / (runs.length || 1)
}

/** Width of a line's first word, across the spans it runs over without a space (an italic volume
 *  number, then its issue); on the generous side (half an em a letter at least), so a word is
 *  never thought to fit where the writer's program found no room. */
const firstWord = (l: Line) => {
  const word = l.text.trimStart().split(/\s/)[0]
  const x0 = l.spans[0]?.x0 ?? 0
  let x1 = x0
  let left = word.length
  for (const s of l.spans) {
    if (left <= 0) break
    if (!s.text) continue
    const take = Math.min(left, s.text.length)
    x1 = s.x0 + (s.x1 - s.x0) * (take / s.text.length)
    left -= take
  }
  return Math.max(x1 - x0, word.length * 0.5 * l.size)
}

/** Whether the next line's first word would have fit at the end of `prev`: if it would, the
 *  writer ended the paragraph there (a wrapped line takes every word that fits). */
const roomFor = (prev: Line, next: Line, right: number) =>
  prev.x1 + 0.25 * next.size + firstWord(next) < right - 1

/** Lines into paragraphs, carrying a paragraph across a page break when its line ran full. */
function toParas(pagesLines: Line[][], pages: Page[], tables: Set<Line>): Para[] {
  const size = mode(pagesLines.flat().map((l) => l.size))
  const docMargins = marginsOf(pagesLines.flat(), size) ?? { left: 72, right: 523 }
  const margins = pagesLines.map((ls) => {
    // A ruled table's rows do not show where the page's text runs.
    const text = ls.filter((l) => !tables.has(l))
    return marginsOf(text, size, docMargins) ?? docMargins
  })
  const paras: Para[] = []
  let draft: Line[] = []
  let cont: number | undefined // x0 of the second line
  // How the paragraph being built sits: centred and right-aligned lines stack differently.
  let kind: 'left' | 'center' | 'right' = 'left'
  // The paragraph before had a hanging indent (a reference list): an unindented second line is a new entry.
  let lastHanging = false

  // How many lines of each page start at each point: where a centred line starts depends on its
  // length, so a left edge two other lines share is an indent (a reference list's first lines).
  const starts = pagesLines.map((ls) => {
    const count = new Map<number, number>()
    for (const l of ls) count.set(Math.round(l.x0), (count.get(Math.round(l.x0)) ?? 0) + 1)
    return count
  })
  const shared = (l: Line) =>
    [-1, 0, 1].reduce((n, d) => n + (starts[l.page].get(Math.round(l.x0) + d) ?? 0), 0) >= 3
  const kindOf = (l: Line, m: Margins): typeof kind => {
    const width = m.right - m.left
    if (
      Math.abs((l.x0 + l.x1) / 2 - (m.left + m.right) / 2) < 8 &&
      l.x0 > m.left + 12 &&
      l.x1 < m.right - 12 &&
      !shared(l)
    )
      return 'center'
    if (Math.abs(l.x1 - m.right) < 3 && l.x0 > m.left + 0.3 * width) return 'right'
    return 'left'
  }
  const flush = () => {
    if (draft.length) {
      const para = toPara(draft, paras.length, margins[draft[0].page], kind === 'center')
      if (draft.every((l) => tables.has(l))) para.inTable = true
      paras.push(para)
      lastHanging = draft.length > 1 && (para.indent?.firstLine ?? 0) < -18
    }
    draft = []
    cont = undefined
  }

  for (let p = 0; p < pagesLines.length; p++) {
    const m = margins[p]
    const width = m.right - m.left
    pages[p].margins = { left: m.left, right: m.right }
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
        // On a page of justified text, a line stopping short of the margin after lines that all ran
        // full is a paragraph's last (or one before a line break), even if the next word is long.
        const shortEnd =
          !!pm.justified &&
          draft.length >= 2 &&
          prev.x1 < pm.right - 2.5 &&
          draft.slice(0, -1).every((l) => l.x1 >= margins[l.page].right - 2.5)
        // Lines with cells or a leader (table rows, contents entries) are never one wrapped
        // paragraph, nor are a ruled table's line and a line outside it.
        const tabular =
          prev.text.includes('\t') || c.text.includes('\t') || tables.has(prev) !== tables.has(c)
        if (prev.page !== c.page) {
          // A new page: the paragraph goes on only if its last line ran full, and the line goes on
          // where its lines run: at the margin, or at a hanging indent (like the paragraph above's,
          // or where the page's lines run, in a reference list).
          const aligned =
            cont !== undefined
              ? !offCont
              : c.x0 < draft[0].x0 - 8 ||
                Math.abs(c.x0 - m.left) <= 3 ||
                (c.x0 > draft[0].x0 + 8 && (lastHanging || shared(c)))
          split =
            kind !== 'left' ||
            ended ||
            shortEnd ||
            tabular ||
            !sameSize ||
            !aligned ||
            opens(c, prev) ||
            kindOf(c, m) !== 'left' ||
            // A wholly bold line against one that is not: a heading starts or ends there.
            (boldness(prev) === 1) !== (boldness(c) === 1)
        } else {
          const gap = c.y - prev.y
          // The gaps between lines on one page (not the jump back up to a new page's top).
          const gaps = draft
            .slice(1)
            .flatMap((l, i) => (l.page === draft[i].page ? [l.y - draft[i].y] : []))
          // With no gap on this page to go by yet, a line running on at the left margin (no bold
          // heading on either side) takes the next gap as its measure: double-spaced lines made
          // taller by a symbol (an arrow) are still one paragraph.
          const after = pagesLines[p][k + 1]
          const runOn =
            !!after && Math.abs(c.x0 - m.left) <= 3 && boldness(prev) < 1 && boldness(c) < 1
          const apart =
            gap <= 0 ||
            (gaps.length
              ? gap > 1.35 * median(gaps)
              : gap > Math.max(2.6 * prev.size, runOn ? 1.35 * (after.y - c.y) : 0))
          if (apart || !sameSize || tabular) split = true
          // Stacked centred or right-aligned lines are one paragraph only when the next line's first
          // word would not have fitted on the line above, and both are bold or neither is.
          else if (kind !== 'left')
            split =
              kindOf(c, m) !== kind ||
              prev.x1 - prev.x0 + 0.25 * c.size + firstWord(c) < width - 1 ||
              Math.abs(boldness(prev) - boldness(c)) === 1
          // A left or justified paragraph goes on while its lines run full and keep their indent
          // (its last line may happen to look centred).
          else split = ended || shortEnd || opens(c, prev) || offCont || newEntry
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
    // Pixels a privacy setting blanks would make a real seal look missing: none is better.
    if (!canvasReadsBack()) return undefined
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
