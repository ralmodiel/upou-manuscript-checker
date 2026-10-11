// References and appendices.
import type { Para } from '../model.ts'
import { fix, na, ok, review, worst, type Ctx, type Finding } from '../report.ts'
import { bolded, isHeadingish, nextText } from '../structure.ts'
import { list, norm, plural, quote } from '../text.ts'
import { DOUBLE } from './body.ts'
import { bodyNumbers } from './chapters.ts'
import { more, pagesText } from './numbering.ts'

const YEAR = /\((\d{4}[a-z]?|n\.\s?d\.|in press|forthcoming)(?!\w)/i
const SAMPLE = /author last name|first initial|year of publication|title of work/i

export interface Entry {
  paras: Para[]
  text: string
}

/** The reference entries, under any subheadings. A paragraph goes on with the entry above when it
 *  opens with a small letter or a number ("12(3), 45–67."; not "1. Author"), or, in a PDF,
 *  when it starts further in than the entries' first lines; else when it has no year either. */
export function entries(ctx: Ctx): { list: Entry[]; groups: number } {
  const r = ctx.s.references
  if (!r) return { list: [], groups: 0 }
  const paras = ctx.doc.paras.slice(r.heading + 1, r.end)
  // PDF: where entries' first lines start, set off by their hanging indent.
  const x0 = (p: Para) => (p.lines?.[0] ? Math.round(p.lines[0].x0) : undefined)
  const starts = new Map<number, number>()
  for (const p of paras)
    if ((p.indent?.firstLine ?? 0) <= -12 && x0(p) !== undefined)
      starts.set(x0(p)!, (starts.get(x0(p)!) ?? 0) + 1)
  const top = [...starts].sort((a, b) => b[1] - a[1])[0]
  const edge = top && top[1] >= 3 ? top[0] : undefined
  const out: Entry[] = []
  let groups = 0
  for (const p of paras) {
    const t = norm(p.text)
    if (!t) continue
    if (isHeadingish(p) && bolded(p) && t.length <= 80 && !YEAR.test(t)) {
      groups++
      continue
    }
    const at = x0(p)
    const placed =
      edge === undefined || at === undefined
        ? undefined
        : Math.abs(at - edge) <= 3
          ? true
          : at > edge + 12
            ? false
            : undefined
    const opens =
      !out.length ||
      (!/^(\p{Ll}|\d+(?!\d|[.)]\s))/u.test(t) &&
        (placed ?? (YEAR.test(t.slice(0, 200)) || /^\p{Lu}[\p{L}'’-]+,\s+\p{Lu}\./u.test(t))))
    if (opens) out.push({ paras: [p], text: t })
    else {
      out.at(-1)!.paras.push(p)
      out.at(-1)!.text += ' ' + t
    }
  }
  return { list: out, groups }
}

/** Sort key: the first author's surname (or group author), letter by letter. */
const key = (e: Entry) =>
  e.text
    .replace(/^\d+[.)]\s*/, '')
    .split(/[,(]/)[0]
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .trim()

function order(ctx: Ctx, refs: Entry[]): Finding {
  const id = 'references.order'
  if (!ctx.s.references) return fix(id, 'Add the reference list under the heading “References”.')
  if (refs.length < 2) return na(id, 'Fewer than two references found.')
  if (refs.some((e) => SAMPLE.test(e.text)))
    return review(
      id,
      'Replace the sample references from the template with your own, then arrange them alphabetically.',
    )
  const pairs: string[] = []
  const misplaced: Entry[] = []
  const tight = (s: string) => s.replace(/ /g, '')
  // Each entry against the last one with a sort key (one without must not hide a pair).
  let prev: Entry | undefined
  for (const e of refs) {
    const b = key(e)
    if (!b) continue
    const a = prev && key(prev)
    const [y0, y1] = [prev && byline(prev), byline(e)]
    const at = e.paras[0].page === undefined ? '' : `${pagesText([e.paras[0].page])}: `
    // Out of order word by word and letter by letter alike ("Sun Group", "SunCorp").
    if (a && b.localeCompare(a, 'en') < 0 && tight(b).localeCompare(tight(a), 'en') < 0) {
      pairs.push(`${at}“${quote(e.text, 45)}” should come before “${quote(prev!.text, 45)}”`)
      misplaced.push(e)
    } else if (y0 && y1 && y0.who === y1.who && y1.year < y0.year) {
      pairs.push(
        `${at}“${y1.cite}” should come before “${y0.cite}”: one author's works go from the earliest year`,
      )
      misplaced.push(e)
    }
    prev = e
  }
  if (!pairs.length) return ok(id, `All ${refs.length} references are in alphabetical order.`)
  return fix(
    id,
    'Arrange the reference list in alphabetical order (by the first author’s surname).',
    {
      details: pairs
        .slice(0, 6)
        .concat(pairs.length > 6 ? [more(pairs.length - 6, misplaced.slice(6).map(pageOf))] : []),
      where: [{ page: pageOf(misplaced[0]), quote: quote(misplaced[0].text, 40) }],
    },
  )
}

const pageOf = (e: Entry) => e.paras[0].page

/** The authors before the year (letters only) and the year, to order one author's works. */
function byline(e: Entry) {
  const m = YEAR.exec(e.text)
  if (!m || !/^\d/.test(m[1])) return undefined
  const by = e.text.slice(0, m.index).replace(/^\d+[.)]\s*/, '')
  const who = by
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
  // "Sun Group. (2024)" and "Sun Group (2025)" alike; an initial keeps its period.
  const cite = quote(by, 40)
    .replace(/[\s,]+$/, '')
    .replace(/(\p{L}{2})\.$/u, '$1')
  return who ? { who, year: m[1], cite: `${cite} (${m[1]})` } : undefined
}

function apa(ctx: Ctx, refs: Entry[], groups: number): Finding {
  const id = 'references.apa'
  if (!ctx.s.references)
    return fix(id, 'Add the reference list under the heading “References”, set up in APA style.')
  if (!refs.length) return fix(id, 'The References section is empty.')
  const issues: string[] = []
  const statuses: Finding['status'][] = []
  if (refs.some((e) => SAMPLE.test(e.text))) {
    issues.push('Replace the sample references from the template with your own.')
    statuses.push('fix')
  }
  const multi = refs
    .map((e) => e.paras[0])
    .filter((p) =>
      ctx.doc.kind === 'pdf' ? (p.lines?.length ?? 0) >= 2 : norm(p.text).length > 100,
    )
  const hanging = multi.filter((p) => (p.indent?.firstLine ?? 0) <= -18)
  if (ctx.doc.kind !== 'doc' && multi.length && hanging.length / multi.length < 0.8) {
    issues.push(
      `Use a hanging indent of 0.5 inch (Paragraph > Special: Hanging): ${multi.length - hanging.length} of ${plural(multi.length, 'reference')} ${multi.length - hanging.length === 1 ? 'has' : 'have'} none.`,
    )
    statuses.push('fix')
  }
  const spaced = refs.map((e) => e.paras[0]).filter((p) => p.spacing !== undefined)
  const single = spaced.filter((p) => p.spacing! < DOUBLE)
  if (spaced.length && single.length / spaced.length > 0.2) {
    issues.push(
      `Double-space the reference list: ${single.length} of ${plural(spaced.length, 'reference')} ${single.length === 1 ? 'is' : 'are'} not.`,
    )
    statuses.push('fix')
  }
  const numbered = refs.filter((e) => e.paras[0].list || /^\d+[.)]\s/.test(e.text))
  const listed = numbered.length > refs.length / 2
  if (listed) {
    issues.push('Do not number the references; APA lists them by author.')
    statuses.push('fix')
  }
  if (groups > 0) {
    issues.push('List all references in one alphabetical list, not grouped by type of source.')
    statuses.push('review')
  }
  // APA's hanging indent sets the lines after the first 0.5 inch in, not the first line (a numbered
  // list sets its numbers in: that is said above). The template's own examples are set in, under
  // their headings, so this is for a second look.
  const indented = multi.filter((p) => (p.indent?.left ?? 0) + (p.indent?.firstLine ?? 0) >= 18)
  if (ctx.doc.kind !== 'doc' && !listed && multi.length && indented.length / multi.length >= 0.8) {
    issues.push(
      'Start each reference at the left margin, as APA does: only its lines after the first go 0.5 inch in.',
    )
    statuses.push('review')
  }
  // The template's sample entries are said above: these look at the student's own.
  const own = refs.filter((e) => !SAMPLE.test(e.text))
  const noYear = own.filter((e) => !YEAR.test(e.text))
  if (noYear.length) {
    issues.push(
      `No year in parentheses after the author: ${list(noYear.slice(0, 3).map((e) => `“${quote(e.text, 40)}”`))}${noYear.length > 3 ? ` and ${noYear.length - 3} more` : ''}.`,
    )
    statuses.push('review')
  }
  // APA and the template centre the heading.
  const head = ctx.doc.paras[ctx.s.references.heading]
  if (!head.plain && head.align !== 'center') {
    issues.push('Centre the heading “References”, as APA style and the template do.')
    statuses.push('review')
  }
  // APA double-spaces within and between entries: an empty line between them is one too many.
  const loose = refs.slice(1).filter((e, k) => {
    const before = refs[k].paras.at(-1)!
    if (ctx.doc.kind !== 'pdf')
      return ctx.doc.paras.slice(before.i + 1, e.paras[0].i).some((p) => !norm(p.text) && !p.image)
    const a = before.lines?.at(-1)
    const b = e.paras[0].lines?.[0]
    const pitch = (refs[k].paras[0].spacing ?? 0) * 1.15 * (a?.size ?? 0)
    return !!a && !!b && a.page === b.page && pitch > 0 && b.y - a.y > 1.6 * pitch
  })
  if (loose.length && loose.length >= (refs.length - 1) / 2) {
    issues.push('Remove the empty lines between the references: APA double-spaces them all alike.')
    statuses.push('review')
  }
  // The same work listed twice: the same authors, year and title.
  const seen = new Map<string, Entry>()
  const twice: string[] = []
  for (const e of own) {
    const k = norm(e.text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '')
      .slice(0, 80)
    const first = seen.get(k)
    if (first)
      twice.push(
        `“${quote(e.text, 40)}”${pageOf(e) === undefined ? '' : ` (${pagesText([pageOf(first)!, pageOf(e)!])})`}`,
      )
    else seen.set(k, e)
  }
  if (twice.length) {
    issues.push(
      `Listed twice: ${list(twice.slice(0, 3))}${twice.length > 3 ? ` and ${twice.length - 3} more` : ''}.`,
    )
    statuses.push('review')
  }
  if (!issues.length)
    return review(
      id,
      ctx.doc.kind === 'doc'
        ? `${plural(refs.length, 'reference')}, each with its year. Check that they have hanging indents and double spacing (an old .doc file does not say).`
        : `${plural(refs.length, 'reference')} with hanging indents and double spacing, each with its year. Check the rest of the APA setup (each entry's parts, italics, DOIs) against the APA page linked here.`,
    )
  return {
    id,
    status: worst(statuses),
    message: 'Follow the APA style reference list setup (see the APA page linked here).',
    details: issues,
  }
}

function labels(ctx: Ctx): Finding {
  const id = 'appendices.labels'
  const { s, doc } = ctx
  const aps = s.appendices
  if (!aps.length)
    return s.appendicesHeading === undefined
      ? na(id, 'No appendices found.')
      : fix(id, 'Label each appendix (Appendix A, Appendix B…) with its title on the next line.', {
          where: [{ quote: quote(doc.paras[s.appendicesHeading].text) }],
        })
  const issues: string[] = []
  const statuses: Finding['status'][] = []
  const marks = aps.map((a) => a.mark ?? '')
  if (aps.length > 1 && marks.some((m) => !m)) {
    issues.push('Give each appendix its letter (Appendix A, Appendix B…).')
    statuses.push('fix')
  }
  if (marks.some((m) => /^\d+$/.test(m))) {
    issues.push('Label appendices with capital letters (Appendix A, B, C), as APA style does.')
    statuses.push('review')
  }
  const letters = marks.filter((m) => /^[a-z]$/i.test(m)).map((m) => m.toUpperCase().charCodeAt(0))
  if (letters.some((c, k) => k > 0 && c !== letters[k - 1] + 1)) {
    issues.push(`The appendix letters skip or repeat (${marks.join(', ')}).`)
    statuses.push('fix')
  }
  const untitled: Para[] = []
  for (const a of aps) {
    const head = doc.paras[a.heading]
    const inline = norm(head.text).replace(
      /^(appendix|annex)\s*([a-z]{1,2}|\d{1,2})?\b[\s.:–—-]*/i,
      '',
    )
    const next = nextText(doc.paras, a.heading + 1, a.end)
    const short = next !== undefined && norm(doc.paras[next].text).length <= 150
    if (inline || (short && isHeadingish(doc.paras[next!]))) continue
    // A short line under the label, not set as a title: its title, most likely, for a second look.
    issues.push(
      short
        ? `Check the title below “${a.label}”: set it as a title on the line below the label, as in the template.`
        : `Add a title below “${a.label}”.`,
    )
    statuses.push(short ? 'review' : 'fix')
    untitled.push(head)
  }
  if (!issues.length)
    return ok(
      id,
      `${plural(aps.length, 'appendix', 'appendices')} labelled ${list(aps.map((a) => a.label))}, each with a title.`,
    )
  return {
    id,
    status: worst(statuses),
    message: issues[0],
    details: issues.length > 1 ? issues.slice(1) : undefined,
    where: (untitled.length ? untitled : [doc.paras[aps[0].heading]])
      .slice(0, 5)
      .map((p) => ({ page: p.page, quote: quote(p.text, 40) })),
  }
}

export function backRules(ctx: Ctx): Finding[] {
  const { s, doc } = ctx
  const { list: refs, groups } = entries(ctx)
  const apStart = s.appendicesHeading ?? s.appendices[0]?.start
  return [
    order(ctx, refs),
    apa(ctx, refs, groups),
    s.references
      ? bodyNumbers(
          ctx,
          'references.pageNumbers',
          s.references.start,
          apStart ?? doc.paras.length,
          'reference pages',
        )
      : fix(
          'references.pageNumbers',
          'Add the References section, with page numbers continuing from the chapters.',
        ),
    labels(ctx),
    apStart === undefined
      ? na('appendices.pageNumbers', 'No appendices found.')
      : bodyNumbers(ctx, 'appendices.pageNumbers', apStart, doc.paras.length, 'appendix pages'),
  ]
}
