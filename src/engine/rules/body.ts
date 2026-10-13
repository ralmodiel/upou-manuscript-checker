// Body text: which paragraphs count, and whether they are justified and double-spaced.
import type { Para } from '../model.ts'
import { na, ok, review, spread, weigh, type Ctx, type Finding } from '../report.ts'
import { bolded, isHeadingish, isTocLine } from '../structure.ts'
import { garbled, norm, plural, quote } from '../text.ts'
import { pagesText } from './numbering.ts'

// Double spacing is 2 lines; 24 pt on 12 pt type (1.74) still reads as double, 1.5 lines does not.
export const DOUBLE = 1.7
// A bullet may be typed in a symbol font ("o", a black circle) or come out as a private-use letter.
const LIST =
  /^(\(?\d{1,2}[.)]|\(?[IVXLivxl]{1,5}[.)]|\(?[a-z][.)]|[•●▪◦‣∙·–—⚫⚪○◆◇■□➢➤➔✓✔-]|o|[a-z](?=\s[-–—]\s))\s/i
const symbolBullet = (t: string) => {
  const c = t.trimStart().charCodeAt(0)
  return c >= 0xf000 && c <= 0xf0ff
}
export const CAPTION = /^(table|fig(ure)?\.?|chart|exhibit)\s*[a-z]?-?\d/i

/** A PDF paragraph that is not running text: wholly bold (a long caption or heading run on), or
 *  a narrow column of lines (a table's cell). */
const apart = (ctx: Ctx, p: Para) => {
  if (!p.lines) return false
  const page = ctx.doc.pages?.[p.page ?? 0]
  const width = page?.margins ? page.margins.right - page.margins.left : (page?.width ?? 612) - 144
  return (
    bolded(p) || (p.lines.length >= 2 && Math.max(...p.lines.map((l) => l.x1 - l.x0)) < 0.5 * width)
  )
}

/** The size of running text (PDF): of the first lines of the long paragraphs, the largest size
 *  many of them share (tables and notes in smaller type may be as many). */
export function textSize(paras: Para[]): number {
  const sizes = paras.flatMap((q) =>
    q.lines?.[0] && q.text.length > 80 && !q.inTable ? [Math.round(q.lines[0].size * 2) / 2] : [],
  )
  return Math.max(
    0,
    ...[...new Set(sizes)].filter(
      (z) => sizes.filter((x) => x === z).length >= 0.25 * sizes.length,
    ),
  )
}

/** A short note under a table (its scale, its key), whether or not it opens with "Note:". */
const tableNote = (prev: Para | undefined, p: Para) =>
  !!prev &&
  (!!prev.inTable || prev.text.includes('\t')) &&
  !p.text.includes('\t') &&
  (p.lines ? p.lines.length <= 3 : norm(p.text).length < 300)

/** A table's row read as a paragraph: its first line stands a long way from the other lines
 *  (a label, then its text in the next column). */
const tableRow = (p: Para) => Math.abs(p.indent?.firstLine ?? 0) >= 100

/** A list of abbreviations or definitions: several lines opening with a term, a full stop or
 *  colon, then its meaning ("IRD. Industrial Research Department"). */
const glossary = (p: Para) =>
  (p.lines ?? []).filter((l) => /^[A-Z][A-Za-z0-9&/-]{1,12}\s*[.:=–—-]\s+\p{Lu}/u.test(l.text))
    .length >= 2 ||
  // (or a term, a dash and its meaning in lower case, on several lines: one-line entries)
  (p.lines ?? []).filter((l) => /^\p{Lu}[\p{L}\p{N}'’/&() ]{1,40}?\s[-–—]\s+\S/u.test(l.text))
    .length >= 2

/** A table's row (a label with figures beside it, the rest of the label possibly on the next line):
 *  two figures side by side, one with decimals. */
const wrappedRow = (p: Para) => {
  const rows = (p.lines ?? []).filter((l) =>
    // (or a count and its share, "194 (69.8%)")
    /(?<!\S)\d+(\.\d+)?\*{0,3}\s+\d*\.\d+\*{0,3}(?!\S)|(?<!\S)\d+\s*\(\d+(\.\d+)?\s?%\)/.test(
      l.text,
    ),
  ).length
  // (a few lines of a row, or several rows)
  return rows >= 2 || (rows === 1 && p.lines!.length <= 4)
}

/** A row of figures read as a paragraph (an item, then its mean and its deviation). */
const figureRow = (t: string) => t.length < 200 && /\d+([.,]\d+)?\s+\(?\d+([.,]\d+)?\)?\s*$/.test(t)

/** An excerpt of a transcript: numbered lines (007, 034…), an annotation in double parentheses,
 *  or the caption "Extracted Lines". */
const transcript = (t: string) => /^(0\d{1,3}\s|\(\(|extracted lines?\b)/i.test(t)

/** PDF: the paragraph's lines lie within one drawn shape (a box of a diagram, a table's cell)
 *  smaller than the page's text: text of a figure, not running text. */
export function inShape(ctx: Ctx, p: Para, widest = 0.7): boolean {
  const ls = p.lines
  const pg = ls && ctx.doc.pages?.[ls[0].page]
  if (!ls || !pg || ls.some((l) => l.page !== ls[0].page)) return false
  const x0 = Math.min(...ls.map((l) => l.x0))
  const x1 = Math.max(...ls.map((l) => l.x1))
  const top = ls[0].y - ls[0].size
  const bottom = ls[ls.length - 1].y + 0.3 * ls[0].size
  return pg.marks.some(
    (m) =>
      m.kind === 'path' &&
      m.x1 - m.x0 < widest * pg.width &&
      m.y1 - m.y0 > 1.5 * ls[0].size &&
      m.x0 <= x0 + 2 &&
      m.x1 >= x1 - 2 &&
      m.y0 <= top + 2 &&
      m.y1 >= bottom - 2,
  )
}

/** A table's or figure's label alone on its line ("Table 2"), its title coming below (APA). */
const LABEL_ONLY = /^(table|fig(ure)?\.?)\s*\d+[.:]?$/i

/** An indented quotation: several lines set in from the margin on every line, not a list. */
export const blockQuote = (ctx: Ctx, p: Para) =>
  !isList(p) &&
  (ctx.doc.kind === 'pdf' ? (p.lines?.length ?? 0) >= 2 : norm(p.text).length > 110) &&
  (p.indent?.left ?? 0) >= 30 &&
  (p.indent?.firstLine ?? 0) >= -3

/** Running text in paragraphs [start, end): no headings, captions, notes, tables, boxes or blanks. */
export function bodyParas(ctx: Ctx, start: number, end: number, skip = new Set<number>()): Para[] {
  const { paras } = ctx.doc
  // PDF: the text size of the document; a note under a page's text is set smaller.
  const size = mode(paras.flatMap((p) => (p.lines?.[0] ? [p.lines[0].size] : [])))
  const italic = (p: Para) => p.runs.filter((r) => r.text.trim()).every((r) => r.italic)
  return paras.slice(start, end).filter((p) => {
    const t = norm(p.text)
    const next = paras[p.i + 1]
    return (
      t &&
      !skip.has(p.i) &&
      !p.inTable &&
      !p.inBox &&
      !CAPTION.test(t) &&
      // A table's or figure's note belongs to its setup (APA), not to the body text.
      !/^(notes?|sources?)\s*[.:]/i.test(t) &&
      !isTocLine(p.text) &&
      !(isHeadingish(p) && t.length <= 120) &&
      !tableNote(paras[p.i - 1], p) &&
      !tableRow(p) &&
      // (a line with a column's gap inside it, after any list label: cells of a table side by side)
      !p.lines?.some((l) => /\S\t/.test(l.text.replace(/^\S{1,5}\t/, ''))) &&
      !transcript(t) &&
      // A legend's row: a range of scores, then what it means ("1.00 to 1.79 Very low").
      !/^\d+(\.\d+)?\s*(to|[-–—])\s*\d+(\.\d+)?\s+\p{L}/u.test(t) &&
      !glossary(p) &&
      !wrappedRow(p) &&
      !figureRow(t) &&
      !inShape(ctx, p) &&
      !/^key\s?words?\s*:/i.test(t) &&
      !apart(ctx, p) &&
      // A footnote: set smaller than the text.
      !(p.lines?.[0] && size && p.lines[0].size < size - 1) &&
      !footnote(paras, p) &&
      // A table's title: under its label, or in italics above its table (APA).
      !LABEL_ONLY.test(norm(paras[p.i - 1]?.text ?? '')) &&
      !(
        p.lines &&
        p.lines.length <= 3 &&
        italic(p) &&
        !!next &&
        (next.inTable || next.text.includes('\t'))
      )
    )
  })
}

/** PDF: a footnote at the foot of its page, opening with its mark in small raised type ("¹ The
 *  office…"), only footnotes below it on the page. */
function footnote(paras: Para[], p: Para): boolean {
  if (!p.lines) return false
  const runs = p.runs.filter((r) => r.text.trim())
  const [mark, text] = runs
  if (
    !mark?.size ||
    !text?.size ||
    !/^(\d{1,3}|[*†‡])$/.test(mark.text.trim()) ||
    mark.size > 0.75 * text.size
  )
    return false
  const next = paras[p.i + 1]
  return !next || next.page !== p.page || footnote(paras, next)
}

const mode = (xs: number[]) => {
  const count = new Map<number, number>()
  let best = 0
  for (const x of xs) {
    const k = Math.round(x * 2) / 2
    count.set(k, (count.get(k) ?? 0) + 1)
    if (count.get(k)! > (count.get(best) ?? 0)) best = k
  }
  return best
}

/** Long enough to tell justified from left-aligned: two lines or more. */
const multiLine = (ctx: Ctx, p: Para) =>
  ctx.doc.kind === 'pdf' ? (p.lines?.length ?? 0) >= 2 : norm(p.text).length > 110

export const isList = (p: Para) => !!p.list || LIST.test(norm(p.text)) || symbolBullet(p.text)

const where = (ps: Para[]) => spread(ps.map((p) => ({ page: p.page, quote: quote(p.text, 60) })))

/** PDF: paragraphs that read as justified because the text was cut into paragraphs at each short
 *  line. Where the paragraphs open with an indent, lines below a short line that start at the margin,
 *  with no gap, and go on its sentence (a run-in heading, a line short of the margin) are the same
 *  paragraph: all its lines together are as ragged as a left-aligned paragraph's. */
function runOns(ctx: Ctx, checked: Para[]): Para[] {
  const { doc } = ctx
  if (doc.kind !== 'pdf') return []
  const indented = checked.filter((p) => (p.indent?.firstLine ?? 0) >= 15).length
  if (indented < 0.5 * checked.length) return []
  const out: Para[] = []
  const joined = new Set<number>()
  for (const p of checked) {
    if (joined.has(p.i) || !p.lines) continue
    const pg = doc.pages?.[p.lines[0].page]
    const edge = pg?.margins
    if (!edge) continue
    const chain = [p]
    for (let q = doc.paras[p.i + 1]; q; q = doc.paras[q.i + 1]) {
      const prev = chain.at(-1)!.lines!
      const last = prev.at(-1)!
      const top = q.lines?.[0]
      const pitch = prev.length > 1 ? last.y - prev.at(-2)!.y : 2 * last.size
      if (
        !top ||
        top.page !== last.page ||
        Math.abs(top.x0 - edge.left) > 3 ||
        Math.abs(top.size - last.size) > 0.6 ||
        top.y - last.y > 1.4 * pitch ||
        last.x1 >= edge.right - 5 ||
        !(/^[“"'‘(]?\p{Ll}/u.test(norm(q.text)) || !/[.?!:;”"’)]\s*$/.test(last.text)) ||
        isList(q) ||
        isHeadingish(q) ||
        q.inTable ||
        q.align === 'center'
      )
        break
      chain.push(q)
      joined.add(q.i)
    }
    if (chain.length < 2 || garbled(chain.map((q) => q.text).join(' '))) continue
    const body = chain.flatMap((q) => q.lines!).slice(0, -1)
    // (two lines or more short of the margin, and a seventh or more of all)
    const short = body.filter((l) => l.x1 < edge.right - 5).length
    // (lines that mostly end at one point of their own are set to a width of their own: a quotation)
    const own = Math.max(
      ...body.map((a) => body.filter((l) => Math.abs(l.x1 - a.x1) <= 1.5).length),
    )
    if (short >= 2 && short / body.length > 0.15 && own < 0.5 * body.length) out.push(p)
  }
  return out
}

/** PDF: two lines, no indent and no full stop at the end: a subheading that wraps, not a paragraph. */
const titleLines = (ctx: Ctx, p: Para) =>
  ctx.doc.kind === 'pdf' &&
  (p.lines?.length ?? 0) === 2 &&
  (p.indent?.firstLine ?? 0) < 8 &&
  norm(p.text).length < 200 &&
  !/[.!?:;,”"’)\]]$/.test(norm(p.text))

/** PDF: every line centred between the margins, some set in from them (a quotation set centred,
 *  its source under it): centred text, not text left unjustified. */
const centredLines = (ctx: Ctx, p: Para) => {
  const ls = p.lines ?? []
  const m = ls[0] && ctx.doc.pages?.[ls[0].page]?.margins
  // (a quotation's: quotation marks in it or in the lines around it)
  const near = [p.i - 1, p.i, p.i + 1].map((k) => ctx.doc.paras[k])
  return (
    !!m &&
    near.some((q) => !!q && q.page === p.page && /^["“]|["”]$/.test(norm(q.text))) &&
    ls.length >= 2 &&
    ls.every((l) => Math.abs((l.x0 + l.x1) / 2 - (m.left + m.right) / 2) <= 4) &&
    ls.some((l) => l.x0 > m.left + 3) &&
    ls.every((l) => l.x1 < m.right - 1)
  )
}

/** A finding for justification over the given paragraphs; `name` says where ("the chapters"). */
export function justified(ctx: Ctx, id: string, paras: Para[], name: string): Finding {
  // An indented quotation is often left-aligned.
  const checked = paras.filter(
    (p) =>
      multiLine(ctx, p) &&
      !isList(p) &&
      p.align !== 'center' &&
      // (the preliminary pages hold no quotations: centred text there is to justify)
      !(id !== 'prelims.justified' && centredLines(ctx, p)) &&
      !blockQuote(ctx, p) &&
      !titleLines(ctx, p) &&
      // PDF: two lines ending a paragraph carried over from the page before, the first reaching to
      // within a hair of the margin (too little to tell justified from left-aligned)
      !(
        ctx.doc.kind === 'pdf' &&
        p.lines?.length === 2 &&
        /^\p{Ll}/u.test(norm(p.text)) &&
        p.lines[0].x1 >= (ctx.doc.pages?.[p.lines[0].page].margins?.right ?? Infinity) - 3
      ),
  )
  if (ctx.doc.kind === 'doc')
    return review(
      id,
      `Check that the body text of ${name} is justified (an old .doc file does not say).`,
    )
  if (!checked.length) return na(id, `No body text found in ${name}.`)
  const run = runOns(ctx, checked)
  const bad = checked.filter((p) => p.align !== 'justify' || run.includes(p))
  // (one paragraph is too little to stand for the rest: other pages may not have been read as such)
  if (!bad.length && checked.length === 1)
    return review(
      id,
      `Only one paragraph of body text in ${name} could be checked, and it is justified. Check that the rest of the body text there is justified too.`,
    )
  if (!bad.length)
    return ok(
      id,
      `All ${plural(checked.length, 'paragraph')} of body text in ${name} are justified.`,
    )
  const details = [
    `${bad.length} of ${plural(checked.length, 'paragraph')} ${bad.length === 1 ? 'is' : 'are'} not justified${onPages(bad)}.`,
  ]
  const share = bad.length / checked.length
  // PDF lines short of the page's margin.
  const short = (p: Para) =>
    (p.lines ?? []).filter((l) => l.x1 < (ctx.doc.pages?.[l.page].margins?.right ?? Infinity) - 2.5)
  // A PDF's alignment is read from where its lines end: a few ragged paragraphs among justified
  // ones may be a table's text, a quotation or a list read as body text, or text justified to a
  // narrower edge. Only a large share of the body text is firm evidence.
  const strong = ctx.doc.kind === 'pdf' ? share >= 0.15 : bad.length >= 2 || share >= 0.1
  // One paragraph with one short line before its last: left-aligned, or a line break typed there.
  const one = bad.length === 1 ? short(bad[0]).filter((l) => l !== bad[0].lines?.at(-1)) : []
  if (one.length === 1)
    return weigh(
      strong,
      id,
      `A line stops short of the margin on ${pagesText([one[0].page])}: justify the paragraph, or remove the line break there.`,
      `a line stops short of the margin on ${pagesText([one[0].page])}: the paragraph may not be justified, or a line break may be typed there.`,
      // No "not justified" count: the paragraph may be justified, with a line break typed there.
      { where: where(bad) },
    )
  return weigh(
    strong,
    id,
    `Justify the body text of ${name} (Home > Justify, or Ctrl+J).`,
    `${plural(bad.length, 'paragraph')} of body text in ${name} may not be justified (Home > Justify, or Ctrl+J). Some may be tables, lists or quotations, which need not be.`,
    { details, where: where(bad) },
  )
}

const spacingName = (x: number) =>
  x < 1.2
    ? 'single'
    : x < 1.4
      ? `${x.toFixed(2)} lines`
      : x < 1.65
        ? '1.5 lines'
        : `${x.toFixed(1)} lines`

export function doubleSpaced(ctx: Ctx, id: string, paras: Para[], name: string): Finding {
  if (ctx.doc.kind === 'doc')
    return review(
      id,
      `Check that the body text of ${name} is double-spaced (an old .doc file does not say).`,
    )
  // PDF: one-line list items are paragraphs of their own, each without a spacing; a run of them on
  // one page is measured by the gap between their baselines, as one paragraph.
  const runs: Para[][] = []
  for (const p of paras) {
    if (ctx.doc.kind !== 'pdf' || p.lines?.length !== 1 || !isList(p)) continue
    const last = runs.at(-1)?.at(-1)
    if (last && last.i === p.i - 1 && last.page === p.page) runs.at(-1)!.push(p)
    else runs.push([p])
  }
  const lists = runs
    .filter((r) => r.length >= 2)
    .map((r) => {
      const gaps = r.slice(1).map((q, k) => q.lines![0].y - r[k].lines![0].y)
      return { ...r[0], spacing: median(gaps) / (1.15 * r[0].lines![0].size) }
    })
  const all = [...paras.filter((p) => p.spacing !== undefined), ...lists]
  // Indented quotations are often set single-spaced: for the student to look at, not to correct.
  const quotes = all.filter((p) => blockQuote(ctx, p))
  // (the items of a questionnaire or scale set in from the margin, an inch or so, are no running text)
  const checked = all.filter(
    (p) => !quotes.includes(p) && !(isList(p) && (p.indent?.left ?? 0) >= 54),
  )
  if (!all.length) return na(id, `No body text found in ${name}.`)
  const bad = checked.filter((p) => p.spacing! < DOUBLE).sort((a, b) => a.i - b.i)
  if (!bad.length) {
    const single = quotes.filter((p) => p.spacing! < DOUBLE)
    if (!single.length) return ok(id, `The body text of ${name} is double-spaced.`)
    return review(
      id,
      `Check the spacing of the indented quotations in ${name}: the rest of the body text is double-spaced.`,
      {
        details: [
          `${plural(single.length, 'quotation')} spaced ${single[0].spacing! < 1.2 ? 'single' : 'less than double'}${onPages(single)}.`,
        ],
        where: where(single),
      },
    )
  }
  const kinds = [...new Set(bad.map((p) => spacingName(p.spacing!)))]
  const share = bad.length / checked.length
  // One paragraph is enough when it is running text set single: three lines or more, not a list.
  const solid = bad.some(
    (p) =>
      p.spacing! < 1.2 &&
      !isList(p) &&
      (ctx.doc.kind === 'pdf' ? (p.lines?.length ?? 0) >= 3 : norm(p.text).length >= 300),
  )
  // A PDF's spacing is read from the gaps between its lines: a table's cells, a caption, a note or
  // a heading read as body text can look single-spaced. Firm evidence is a paragraph of running
  // text, three lines or more and not in italics, ending a sentence, clearly single or 1.5-spaced.
  const strong =
    (bad.length >= 2 || share >= 0.1 || solid) &&
    (ctx.doc.kind !== 'pdf' ||
      bad.some(
        (p) =>
          (p.lines?.length ?? 0) >= 3 &&
          p.spacing! <= 1.55 &&
          !isList(p) &&
          !p.runs.filter((r) => r.text.trim()).every((r) => r.italic) &&
          /[.!?]["”’)]*$/.test(norm(p.text)),
      ))
  return weigh(
    strong,
    id,
    `Double-space the body text of ${name} (Line spacing: Double).`,
    `some body text of ${name} may not be double-spaced (Line spacing: Double). Some may be tables, captions or notes read as body text, which need not be.`,
    {
      details: [
        `${bad.length} of ${plural(checked.length, 'paragraph')} ${bad.length === 1 ? 'is' : 'are'} spaced ${kinds.slice(0, 3).join(' or ')}${onPages(bad)}.`,
      ],
      where: where(bad),
    },
  )
}

/** " (pp. 26, 81)" for PDF paragraphs; nothing for a Word file. */
const onPages = (ps: Para[]) =>
  ps[0].page === undefined ? '' : ` (${pagesText(ps.map((p) => p.page!))})`

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
