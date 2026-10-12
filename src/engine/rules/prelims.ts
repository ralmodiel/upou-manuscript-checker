// Other preliminary pages: all there, justified, double-spaced, numbered in Roman numerals.
import { fix, na, ok, review, worst, type Ctx, type Finding } from '../report.ts'
import { PRELIM_NAMES, titlePage, type PrelimKey } from '../structure.ts'
import { list, norm, quote, roman } from '../text.ts'
import { bodyParas, doubleSpaced, justified } from './body.ts'
import { thesisTitle } from './front.ts'
import type { Caption } from './figures.ts'
import {
  auditPdf,
  judge,
  pagesText,
  summarize,
  wordSectionFolios,
  type Problem,
} from './numbering.ts'

const ORDER: PrelimKey[] = ['bio', 'ack', 'dedication', 'toc', 'tables', 'figures', 'abstract']

function present(ctx: Ctx, caps: Caption[]): Finding {
  const id = 'prelims.present'
  const { s, doc } = ctx
  const found = s.prelims.map((p) => p.key)
  const required: PrelimKey[] = ['bio', 'ack', 'dedication', 'toc']
  if (caps.some((c) => c.kind === 'table')) required.push('tables')
  if (caps.some((c) => c.kind === 'figure')) required.push('figures')
  required.push('abstract')
  const issues: string[] = []
  const statuses: Finding['status'][] = []
  // A dedication page without its heading: it opens "Dedicated to:".
  const dedicated = found.includes('dedication')
    ? undefined
    : doc.paras.find(
        (p) =>
          p.i >= (s.acceptance?.end ?? s.title.end) &&
          p.i < (s.chapters[0]?.start ?? s.references?.start ?? doc.paras.length) &&
          p.newPage &&
          /^dedicated\s+to\b/i.test(norm(p.text)),
      )
  const missing = required.filter((k) => !found.includes(k) && !(k === 'dedication' && dedicated))
  if (missing.length) {
    issues.push(
      `Include the missing preliminary pages: ${list(missing.map((k) => PRELIM_NAMES[k]))}.`,
    )
    statuses.push('fix')
  }
  if (dedicated) {
    issues.push(
      `The Dedication page opens “${quote(dedicated.text, 30)}” with no “Dedication” heading: check that it is set as in the template.`,
    )
    statuses.push('review')
  }
  // Duplicates, as two abstracts (one heading may stand for two keys: "List of Tables and Figures").
  for (const key of ORDER) {
    const heads = [...new Set(s.prelims.filter((p) => p.key === key).map((p) => p.heading))]
    if (heads.length > 1) {
      const where = heads.map((h) =>
        doc.paras[h].page === undefined
          ? `“${quote(doc.paras[h].text, 30)}”`
          : pagesText([doc.paras[h].page!]),
      )
      // A contents or list page may repeat its heading where the list runs on to the next page.
      const runsOn = key === 'toc' || key === 'tables' || key === 'figures'
      issues.push(
        `Delete the other version of the ${PRELIM_NAMES[key]} (${list(where)})${runsOn ? ', unless the heading only repeats where the list runs on to the next page' : ''}.`,
      )
      statuses.push(runsOn ? 'review' : 'fix')
    }
  }
  const firsts = ORDER.filter((k) => found.includes(k)).map((k) => ({
    k,
    at: s.prelims.find((p) => p.key === k)!.heading,
  }))
  if (firsts.some((x, i) => i > 0 && x.at < firsts[i - 1].at)) {
    issues.push(
      `Arrange them as in the template: ${list(ORDER.filter((k) => found.includes(k)).map((k) => PRELIM_NAMES[k]))}.`,
    )
    statuses.push('review')
  }
  const abstract = s.prelims.find((p) => p.key === 'abstract')
  if (
    abstract &&
    !doc.paras
      .slice(abstract.start, abstract.end)
      .some((p) => /^key\s?words?\s*[:.-]/i.test(norm(p.text)))
  ) {
    issues.push('Place the keywords right below the abstract (Keywords: …).')
    statuses.push('fix')
  }
  if (!issues.length)
    return ok(
      id,
      `All there: ${list(ORDER.filter((k) => found.includes(k)).map((k) => PRELIM_NAMES[k]))}.`,
    )
  const status = worst(statuses)
  // The first of the most serious issues leads.
  const lead = statuses.indexOf(status)
  return {
    id,
    status,
    message: issues[lead],
    details: issues.length > 1 ? issues.filter((_, k) => k !== lead) : undefined,
  }
}

/** Paragraph range of the preliminary pages after the Acceptance Page, up to Chapter I. */
function prelimRange(ctx: Ctx): [number, number] {
  const { s, doc } = ctx
  const start = s.acceptance?.end ?? s.permission?.end ?? s.title.end
  const end = s.chapters[0]?.start ?? s.references?.start ?? doc.paras.length
  return [start, end]
}

function numbers(ctx: Ctx): Finding {
  const id = 'prelims.pageNumbers'
  const { doc, s } = ctx
  const [start, end] = prelimRange(ctx)
  if (start >= end) return na(id, 'No preliminary pages found after the Acceptance Page.')
  if (!s.chapters.length)
    return review(
      id,
      'Chapter I was not found, so the numbering of the preliminary pages was not checked.',
    )
  const msg =
    'Add the shortened title + ellipsis + page number (in Roman numerals: iv, v, vi…) on the preliminary pages.'
  if (doc.kind === 'pdf') {
    const first = doc.paras[start]?.page ?? 3
    const last = (doc.paras[s.chapters[0].heading].page ?? doc.pages!.length) - 1
    if (last < first) return na(id, 'No preliminary pages found after the Acceptance Page.')
    const pages = Array.from({ length: last - first + 1 }, (_, k) => first + k)
    // Page i is the title page (a cover page before it is not counted).
    const base = titlePage(doc, s)
    const problems = auditPdf(
      doc,
      pages,
      (p) => ({ kind: 'roman', value: p - base + 1 }),
      thesisTitle(ctx),
    )
    if (!problems.length)
      return ok(
        id,
        `${pagesText(pages)} are numbered ${roman(first - base + 1)}\u2060–\u2060${roman(last - base + 1)}, with the shortened title and an ellipsis.`,
      )
    return fix(id, msg, { details: summarize(problems), where: [{ page: problems[0].page }] })
  }
  if (!doc.sections)
    return review(id, 'Check the page numbers of the preliminary pages in the PDF version.')
  // Word: every section that holds preliminary pages, by its footer and numbering.
  const secs = [...new Set(doc.paras.slice(start, end).map((p) => p.section ?? 0))]
  const problems: Problem[] = []
  for (const k of secs) {
    const sec = doc.sections[k]
    const head = doc.paras
      .slice(Math.max(start, sec.first), Math.min(end, sec.last + 1))
      .find((p) => norm(p.text))
    const at = head ? `the section from “${quote(head.text, 30)}”` : 'a section'
    // A section begun before these pages has its first page checked as the page it is (title,
    // permission or acceptance page).
    for (const f of wordSectionFolios(doc, k, sec.first < start))
      for (const p of judge(f.folio, { kind: 'roman' }))
        problems.push({ ...p, text: `${f.where}${at}: ${p.text}` })
    if (sec.start === 1 && k > 0)
      problems.push({
        type: 'value',
        text: `${at}: page numbers restart at i; continue them from the page before`,
      })
    else if (sec.start && sec.start > 1 && sec.newPage && k > 0) {
      // A restart in the middle of the front matter must pick up after the pages before it, which
      // begin where a page break or section opens one (title, permission and acceptance pages).
      const before = doc.paras
        .slice(0, sec.first)
        .filter((p) => p.newPage || p.renderedBreak === 'before').length
      const earlier = doc.sections.slice(1, k).some((x) => x.start !== undefined)
      if (before > 0 && !earlier && sec.start !== before + 1)
        problems.push({
          type: 'value',
          text: `${at}: page numbers start at ${roman(sec.start)}; continue them from the page before (${roman(before + 1)})`,
        })
    }
  }
  if (!problems.length)
    return ok(
      id,
      'The preliminary pages have the shortened title, an ellipsis and Roman page numbers.',
    )
  return fix(id, msg, { details: summarize(problems) })
}

export function prelimRules(ctx: Ctx, caps: Caption[]): Finding[] {
  const prose = ctx.s.prelims
    .filter(
      (p) => p.key === 'bio' || p.key === 'ack' || p.key === 'dedication' || p.key === 'abstract',
    )
    .flatMap((p) => bodyParas(ctx, p.heading + 1, p.end))
  return [
    present(ctx, caps),
    justified(ctx, 'prelims.justified', prose, 'the preliminary pages'),
    doubleSpaced(ctx, 'prelims.spacing', prose, 'the preliminary pages'),
    numbers(ctx),
  ]
}
