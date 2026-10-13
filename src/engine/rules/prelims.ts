// Other preliminary pages: all there, justified, double-spaced, numbered in Roman numerals.
import type { Para } from '../model.ts'
import { fix, na, ok, review, worst, type Ctx, type Finding } from '../report.ts'
import {
  bolded,
  headingText,
  isHeadingish,
  isTocLine,
  LIST_HEADING_EXACT,
  PRELIM_NAMES,
  titlePage,
  type Prelim,
  type PrelimKey,
} from '../structure.ts'
import { list, norm, quote, roman } from '../text.ts'
import { bodyParas, doubleSpaced, justified } from './body.ts'
import { readTitlePage, thesisTitle } from './front.ts'
import type { Caption } from './figures.ts'
import {
  auditPdf,
  lookNote,
  lookOnly,
  unreadNote,
  judge,
  pagesText,
  summarize,
  wordSectionFolios,
  type Problem,
} from './numbering.ts'

const ORDER: PrelimKey[] = ['bio', 'ack', 'dedication', 'toc', 'tables', 'figures', 'abstract']

/** A keywords line ("Keywords: …", "(Keywords: …)"), also where a PDF ran it into the paragraph
 *  above: one of the paragraph's lines opens with it, capitalised and with its colon (a sentence
 *  wrapped before "keywords." is no such line). */
const KEYWORDS = /^\(?key\s?words?\s*[:.–—-]/i
const KEYWORDS_LINE = /^\(?(Key\s?words?|KEY\s?WORDS?)\s*:/
const hasKeywords = (p: Para) =>
  KEYWORDS.test(norm(p.text)) || !!p.lines?.some((l) => KEYWORDS_LINE.test(norm(l.text)))

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
  const inPrelims = (p: Para) =>
    p.i >= (s.acceptance?.end ?? s.title.end) &&
    p.i < (s.chapters[0]?.start ?? s.references?.start ?? doc.paras.length)
  // (or a page of a few words under no heading at all, set among the preliminary pages)
  const shortPage = (p: Para) => {
    if (doc.kind !== 'pdf' || !p.newPage || p.page === undefined) return false
    const onPage = doc.paras.filter((q) => q.page === p.page)
    return (
      !s.prelims.some((x) => onPage.some((q) => q.i === x.heading)) &&
      onPage.reduce((n, q) => n + norm(q.text).split(' ').length, 0) <= 40 &&
      !onPage.some((q) => isTocLine(q.text) || q.inTable) &&
      s.prelims.some((x) => x.heading > p.i)
    )
  }
  const dedicated = found.includes('dedication')
    ? undefined
    : doc.paras.find(
        (p) =>
          inPrelims(p) &&
          p.newPage &&
          (/^dedicated\s+to\b/i.test(norm(p.text)) || shortPage(p)) &&
          !(s.acceptance && p.i <= s.acceptance.heading),
      )
  // A page the contents list but whose heading was not found (set under no heading, or in a
  // picture): for the student to look at, not a page left out.
  const tocText = s.prelims
    .filter((x) => x.key === 'toc')
    .flatMap((x) => doc.paras.slice(x.heading + 1, x.end))
    .map((q) => norm(q.text))
    .join(' ')
  const IN_TOC: Partial<Record<PrelimKey, RegExp>> = {
    bio: /biograph|bio-?sketch|about the (author|researcher)/i,
    ack: /acknowledg/i,
    dedication: /dedication/i,
  }
  const notAbsent = required.filter((k) => !found.includes(k) && !(k === 'dedication' && dedicated))
  const listed = notAbsent.filter((k) => IN_TOC[k]?.test(tocText))
  const absent = notAbsent.filter((k) => !listed.includes(k))
  // The MDC template has a biographical sketch and a dedication; UPOU's style guide (2022)
  // calls the sketch recommended and says nothing of a dedication, so for other programs they
  // are for the student to look at. (A declaration page takes the place of neither.)
  const mdc = /development communication/i.test(norm(readTitlePage(ctx).program?.text ?? ''))
  const optional: PrelimKey[] = mdc ? [] : absent.filter((k) => k === 'bio' || k === 'dedication')
  const missing = absent.filter((k) => !optional.includes(k))
  // What a page that cannot be read (a picture, a heading in a font that was re-encoded, a
  // "Summary" for an abstract) may be hiding: said as a check, not a correction.
  const first =
    (doc.paras[s.acceptance?.heading ?? s.permission?.heading ?? s.title.start]?.page ?? -1) + 1
  const last = s.chapters[0] ? doc.paras[s.chapters[0].heading].page : undefined
  const unread: string[] = []
  if (doc.kind === 'pdf' && first > 0 && last !== undefined) {
    const pics = (doc.pages ?? []).filter(
      (pg) => pg.n >= first && pg.n < last && !pg.paras.length && pg.images.length,
    )
    if (pics.length)
      unread.push(
        `${pagesText(pics.map((pg) => pg.n))} ${pics.length > 1 ? 'are pictures' : 'is a picture'} with no text`,
      )
    const odd = doc.paras.filter(
      (p) =>
        p.page !== undefined &&
        p.page >= first &&
        p.page < last &&
        p.newPage &&
        norm(p.text).length <= 30 &&
        isHeadingish(p) &&
        /\p{L}[%$&#@*+!<>=]|[%$&#@*+!<>=]\p{L}/u.test(p.text),
    )
    if (odd.length)
      unread.push(
        `the heading on ${pagesText(odd.map((p) => p.page!))} is in a font that cannot be read`,
      )
  }
  // (an abstract headed by the study's title, not "Abstract": its page has the keywords line)
  // (not where a page or heading could not be read: the heading may be there)
  const keyLine =
    missing.includes('abstract') && !unread.length
      ? doc.paras.find(
          (p) =>
            p.page !== undefined &&
            p.page >= first &&
            (last === undefined || p.page < last) &&
            hasKeywords(p),
        )
      : undefined
  if (keyLine) {
    missing.splice(missing.indexOf('abstract'), 1)
    // Headed by another name ("Summary"): to rename. Headed by the study's title, as some
    // abstracts are: the abstract is there, so its heading is for the student to look at.
    // (the heading that opens the abstract's first page, which may be the page before)
    const head = doc.paras
      .slice(0, keyLine.i)
      .findLast((p) => p.newPage && isHeadingish(p) && norm(p.text))
    const renamed =
      !!head && /^(summary|executive summary|synopsis|overview)$/i.test(headingText(head))
    issues.push(
      renamed
        ? `Head the abstract “Abstract”, as in the template: ${pagesText([keyLine.page!])} has its “Keywords” line, under the heading “${headingText(head!)}”.`
        : `Check the abstract’s heading: ${pagesText([keyLine.page!])} has its “Keywords” line, under no “Abstract” heading. The template heads it “Abstract”.`,
    )
    statuses.push(renamed ? 'fix' : 'review')
  }
  // (a training report's summary stands for its abstract)
  if (
    missing.includes('abstract') &&
    /on-the-job|\bojt\b|internship|practicum/i.test(thesisTitle(ctx)) &&
    doc.paras.some((p) => isHeadingish(p) && /^(summary|executive summary)$/i.test(headingText(p)))
  )
    unread.push('a “Summary” stands where the abstract goes')
  if (missing.length && unread.length) {
    issues.push(
      `Check for the preliminary pages not found (${list(missing.map((k) => PRELIM_NAMES[k]))}): ${list(unread)}, so they may be there.`,
    )
    statuses.push('review')
  } else if (missing.length) {
    issues.push(
      `Include the missing preliminary pages: ${list(missing.map((k) => PRELIM_NAMES[k]))}.`,
    )
    statuses.push('fix')
  }
  if (optional.length) {
    issues.push(
      `Check whether your program asks for the ${list(optional.map((k) => PRELIM_NAMES[k]))}: the MDC template has ${optional.length > 1 ? 'them' : 'it'}, and UPOU’s style guide (2022) recommends a biographical sketch.`,
    )
    statuses.push('review')
  }
  if (listed.length) {
    issues.push(
      `The table of contents lists the ${list(listed.map((k) => PRELIM_NAMES[k]))}, but no heading for ${listed.length > 1 ? 'them' : 'it'} was found: check that the page has its heading, as in the template.`,
    )
    statuses.push('review')
  }
  if (dedicated) {
    issues.push(
      /^dedicated\s+to\b/i.test(norm(dedicated.text))
        ? `The Dedication page opens “${quote(dedicated.text, 30)}” with no “Dedication” heading: check that it is set as in the template.`
        : `${pagesText([dedicated.page!])} opens “${quote(dedicated.text, 30)}” under no heading: if it is the Dedication, give it the heading “Dedication”, as in the template.`,
    )
    statuses.push('review')
  }
  // A list under a heading worded otherwise ("LISTS OF FIGURES", "List of Table"): found, but the
  // template's words are "List of Tables" and "List of Figures".
  for (const x of s.prelims) {
    const t = headingText(doc.paras[x.heading])
    if ((x.key === 'tables' || x.key === 'figures') && !LIST_HEADING_EXACT.test(t)) {
      issues.push(
        `The heading “${quote(t, 30)}” is not worded as the template’s “${PRELIM_NAMES[x.key]}”.`,
      )
      statuses.push('review')
    }
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
  if (abstract && !doc.paras.slice(abstract.start, abstract.end).some(hasKeywords)) {
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
    if (lookOnly(problems))
      return review(id, lookNote(problems), {
        details: summarize(problems),
        where: [{ page: problems[0].page }],
      })
    if (problems.every((p) => p.type === 'unread' || p.type === 'overlap'))
      return review(id, unreadNote(problems), { where: [{ page: problems[0].page }] })
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

/** PDF: pages of the abstract, acknowledgment or sketch whose text is set centred. At least four
 *  long lines, and most of the page's, stand off both margins with their middle on the text's
 *  middle, and they share no left edge: a ragged left edge, which neither justified nor
 *  left-aligned text has (nor text justified to narrower margins). (A PDF may cut such text into
 *  one-line pieces, which the paragraph check passes over.) */
function centredLines(ctx: Ctx): Para[] {
  const { doc, s } = ctx
  if (doc.kind !== 'pdf') return []
  const lines = s.prelims
    .filter((x) => x.key === 'bio' || x.key === 'ack' || x.key === 'abstract')
    .flatMap((x) => doc.paras.slice(x.heading + 1, sectionEnd(ctx, x)))
    .flatMap((p) => (p.inTable ? [] : (p.lines ?? []).map((l) => ({ p, l }))))
  const out: Para[] = []
  for (const pg of new Set(lines.map(({ l }) => l.page))) {
    const m = doc.pages?.[pg]?.margins
    if (!m) continue
    const on = lines.filter(({ l }) => l.page === pg)
    const off = on.filter(
      ({ l }) =>
        l.x0 > m.left + 6 &&
        l.x1 < m.right - 6 &&
        l.x1 - l.x0 > 0.5 * (m.right - m.left) &&
        Math.abs((l.x0 + l.x1) / 2 - (m.left + m.right) / 2) <= 3,
    )
    const edge = Math.max(
      ...off.map(({ l }) => off.filter((o) => Math.abs(o.l.x0 - l.x0) <= 1.5).length),
    )
    if (off.length >= 4 && off.length >= 0.6 * on.length && edge <= off.length / 3)
      out.push(...new Set(off.map((o) => o.p)))
  }
  return out
}

function prelimJustified(ctx: Ctx, prose: Para[]): Finding {
  const id = 'prelims.justified'
  const found = justified(ctx, id, prose, 'the preliminary pages')
  const mid = found.status === 'fix' ? [] : centredLines(ctx)
  if (!mid.length) return found
  return fix(id, 'Justify the body text of the preliminary pages (Home > Justify, or Ctrl+J).', {
    details: [`The text on ${pagesText(mid.map((p) => p.page!))} is centred.`],
    where: mid.slice(0, 5).map((p) => ({ page: p.page, quote: quote(p.text, 50) })),
  })
}

/** Where a preliminary page's text ends. With no chapter found, the last one would run on into the
 *  body: it ends at the next page opened by a heading (bold or centred, short). */
function sectionEnd(ctx: Ctx, x: Prelim): number {
  const { doc, s } = ctx
  if (s.chapters.length) return x.end
  const next = doc.paras
    .slice(x.heading + 1, x.end)
    .find((p) => p.newPage && (bolded(p) || p.align === 'center') && norm(p.text).length <= 80)
  return next?.i ?? x.end
}

export function prelimRules(ctx: Ctx, caps: Caption[]): Finding[] {
  const prose = ctx.s.prelims
    .filter(
      (p) => p.key === 'bio' || p.key === 'ack' || p.key === 'dedication' || p.key === 'abstract',
    )
    .flatMap((p) => bodyParas(ctx, p.heading + 1, sectionEnd(ctx, p)))
  return [
    present(ctx, caps),
    prelimJustified(ctx, prose),
    doubleSpaced(ctx, 'prelims.spacing', prose, 'the preliminary pages'),
    numbers(ctx),
  ]
}
