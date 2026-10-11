// Body text: which paragraphs count, and whether they are justified and double-spaced.
import type { Para } from '../model.ts'
import { fix, na, ok, review, spread, type Ctx, type Finding } from '../report.ts'
import { bolded, isHeadingish, isTocLine } from '../structure.ts'
import { norm, plural, quote } from '../text.ts'
import { pagesText } from './numbering.ts'

// Double spacing is 2 lines; 24 pt on 12 pt type (1.74) still reads as double, 1.5 lines does not.
export const DOUBLE = 1.7
const LIST = /^(\(?\d{1,2}[.)]|\(?[a-z][.)]|[•●▪◦‣∙·-])\s/i
export const CAPTION = /^(table|fig(ure)?\.?)\s*\d/i

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

/** Running text in paragraphs [start, end): no headings, captions, notes, tables, boxes or blanks. */
export function bodyParas(ctx: Ctx, start: number, end: number, skip = new Set<number>()): Para[] {
  return ctx.doc.paras.slice(start, end).filter((p) => {
    const t = norm(p.text)
    return (
      t &&
      !skip.has(p.i) &&
      !p.inTable &&
      !p.inBox &&
      !CAPTION.test(t) &&
      // A table's or figure's note belongs to its setup (APA), not to the body text.
      !/^note[.:]/i.test(t) &&
      !isTocLine(p.text) &&
      !(isHeadingish(p) && t.length <= 120) &&
      !/^key\s?words?\s*:/i.test(t) &&
      !apart(ctx, p)
    )
  })
}

/** Long enough to tell justified from left-aligned: two lines or more. */
const multiLine = (ctx: Ctx, p: Para) =>
  ctx.doc.kind === 'pdf' ? (p.lines?.length ?? 0) >= 2 : norm(p.text).length > 110

export const isList = (p: Para) => !!p.list || LIST.test(norm(p.text))

const where = (ps: Para[]) => spread(ps.map((p) => ({ page: p.page, quote: quote(p.text, 60) })))

/** A finding for justification over the given paragraphs; `name` says where ("the chapters"). */
export function justified(ctx: Ctx, id: string, paras: Para[], name: string): Finding {
  const checked = paras.filter((p) => multiLine(ctx, p) && !isList(p) && p.align !== 'center')
  if (ctx.doc.kind === 'doc')
    return review(
      id,
      `Check that the body text of ${name} is justified (an old .doc file does not say).`,
    )
  if (!checked.length) return na(id, `No body text found in ${name}.`)
  const bad = checked.filter((p) => p.align !== 'justify')
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
  // Three lines or more and not one reaching the margin: left-aligned, whatever the line breaks.
  const ragged = (p: Para) => (p.lines?.length ?? 0) >= 3 && short(p).length === p.lines!.length
  const status = bad.length >= 2 || share >= 0.1 || bad.some(ragged) ? fix : review
  // One paragraph with one short line before its last: left-aligned, or a line break typed there.
  const one = bad.length === 1 ? short(bad[0]).filter((l) => l !== bad[0].lines?.at(-1)) : []
  if (one.length === 1)
    return status(
      id,
      `A line stops short of the margin on ${pagesText([one[0].page])}: justify the paragraph, or remove the line break there.`,
      // No "not justified" count: the paragraph may be justified, with a line break typed there.
      { where: where(bad) },
    )
  return status(id, `Justify the body text of ${name} (Home > Justify, or Ctrl+J).`, {
    details,
    where: where(bad),
  })
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
  const checked = [...paras.filter((p) => p.spacing !== undefined), ...lists]
  if (!checked.length) return na(id, `No body text found in ${name}.`)
  const bad = checked.filter((p) => p.spacing! < DOUBLE).sort((a, b) => a.i - b.i)
  if (!bad.length) return ok(id, `The body text of ${name} is double-spaced.`)
  const kinds = [...new Set(bad.map((p) => spacingName(p.spacing!)))]
  const share = bad.length / checked.length
  return (bad.length >= 2 || share >= 0.1 ? fix : review)(
    id,
    `Double-space the body text of ${name} (Line spacing: Double).`,
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
