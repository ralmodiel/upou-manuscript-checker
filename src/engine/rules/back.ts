// References and appendices.
import type { Para } from '../model.ts'
import { fix, na, ok, review, worst, type Ctx, type Finding } from '../report.ts'
import { bolded, isHeadingish, nextText } from '../structure.ts'
import { list, norm, plural, quote } from '../text.ts'
import { DOUBLE } from './body.ts'
import { bodyNumbers, pushedDown } from './chapters.ts'
import { more, pagesText } from './numbering.ts'

const YEAR = /\((\d{4}[a-z]?|n\.\s?d\.|in press|forthcoming)(?!\w)/i
const SAMPLE = /author last name|first initial|year of publication|title of work/i
/** A surname with a small particle, then an initial: "van Daal, R.", "de la Cruz, J.". */
const PARTICLE =
  /^(?:(?:van|von|der|den|de|del|della|di|da|du|le|la|ter|ten|dos|das)\s+)+\p{Lu}[\p{L}'’-]+,\s+\p{Lu}\./u

export interface Entry {
  paras: Para[]
  text: string
}

/** The reference entries, under any subheadings. A paragraph goes on with the entry above when it
 *  opens with a small letter (not a surname's particle: "van Daal, R.") or a number ("12(3),
 *  45–67."; not "1. Author"), or, in a PDF, when it starts further in than the entries' first
 *  lines; else when it has no year either. */
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
      (placed !== false && PARTICLE.test(t)) ||
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
  // The entries with a sort key (one without must not hide a pair), less a work listed again, as
  // it is or with its title's end changed: that one is to be removed (references.apa says so), not
  // moved.
  const works = new Map<string, string[]>()
  const keyed = refs.filter((e) => {
    if (!key(e)) return false
    const y = byline(e)
    if (!y) return true
    const titles = works.get(`${y.who}|${y.year}`) ?? []
    if (titles.some((t) => t === y.title || (!y.marked && alike(t, y.title)))) return false
    works.set(`${y.who}|${y.year}`, [...titles, y.title])
    return true
  })
  const ks = keyed.map(key)
  const tight = ks.map((k) => k.replace(/ /g, ''))
  // Entry i sorts before entry j, word by word and letter by letter alike ("Sun Group", "SunCorp").
  const sooner = (i: number, j: number) =>
    ks[i].localeCompare(ks[j], 'en') < 0 && tight[i].localeCompare(tight[j], 'en') < 0
  // The longest run of entries already in order (the earliest such): an entry outside it has to
  // move, one inside it stays (in "A, M, C, D" only M moves, though C and D sort before it).
  const len = ks.map(() => 1)
  for (let i = ks.length - 2; i >= 0; i--)
    for (let j = i + 1; j < ks.length; j++)
      if (!sooner(j, i) && len[j] + 1 > len[i]) len[i] = len[j] + 1
  const kept = new Set<number>()
  let need = Math.max(0, ...len)
  let last = -1
  for (let i = 0; i < ks.length && need > 0; i++)
    if (len[i] === need && (last < 0 || !sooner(i, last))) {
      kept.add(i)
      last = i
      need--
    }
  // In order with the entry above, but before an earlier one: [entry, the earliest-sorting earlier
  // entry it belongs before, where its line goes among the pairs].
  const behind: [Entry, Entry, number][] = []
  // Where the list starts the alphabet over.
  const restarts: (number | undefined)[] = []
  for (const [k, e] of keyed.entries()) {
    const prev = keyed[k - 1] as Entry | undefined
    const [y0, y1] = [prev && byline(prev), byline(e)]
    const at = e.paras[0].page === undefined ? '' : `${pagesText([e.paras[0].page])}: `
    // The earlier entries it sorts before, for an entry that has to move.
    const above =
      kept.has(k) || (y0 && y1 && y0.who === y1.who)
        ? []
        : ks.slice(0, k).flatMap((_, j) => (sooner(k, j) ? [j] : []))
    if (prev && sooner(k, k - 1)) {
      pairs.push(`${at}“${quote(e.text, 45)}” should come before “${quote(prev.text, 45)}”`)
      misplaced.push(e)
      restarts.push(e.paras[0].page)
    } else if (above.length)
      behind.push([
        e,
        keyed[above.reduce((m, j) => (ks[j].localeCompare(ks[m], 'en') < 0 ? j : m))],
        pairs.length,
      ])
    else if (y0 && y1 && y0.who === y1.who && y1.year < y0.year) {
      pairs.push(
        `${at}“${y1.cite}” should come before “${y0.cite}”: one author's works go from the earliest year`,
      )
      misplaced.push(e)
    } else if (
      y0 &&
      y1 &&
      y0.who === y1.who &&
      y1.year === y0.year &&
      !y0.dated &&
      !y1.dated &&
      y1.title < y0.title
    ) {
      pairs.push(
        `${at}${y1.by}: “${y1.from}” should come before “${y0.from}”: one author's works of the same year go by title, with a, b after the year`,
      )
      misplaced.push(e)
    } else if (
      y0 &&
      y1 &&
      ks[k - 1] === ks[k] &&
      y0.who !== y1.who &&
      namesBefore(y1.names, y0.names)
    ) {
      pairs.push(
        `${at}“${quote(e.text, 45)}” should come before “${quote(prev!.text, 45)}”: works with the same first author go by the next author's surname`,
      )
      misplaced.push(e)
    }
  }
  // A few: each one is out of place. Many: the list goes through the alphabet more than once.
  const lead: string[] = []
  if (behind.length && behind.length <= Math.max(3, refs.length / 10))
    for (const [e, d, k] of behind.reverse()) {
      const at = e.paras[0].page === undefined ? '' : `${pagesText([e.paras[0].page])}: `
      pairs.splice(k, 0, `${at}“${quote(e.text, 45)}” should come before “${quote(d.text, 45)}”`)
      misplaced.splice(k, 0, e)
    }
  else if (behind.length) {
    const pages = restarts.filter((p) => p !== undefined)
    lead.push(
      `The list goes through the alphabet ${restarts.length + 1} times${pages.length ? ` (it starts over on ${pagesText(pages)})` : ''}: put all the entries in one alphabetical list.`,
    )
  }
  if (!pairs.length && !lead.length)
    return ok(id, `All ${refs.length} references are in alphabetical order.`)
  const first = misplaced[0] ?? behind[0][0]
  return fix(
    id,
    'Arrange the reference list in alphabetical order (by the first author’s surname).',
    {
      details: lead
        .concat(pairs.slice(0, 6))
        .concat(pairs.length > 6 ? [more(pairs.length - 6, misplaced.slice(6).map(pageOf))] : []),
      where: [{ page: pageOf(first), quote: quote(first.text, 40) }],
    },
  )
}

/** APA: one first author's works go by the second author's surname, then the third…; one author
 *  alone comes first ("nothing precedes something"). */
function namesBefore(x: string[], y: string[]): boolean {
  if (x.length < 2 && y.length < 2) return false
  for (let k = 0; k < Math.min(x.length, y.length); k++)
    if (x[k] !== y[k]) return x[k].localeCompare(y[k], 'en') < 0
  return x.length < y.length
}

const pageOf = (e: Entry) => e.paras[0].page

/** Two titles alike but for their ends ("…study of religions", "…study of devotion"): one work. */
function alike(a: string, b: string) {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n >= 20 && n >= 0.75 * Math.min(a.length, b.length)
}

/** The authors before the year (letters only), the year and the title, to order one author's works
 *  and to find a work listed twice. APA puts undated works first and works in press last. */
function byline(e: Entry) {
  const m = YEAR.exec(e.text)
  if (!m) return undefined
  const by = e.text.slice(0, m.index).replace(/^\d+[.)]\s*/, '')
  const who = by
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
  // "Sun Group. (2024)" and "Sun Group (2025)" alike; an initial keeps its period.
  const cite = quote(by, 40)
    .replace(/[\s,]+$/, '')
    .replace(/(\p{L}{2})\.$/u, '$1')
  const rest = e.text.slice(m.index)
  // The title, up to its closing period, without a leading article.
  const title = e.text
    .slice(m.index + m[0].length)
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .split(/\.\s/)[0]
    .normalize('NFD')
    .toLowerCase()
    .replace(/^(a|an|the)\s+/, '')
    .replace(/[^a-z0-9]/g, '')
  return who
    ? {
        who,
        year: /^\d/.test(m[1]) ? m[1] : /^n/i.test(m[1]) ? '0' : '9',
        title,
        // Told apart by a letter already: 2011a, n.d.-a, in press-a.
        marked: /^\((\d{4}[a-z]|(n\.\s?d\.|in press)\s?-\s?[a-z])/i.test(rest),
        // A full date ("2011, March 3"): works of one year then go by date, not by title.
        dated: /^\(\d{4}[a-z]?,/.test(rest),
        // The authors' surnames in order ("Reyes, A., Cruz, B. L., & Santos, C. D."), letters only.
        names: [
          ...by.matchAll(/(\p{Lu}[\p{L}'’-]*(?:\s\p{L}[\p{L}'’-]*)*),\s+(?:\p{Lu}\.[\s-]*)+/gu),
        ].map((n) =>
          n[1]
            .normalize('NFD')
            .toLowerCase()
            .replace(/[^a-z]/g, ''),
        ),
        by: cite,
        from: quote(rest, 40),
        cite: `${cite} (${m[1]})`,
      }
    : undefined
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
    // Set in less than a quarter inch is a hanging indent too small, not none.
    const small = multi.filter(
      (p) => (p.indent?.firstLine ?? 0) <= -6 && (p.indent?.firstLine ?? 0) > -18,
    )
    const none = multi.length - hanging.length - small.length
    const sets = small.map((p) => -p.indent!.firstLine).sort((a, b) => a - b)
    const inch = ((sets[sets.length >> 1] ?? 0) / 72).toFixed(1)
    issues.push(
      `Use a hanging indent of 0.5 inch (Paragraph > Special: Hanging): ${list(
        [
          none
            ? `${none} of ${plural(multi.length, 'reference')} ${none === 1 ? 'has' : 'have'} none`
            : '',
          small.length
            ? `${small.length}${none ? '' : ` of ${plural(multi.length, 'reference')}`} hang${small.length === 1 ? 's' : ''} only ${inch} inch`
            : '',
        ].filter(Boolean),
      )}.`,
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
  // A year mistyped in the parentheses ("(20214") or written outside them is certain; no year at
  // all may be an entry read in two pieces.
  const misdated = noYear.filter((e) => {
    const t = e.text.replace(/\S*(https?:\/\/|www\.|doi\.org|doi:)\S*/gi, '')
    return /\(\d{5,}/.test(t) || /(?<![\d/(.-])(1[89]|20)\d{2}[a-z]?(?![\d/-])/.test(t)
  })
  const undated = noYear.filter((e) => !misdated.includes(e))
  // "(20214, July 10)" has its parentheses: only its year is wrong.
  const mistyped = misdated.filter((e) => /\(\d{5,}/.test(e.text))
  const outside = misdated.filter((e) => !mistyped.includes(e))
  if (mistyped.length) {
    issues.push(`Correct the year, mistyped: ${entriesText(mistyped)}.`)
    statuses.push('fix')
  }
  if (outside.length) {
    issues.push(
      `Write the year in parentheses after the author, as “(2020).”: ${entriesText(outside)}.`,
    )
    statuses.push('fix')
  }
  if (undated.length) {
    issues.push(`No year after the author: ${entriesText(undated)}.`)
    statuses.push('review')
  }
  // APA and the template centre the heading. A Word file states its alignment; in a PDF a heading
  // that starts at the margin is plainly not centred.
  const head = ctx.doc.paras[ctx.s.references.heading]
  if (!head.plain && head.align !== 'center') {
    const left = ctx.doc.pages?.[head.page ?? -1]?.margins?.left
    const x0 = head.lines?.[0]?.x0
    const sure =
      ctx.doc.kind !== 'pdf'
        ? !/^\s/.test(head.text) // not set in with spaces or tabs
        : left !== undefined && x0 !== undefined && x0 - left < 3
    issues.push('Centre the heading “References”, as APA style and the template do.')
    statuses.push(sure ? 'fix' : 'review')
  }
  // APA and the template call the list "References" (a bibliography lists other reading too).
  if (!/^references$/i.test(norm(head.text).replace(/[:.]$/, ''))) {
    issues.push(
      `Title the list “References”, as APA style and the template do (not “${quote(head.text, 30)}”).`,
    )
    statuses.push('fix')
  }
  if (pushedDown(ctx, head)) {
    issues.push(
      `Start the reference list at the top of its page: empty lines push the heading down (${pagesText([head.page!])}).`,
    )
    statuses.push('fix')
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
  } else if (ctx.doc.kind === 'pdf') {
    // Less than an empty line, more than the line spacing: space set before or after each entry.
    const roomy = refs.slice(1).filter((e, k) => {
      const a = refs[k].paras.at(-1)!.lines?.at(-1)
      const b = e.paras[0].lines?.[0]
      const pitch = (refs[k].paras[0].spacing ?? 0) * 1.15 * (a?.size ?? 0)
      const gap = !!a && !!b && a.page === b.page && pitch > 0 ? (b.y - a.y) / pitch : 0
      return gap > 1.3 && gap <= 1.6
    })
    if (roomy.length && roomy.length >= (refs.length - 1) / 2) {
      issues.push(
        'Remove the extra space between the references (Paragraph > Spacing Before and After: 0 pt): APA double-spaces them all alike.',
      )
      statuses.push('review')
    }
  }
  // The same work listed twice (the same authors, year and title) is a sure correction; two works
  // of one author and year need a, b after the year (2011a, 2011b).
  const seen = new Map<string, Entry>()
  const years = new Map<string, Entry>()
  const twice: [Entry, Entry][] = []
  // [the first work of that author and year, another one without a letter]
  const lettered: [Entry, Entry][] = []
  // Titles alike but for their ends ("…study of religions", "…study of devotion"): one work.
  const nearly: [Entry, Entry][] = []
  // Each author's works of each year, to find a letter (2016b) where that year has one work only.
  const works = new Map<string, Entry[]>()
  for (const e of own) {
    const y = byline(e)
    if (!y) continue
    const k = `${y.who}|${y.year.slice(0, 4)}`
    works.set(k, [...(works.get(k) ?? []), e])
  }
  const lone = [...works.values()].flatMap((es) =>
    es.length === 1 && byline(es[0])!.marked ? es : [],
  )
  for (const e of own) {
    const y = byline(e)
    const k = y
      ? `${y.who}|${y.year}|${y.title}`
      : norm(e.text)
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]/gu, '')
          .slice(0, 80)
    const first = seen.get(k)
    if (first) twice.push([first, e])
    else seen.set(k, e)
    if (!y || first) continue
    const other = years.get(`${y.who}|${y.year}`)
    if (other && !y.marked && alike(byline(other)!.title, y.title)) nearly.push([other, e])
    else if (other && !y.marked) lettered.push([other, e])
    else years.set(`${y.who}|${y.year}`, e)
  }
  if (twice.length) {
    issues.push(
      `Listed twice: ${entriesText(
        twice.map(([, b]) => b),
        undefined,
        twice.map(([a]) => a),
      )}.`,
    )
    statuses.push('fix')
  }
  if (nearly.length) {
    issues.push(
      `Listed twice, it seems, with different details: ${entriesText(
        nearly.map(([, b]) => b),
        (e) => `“${byline(e)!.cite}”`,
        nearly.map(([a]) => a),
      )}. Keep one, or, for two works, add a, b after the year.`,
    )
    statuses.push('review')
  }
  if (lettered.length) {
    // The example in the entries' own year: (2021a, 2021b) or (n.d.-a, n.d.-b). Each author's works
    // apart: they are not one pair.
    const yr = /\(([^()]*)\)$/.exec(byline(lettered[0][1])!.cite)?.[1] ?? '2011'
    const ex = /^\d/.test(yr) ? `${yr}a, ${yr}b` : `${yr}-a, ${yr}-b`
    issues.push(
      `Two works of one author and year: add a, b after the year (${ex}), in the order of their titles; found for: ${entriesText(
        lettered.map(([, b]) => b),
        (e) => `“${byline(e)!.cite}”`,
        lettered.map(([a]) => a),
        (xs) => xs.join('; '),
      )}.`,
    )
    statuses.push('review')
  }
  if (lone.length) {
    issues.push(
      `A letter after the year, but no other work of that author and year is listed: ${entriesText(lone, (e) => `“${byline(e)!.cite}”`)}. Remove the letter, or add the missing work.`,
    )
    statuses.push('review')
  }
  // APA cites personal communications in the text only.
  const personal = own.filter((e) => /\bpersonal communication\b/i.test(e.text))
  if (personal.length) {
    issues.push(
      `Leave personal communications out of the reference list (APA cites them in the text only): ${entriesText(personal)}.`,
    )
    statuses.push('review')
  }
  if (!issues.length)
    return review(
      id,
      ctx.doc.kind === 'doc'
        ? `Check that the ${plural(refs.length, 'reference')} have hanging indents and double spacing (an old .doc file does not say); each has its year.`
        : `Check the rest of the APA setup (each entry's parts, italics, DOIs) against the APA page linked here: the ${plural(refs.length, 'reference')} have hanging indents, double spacing and a year each.`,
    )
  const status = worst(statuses)
  return {
    id,
    status,
    message:
      status === 'review'
        ? 'Check the APA style reference list setup (see the APA page linked here).'
        : 'Follow the APA style reference list setup (see the APA page linked here).',
    details: issues,
  }
}

/** Up to three entries (quoted, or as `label` gives them) with their pages, then how many more and
 *  on which pages; `also` gives each entry's other page (where a work is listed the first time). */
const entriesText = (
  es: Entry[],
  label = (e: Entry) => `“${quote(e.text, 40)}”`,
  also: (Entry | undefined)[] = [],
  join = list,
) =>
  join(
    es
      .slice(0, 3)
      .map((e, k) => {
        const pages = [also[k], e].flatMap((x) =>
          x && pageOf(x) !== undefined ? [pageOf(x)!] : [],
        )
        return `${label(e)}${pages.length ? ` (${pagesText(pages)})` : ''}`
      })
      .concat(
        es.length > 3 ? [more(es.length - 3, es.slice(3).map(pageOf)).replace(/^…and /, '')] : [],
      ),
  )

function labels(ctx: Ctx): Finding {
  const id = 'appendices.labels'
  const { s, doc } = ctx
  const aps = s.appendices
  if (!aps.length)
    return s.appendicesHeading === undefined
      ? na(id, 'No appendices found.')
      : fix(id, 'Label each appendix (Appendix A, Appendix B…) with its title on the next line.', {
          where: [
            {
              page: doc.paras[s.appendicesHeading].page,
              quote: quote(doc.paras[s.appendicesHeading].text),
            },
          ],
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
  // As the template sets them: the label, then its title on the line below, both centred.
  const untitled: Para[] = []
  const sameLine: Para[] = []
  const offCentre: Para[] = []
  // Under the label a table's or figure's number, not a title of the appendix's own.
  const tableFirst: Para[] = []
  const centred = (p: Para) => {
    if (p.plain || p.align === 'center') return true
    // A PDF line centred on its page: on a wide table's page the text may stop short of the margin.
    const l = p.lines?.length === 1 ? p.lines[0] : undefined
    const pg = l && doc.pages?.[l.page]
    return (
      !!pg && Math.abs((l.x0 + l.x1) / 2 - pg.width / 2) < 8 && l.x0 > (pg.margins?.left ?? 72) + 12
    )
  }
  const labelOf = (p: Para) =>
    /^(appendix|annex)\s*([a-z]{1,2}|\d{1,2})?\b/i.exec(norm(p.text))?.[0] ?? quote(p.text, 30)
  for (const a of aps) {
    const head = doc.paras[a.heading]
    const inline = norm(head.text).replace(
      /^(appendix|annex)\s*([a-z]{1,2}|\d{1,2})?\b[\s.:–—-]*/i,
      '',
    )
    const next = nextText(doc.paras, a.heading + 1, a.end)
    if (
      !inline &&
      next !== undefined &&
      /^(table|figure|fig\.)\s*[A-Z]?\d/i.test(norm(doc.paras[next].text))
    ) {
      tableFirst.push(head)
      if (!centred(head)) offCentre.push(head)
      continue
    }
    // A short line under the label is its title, set as one or not.
    const short = next !== undefined && norm(doc.paras[next].text).length <= 150
    if (!inline && !short) {
      issues.push(`Add a title below “${labelOf(head)}”.`)
      statuses.push('fix')
      untitled.push(head)
      continue
    }
    if (inline) sameLine.push(head)
    if (!centred(head) || (!inline && !centred(doc.paras[next!]))) offCentre.push(head)
  }
  if (sameLine.length) {
    issues.push(
      `Put each title on the line below its label, as the template does: ${list(sameLine.map(labelOf))}.`,
    )
    statuses.push('review')
  }
  if (tableFirst.length) {
    issues.push(
      `Give each appendix its own title on the line below its label, as the template does (an appendix that is one table or figure takes its title in place of the table's number and title, in APA style): ${list(tableFirst.map(labelOf))}.`,
    )
    statuses.push('review')
  }
  if (offCentre.length) {
    issues.push(
      `Centre each label and its title, as the template does: ${list(offCentre.map(labelOf))}.`,
    )
    statuses.push('review')
  }
  untitled.push(
    ...sameLine,
    ...tableFirst,
    ...offCentre.filter((p) => !sameLine.includes(p) && !tableFirst.includes(p)),
  )
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
