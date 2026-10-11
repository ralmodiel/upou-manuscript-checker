// Body text: which paragraphs count, and whether they are justified and double-spaced.
import type { Para } from '../model.ts'
import { fix, na, ok, review, type Ctx, type Finding } from '../report.ts'
import { isHeadingish, TOC_ENTRY } from '../structure.ts'
import { norm, plural, quote } from '../text.ts'

// Double spacing is 2 lines; 24 pt on 12 pt type (1.74) still reads as double, 1.5 lines does not.
export const DOUBLE = 1.7
const LIST = /^(\(?\d{1,2}[.)]|\(?[a-z][.)]|[•●▪◦‣∙·-])\s/i
const CAPTION = /^(table|figure)\s+\d/i

/** Running text in paragraphs [start, end): no headings, captions, tables, boxes or blanks. */
export function bodyParas(ctx: Ctx, start: number, end: number, skip = new Set<number>()): Para[] {
  return ctx.doc.paras.slice(start, end).filter((p) => {
    const t = norm(p.text)
    return (
      t &&
      !skip.has(p.i) &&
      !p.inTable &&
      !p.inBox &&
      !CAPTION.test(t) &&
      !TOC_ENTRY.test(p.text) &&
      !(isHeadingish(p) && t.length <= 120) &&
      !/^key\s?words?\s*:/i.test(t)
    )
  })
}

/** Long enough to tell justified from left-aligned: two lines or more. */
const multiLine = (ctx: Ctx, p: Para) =>
  ctx.doc.kind === 'pdf' ? (p.lines?.length ?? 0) >= 2 : norm(p.text).length > 110

const isList = (p: Para) => !!p.list || LIST.test(norm(p.text))

const where = (ps: Para[]) =>
  ps.slice(0, 5).map((p) => ({ page: p.page, quote: quote(p.text, 60) }))

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
    `${bad.length} of ${plural(checked.length, 'paragraph')} ${bad.length === 1 ? 'is' : 'are'} not justified.`,
  ]
  const share = bad.length / checked.length
  return (bad.length >= 2 || share >= 0.1 ? fix : review)(
    id,
    `Justify the body text of ${name} (Home > Justify, or Ctrl+J).`,
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
  const checked = paras.filter((p) => p.spacing !== undefined)
  if (!checked.length) return na(id, `No body text found in ${name}.`)
  const bad = checked.filter((p) => p.spacing! < DOUBLE)
  if (!bad.length) return ok(id, `The body text of ${name} is double-spaced.`)
  const kinds = [...new Set(bad.map((p) => spacingName(p.spacing!)))]
  const share = bad.length / checked.length
  return (bad.length >= 2 || share >= 0.1 ? fix : review)(
    id,
    `Double-space the body text of ${name} (Line spacing: Double).`,
    {
      details: [
        `${bad.length} of ${plural(checked.length, 'paragraph')} ${bad.length === 1 ? 'is' : 'are'} spaced ${kinds.slice(0, 3).join(' or ')}.`,
      ],
      where: where(bad),
    },
  )
}
