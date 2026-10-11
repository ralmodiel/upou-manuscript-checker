// References and appendices.
import type { Para } from '../model.ts'
import { fix, na, ok, review, worst, type Ctx, type Finding } from '../report.ts'
import { bolded, isHeadingish, nextText } from '../structure.ts'
import { list, norm, plural, quote } from '../text.ts'
import { DOUBLE } from './body.ts'
import { bodyNumbers } from './chapters.ts'

const YEAR = /\((\d{4}[a-z]?|n\.\s?d\.|in press|forthcoming)\b/i
const SAMPLE = /author last name|first initial|year of publication|title of work/i

export interface Entry {
  paras: Para[]
  text: string
}

/** The reference entries, under any subheadings; a paragraph without a year continues the one before. */
export function entries(ctx: Ctx): { list: Entry[]; groups: number } {
  const r = ctx.s.references
  if (!r) return { list: [], groups: 0 }
  const out: Entry[] = []
  let groups = 0
  for (const p of ctx.doc.paras.slice(r.heading + 1, r.end)) {
    const t = norm(p.text)
    if (!t) continue
    if (isHeadingish(p) && bolded(p) && t.length <= 80 && !YEAR.test(t)) {
      groups++
      continue
    }
    const starts =
      YEAR.test(t.slice(0, 200)) || !out.length || /^\p{Lu}[\p{L}'’-]+,\s+\p{Lu}\./u.test(t)
    if (starts && !/^\p{Ll}/u.test(t)) out.push({ paras: [p], text: t })
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
  for (let k = 1; k < refs.length; k++) {
    const a = key(refs[k - 1])
    const b = key(refs[k])
    if (a && b && b.localeCompare(a, 'en') < 0)
      pairs.push(`“${quote(refs[k].text, 45)}” should come before “${quote(refs[k - 1].text, 45)}”`)
  }
  if (!pairs.length) return ok(id, `All ${refs.length} references are in alphabetical order.`)
  return fix(
    id,
    'Arrange the reference list in alphabetical order (by the first author’s surname).',
    {
      details: pairs.slice(0, 6).concat(pairs.length > 6 ? [`…and ${pairs.length - 6} more`] : []),
      where: [{ page: refs[0].paras[0].page, quote: quote(refs[0].text, 40) }],
    },
  )
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
  if (numbered.length > refs.length / 2) {
    issues.push('Do not number the references; APA lists them by author.')
    statuses.push('fix')
  }
  if (groups > 0) {
    issues.push('List all references in one alphabetical list, not grouped by type of source.')
    statuses.push('review')
  }
  const noYear = refs.filter((e) => !YEAR.test(e.text))
  if (noYear.length) {
    issues.push(
      `No year in parentheses after the author: ${list(noYear.slice(0, 3).map((e) => `“${quote(e.text, 40)}”`))}${noYear.length > 3 ? ` and ${noYear.length - 3} more` : ''}.`,
    )
    statuses.push('review')
  }
  if (!issues.length)
    return ctx.doc.kind === 'doc'
      ? review(
          id,
          `${plural(refs.length, 'reference')}, each with its year. Check that they have hanging indents and double spacing (an old .doc file does not say).`,
        )
      : ok(
          id,
          `${plural(refs.length, 'reference')} with hanging indents and double spacing, each with its year.`,
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
  for (const a of aps) {
    const inline = norm(doc.paras[a.heading].text).replace(
      /^(appendix|annex)\s*([a-z]{1,2}|\d{1,2})?\b[\s.:–—-]*/i,
      '',
    )
    const next = nextText(doc.paras, a.heading + 1, a.end)
    const titled =
      !!inline ||
      (next !== undefined &&
        norm(doc.paras[next].text).length <= 150 &&
        isHeadingish(doc.paras[next]))
    if (!titled) {
      issues.push(`Add a title below “${a.label}”.`)
      statuses.push('fix')
    }
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
