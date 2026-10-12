// References and appendices.
import type { Para } from '../model.ts'
import { fix, na, ok, review, worst, type Ctx, type Finding } from '../report.ts'
import { bolded, isHeadingish, nextText } from '../structure.ts'
import { list, norm, plural, quote } from '../text.ts'
import { DOUBLE } from './body.ts'
import { bodyNumbers, pushedDown } from './chapters.ts'
import { readTitlePage } from './front.ts'
import { more, pagesText } from './numbering.ts'

const YEAR = /\((\d{4}[a-z]?|n\.\s?d\.?|no date|in press|forthcoming)(?!\w)/i
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
    if (
      (isHeadingish(p) && bolded(p) && t.length <= 80 && !YEAR.test(t)) ||
      // A plain line of a few words, with no year, link or full stop: the name of a group of
      // sources ("1. Book", "Journal Articles and Books"), not an entry.
      (p.lines?.length === 1 &&
        // (not in the hanging indent: the tail of an entry)
        (edge === undefined || x0(p) === undefined || x0(p)! <= edge + 3) &&
        t.length <= 60 &&
        !/\d{4}|https?:|doi|[.?!),;:–-]$/i.test(t) &&
        /^(\d{1,2}[.)]\s+)?\p{Lu}/u.test(t) &&
        !/,\s*\p{Lu}\b/u.test(t))
    ) {
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
    // A line at an entry's first-line edge that is neither a name nor a work with its year, after
    // an entry that is not finished (no closing full stop, page or link), goes on with it: the
    // writer's second line stands at the margin too.
    const goesOn =
      (placed === true &&
        !startsEntry(t) &&
        !/^\p{Lu}[\p{L}'’-]+,\s+\p{Lu}\./u.test(t) &&
        !!out.length &&
        unfinished(out.at(-1)!.text)) ||
      // The end of an entry that lost its indent: a journal, then volume, issue and pages.
      (!!out.length &&
        !startsEntry(t) &&
        !/^\p{Lu}[\p{L}'’-]+,\s+\p{Lu}\./u.test(t) &&
        /,\s*\d{1,3}(\(\d+\)?)?,\s*[A-Za-z]?\d+[-–]\d+\.?(\s+(https?:\/\/|doi:)\S+)?$/.test(t))
    const opens =
      !out.length ||
      // (a numbered list, "[1] Author…": each number opens an entry)
      /^\[\d{1,3}\]\s/.test(t) ||
      (placed !== false && PARTICLE.test(t)) ||
      (!goesOn &&
        !/^(\p{Ll}|\d+(?!\d|[.)]\s))/u.test(t) &&
        // (an issue number ending a wrapped line: "11. Retrieved from…")
        !(out.length && /^\d{1,3}[.)]\s+(retrieved|https?:|doi\b)/i.test(t)) &&
        (placed ?? (startsEntry(t) || /^\p{Lu}[\p{L}'’-]+,\s+\p{Lu}\./u.test(t))))
    if (opens) out.push({ paras: [p], text: t })
    else {
      out.at(-1)!.paras.push(p)
      out.at(-1)!.text += ' ' + t
    }
  }
  return { list: out, groups }
}

/** An entry's text that stops where a reference does not: on a word, a comma or an ampersand, not
 *  on a full stop, a closing bracket, a page or year, or a link. */
const unfinished = (t: string) =>
  /[\p{L},&:;–-]\d?$/u.test(t) && !/(https?:\/\/|www\.|doi)\S*$/i.test(t)

/** A year in parentheses soon after the authors, not after other numbers (a journal's volume and
 *  pages on a wrapped line, with the next entry beginning further on). */
const startsEntry = (t: string) => {
  const m = YEAR.exec(t.slice(0, 200))
  return !!m && !/\b(1[89]|20)\d{2}\b|\d[;:]|doi/i.test(t.slice(0, m.index))
}

/** Sort key: the first author's surname (or group author), letter by letter. */
const key = (e: Entry, ignoreThe = false) =>
  e.text
    .replace(/^(\d+[.)]|\[\d+\])\s*/, '')
    // (initials before the surname, as IEEE writes it: "J. P. Reyes")
    .replace(/^(?:\p{Lu}\.\s+){1,4}(?=\p{Lu}\p{Ll})/u, '')
    .replace(/^the\s+/i, (the) => (ignoreThe ? '' : the))
    .split(/[,(]/)[0]
    // (a surname with its initials and no comma: "Santos R.A.E", "Cruz PM")
    .replace(/(?<=\p{L}{2})\s+(?:\p{Lu}\.?){1,4}$/u, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // (letters of other alphabets sort with the nearest of ours: "Arı" after "Arathi")
    .replace(/ı/g, 'i')
    .replace(/ß/g, 'ss')
    .replace(/[æǽ]/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/[øǿ]/g, 'o')
    .replace(/[đð]/g, 'd')
    .replace(/ł/g, 'l')
    .replace(/[^a-z ]/g, '')
    .trim()

/** An entry read through a font that came out as control characters: its words cannot be judged. */
const scrambled = (e: Entry) =>
  [...e.text.slice(0, 40)].filter((c) => c.charCodeAt(0) < 32 && c !== '\t' && c !== '\n').length >=
  2

/** The order, read both ways when entries open with "The" (APA puts a group author under its
 *  first significant word, but not every style does): a verdict that depends on it is for the
 *  student to check. */
function orderOf(ctx: Ctx, refs: Entry[]): Finding {
  const a = order(ctx, refs)
  if (!refs.some((e) => /^(\d+[.)]|\[\d+\])?\s*the\s/i.test(e.text))) return a
  const b = order(ctx, refs, true)
  if (a.status === 'fix' && b.status === 'fix')
    // (a pair that only one reading makes, with a "The" entry in it, is left out)
    return {
      ...a,
      details: a.details?.filter((d) => !/“The /.test(d) || !!b.details?.includes(d)),
    }
  if (a.status === b.status) return a
  if (a.status === 'review' || b.status === 'review') return a.status === 'review' ? a : b
  return review(
    a.id,
    'Check where the entries that begin with “The” stand: APA lists a group author by its first significant word, so “The Health Foundation” goes under H. The rest of the list is in order.',
    { details: (a.status === 'fix' ? a : b).details, where: (a.status === 'fix' ? a : b).where },
  )
}

function order(ctx: Ctx, refs: Entry[], ignoreThe = false): Finding {
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
  let unsureEtAl = false
  const flagEtAl = () => {
    unsureEtAl = true
    return false
  }
  const etal = (e: Entry) => /\bet\.? al\b/i.test(e.text.split(/\(\s*(?:1[89]|20)\d\d/)[0])
  // The entries with a sort key (one without must not hide a pair), less a work listed again, as
  // it is or with its title's end changed: that one is to be removed (references.apa says so), not
  // moved.
  const works = new Map<string, string[]>()
  // An author's name with a stray sign in it (a letter lost to a font's encoding) cannot be placed.
  const unreadable: Entry[] = []
  const keyed = refs.filter((e) => {
    if (!key(e, ignoreThe)) return false
    if (scrambled(e)) {
      unreadable.push(e)
      return false
    }
    // (a digit in the name, "W3Schools": where it goes among the letters is for the writer)
    if (
      /\p{L}[\]\\^{}|~¶³´@#$%*+=<>_]\p{L}/u.test(e.text.split(/[,(]/)[0]) ||
      /\p{L}\d|\d\p{L}/u.test(e.text.split(/[,(]/)[0])
    ) {
      unreadable.push(e)
      return false
    }
    const y = byline(e)
    if (!y) return true
    const titles = works.get(`${y.who}|${y.year}`) ?? []
    if (titles.some((t) => t === y.title || (!y.marked && alike(t, y.title)))) return false
    works.set(`${y.who}|${y.year}`, [...titles, y.title])
    return true
  })
  const ks = keyed.map((e) => key(e, ignoreThe))
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
      y0?.init &&
      y1?.init &&
      ks[k - 1] === ks[k] &&
      y0.who !== y1.who &&
      // Not "H." and "H. S.": that may be one author written twice.
      !y0.init.startsWith(y1.init) &&
      !y1.init.startsWith(y0.init)
    ) {
      // One surname goes by the initials ("Brown, D." before "Brown, J. D."), whoever the others are.
      if (y1.init.localeCompare(y0.init, 'en') < 0) {
        pairs.push(
          `${at}“${quote(e.text, 45)}” should come before “${quote(prev!.text, 45)}”: the same surname goes by the first author's initials`,
        )
        misplaced.push(e)
      }
    } else if (
      y0 &&
      y1 &&
      ks[k - 1] === ks[k] &&
      y0.who !== y1.who &&
      namesBefore(y1.names, y0.names) &&
      // ("et al." cuts the authors short: such a list goes by year, not by the names)
      (etal(e) || etal(prev!) ? flagEtAl() : true)
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
  const skipped = unreadable.length
    ? [
        `${plural(unreadable.length, 'reference')} could not be placed, the author's name being unreadable (${list(unreadable.slice(0, 3).map((e) => `“${quote(e.text, 25)}”`))}): check ${unreadable.length === 1 ? 'its' : 'their'} place yourself.`,
      ]
    : []
  if (!pairs.length && !lead.length && unsureEtAl)
    return review(
      id,
      'Check the order of the entries whose authors are cut short with “et al.”: APA lists every author (up to 20), and the list goes by the second author’s surname then.',
    )
  if (!pairs.length && !lead.length)
    return unreadable.length
      ? review(
          id,
          'Check the alphabetical order of the reference list: some names could not be read.',
          {
            details: skipped,
            where: [{ page: pageOf(unreadable[0]), quote: quote(unreadable[0].text, 40) }],
          },
        )
      : ok(id, `All ${refs.length} references are in alphabetical order.`)
  const first = misplaced[0] ?? behind[0][0]
  return fix(
    id,
    'Arrange the reference list in alphabetical order (by the first author’s surname).',
    {
      details: lead
        .concat(pairs.slice(0, 6))
        .concat(pairs.length > 6 ? [more(pairs.length - 6, misplaced.slice(6).map(pageOf))] : [])
        .concat(skipped),
      where: [{ page: pageOf(first), quote: quote(first.text, 40) }],
    },
  )
}

/** APA: one first author's works go by the second author's surname, then the third…; one author
 *  alone comes first ("nothing precedes something"). */
function namesBefore(x: string[], y: string[]): boolean {
  // (names that could not be read in one of them: another style of writing)
  if ((x.length < 2 && y.length < 2) || !x.length || !y.length) return false
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
    // (a full date, "(2011, July 27)", is no part of the title)
    .replace(/^,[^)]{0,30}\)/, '')
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
        marked: /^\((\d{4}[a-z]|(n\.\s?d\.|in press)(\s?-\s?[a-z]|\s[a-z]\)))/i.test(rest),
        // A full date ("2011, March 3"): works of one year then go by date, not by title.
        dated: /^\(\d{4}[a-z]?,/.test(rest),
        // The first author's initials ("Brown, J. D." → "jd"), when written as initials.
        init: (/^[^,]+,\s+((?:\p{Lu}\.[\s-]*)+)/u.exec(by)?.[1] ?? '')
          .toLowerCase()
          .replace(/[^a-z]/g, ''),
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
  // An entry of two lines or more; in a PDF, also one whose second line is a paragraph of its own
  // set no further in than the first (no hanging indent).
  const multi = refs
    .filter((e) => {
      const p = e.paras[0]
      if (ctx.doc.kind !== 'pdf') return norm(p.text).length > 100
      return (
        (p.lines?.length ?? 0) >= 2 ||
        (e.paras.length > 1 &&
          e.paras
            .slice(1)
            .every((q) => (q.lines?.[0]?.x0 ?? Infinity) <= (p.lines?.[0]?.x0 ?? 0) + 3))
      )
    })
    .map((e) => e.paras[0])
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
  // A few entries with no hanging indent among entries that have one (a Word file states it even
  // for a one-line entry, but on one line nobody sees it: that is for the student to check; a PDF
  // shows it on long ones only, and the entry must start where the others do: a piece of a split
  // entry starts further in).
  const bare = (ctx.doc.kind === 'pdf' ? multi : refs.map((e) => e.paras[0])).filter(
    (p) => (p.indent?.firstLine ?? 0) > -6,
  )
  if (
    ctx.doc.kind !== 'doc' &&
    bare.length &&
    hanging.length &&
    hanging.length / multi.length >= 0.8
  ) {
    const xs = hanging.map((p) => p.lines?.[0]?.x0 ?? NaN).sort((a, b) => a - b)
    const x = xs[xs.length >> 1]
    const sure =
      ctx.doc.kind === 'pdf'
        ? bare.every((p) => Math.abs((p.lines?.[0]?.x0 ?? NaN) - x) < 3)
        : bare.some((p) => multi.includes(p))
    issues.push(
      `Use a hanging indent of 0.5 inch (Paragraph > Special: Hanging) on ${entriesText(
        refs.filter((e) => bare.includes(e.paras[0])),
      )}: no hanging indent, unlike the other references.`,
    )
    statuses.push(sure ? 'fix' : 'review')
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
  const own = refs.filter((e) => !SAMPLE.test(e.text) && !scrambled(e))
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
  const named = norm(head.text).replace(/[:.]$/, '')
  const bareName = named.replace(/^([ivxlc]+|\d{1,2})\s*[.)]\s*/i, '')
  if (!/^references$/i.test(bareName)) {
    issues.push(
      `Title the list “References”, as APA style and the template do (not “${quote(head.text, 30)}”).`,
    )
    statuses.push('fix')
  } else if (bareName !== named) {
    // A numbered section of a special problem or a thesis: for the writer to weigh.
    issues.push(
      `The heading reads “${quote(head.text, 30)}”; the template’s is “References” alone, with no number.`,
    )
    statuses.push('review')
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
  // APA's list names the authors (up to 20); "et al." belongs to the in-text citation.
  const etal = own.filter((e) => {
    const cut = YEAR.exec(e.text)?.index ?? e.text.indexOf('(')
    return cut > 0 && /\bet\s+al\b/i.test(e.text.slice(0, cut))
  })
  if (etal.length) {
    issues.push(
      `Name the authors in the entry instead of “et al.” (APA lists up to 20): ${entriesText(etal)}.`,
    )
    statuses.push('fix')
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
        : `Check the rest of the APA setup (each entry's parts, italics, DOIs) against the APA page linked here: the ${plural(refs.length, 'reference')} have double spacing and a year each${ctx.doc.kind === 'pdf' ? '; a hanging indent shows on entries of two lines or more only' : ', and hanging indents'}.`,
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
  const words = new Set(aps.map((a) => (/^annex/i.test(a.label) ? 'Annex' : 'Appendix')))
  // The MDC template says “Appendix”; another program may say “Annex” throughout.
  const mdc = /development communication/i.test(norm(readTitlePage(ctx).program?.text ?? ''))
  if (words.size > 1) {
    issues.push(
      `Label every appendix alike, “Appendix A”, “Appendix B”…, not “Annex” for some: ${list(aps.slice(0, 6).map((a) => a.label))}.`,
    )
    statuses.push(mdc ? 'fix' : 'review')
  } else if (words.has('Annex') && !mdc) {
    issues.push(
      'The appendices are labelled “Annex”; the template says “Appendix A”, “Appendix B”…. Check which your program uses.',
    )
    statuses.push('review')
  }
  // "APPENDIX A" for one and "Appendix B" for another: the same label in two cases.
  const written = new Set(aps.map((a) => /^[a-z]+/i.exec(a.label)?.[0]).filter(Boolean) as string[])
  if (written.size > 1 && new Set([...written].map((w) => w.toLowerCase())).size === 1) {
    issues.push(
      `The appendix labels are not all written alike (${list(aps.slice(0, 6).map((a) => a.label))}): use one form, as the template does (Appendix A, Appendix B…).`,
    )
    statuses.push('review')
  }
  // Pages that are pictures with no text, among the appendices: a label may be in one of them.
  const picturePages =
    doc.kind === 'pdf'
      ? (doc.pages ?? []).filter(
          (pg) =>
            pg.n >= (doc.paras[aps[0].heading].page ?? 0) - 12 &&
            !pg.paras.length &&
            pg.images.length &&
            pg.n < (doc.paras[aps.at(-1)!.heading].page ?? 0),
        )
      : []
  if (aps.length > 1 && marks.some((m) => !m)) {
    issues.push('Give each appendix its letter (Appendix A, Appendix B…).')
    statuses.push('fix')
  }
  if (marks.some((m) => /^\d+$/.test(m))) {
    issues.push('Label appendices with capital letters (Appendix A, B, C), as APA style does.')
    statuses.push('review')
  }
  // Roman numerals (I, II, III…) are a different system, not letters that skip.
  const romans = marks.some((m) => /^[ivx]{2,5}$/i.test(m))
  if (romans) {
    issues.push(
      'Label appendices with capital letters (Appendix A, B, C), as APA style does, not Roman numerals.',
    )
    statuses.push('review')
  }
  const letters = romans
    ? []
    : marks.filter((m) => /^[a-z]$/i.test(m)).map((m) => m.toUpperCase().charCodeAt(0))
  if (letters.some((c, k) => k > 0 && c !== letters[k - 1] + 1)) {
    issues.push(`The appendix letters skip or repeat (${marks.join(', ')}).`)
    statuses.push(picturePages.length ? 'review' : 'fix')
  } else if (letters.length && marks[0] && letters[0] !== 65) {
    // The first appendix is unlabelled, or the letters begin further on.
    issues.push(
      `The appendix letters should begin at A (the first labelled one is ${aps[0].label}): label every appendix in order, Appendix A, Appendix B…`,
    )
    statuses.push(picturePages.length ? 'review' : 'fix')
  }
  if (picturePages.length && statuses.includes('review'))
    issues.push(
      `${pagesText(picturePages.slice(0, 5).map((pg) => pg.n))} ${picturePages.length > 1 ? 'are pictures' : 'is a picture'} with no text, so an appendix label may be there.`,
    )
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
    /^(appendix|appendices|annex)\s*([ivx]{3,5}|[a-z]{1,2}\d?|\d{1,2}[a-z]?)?\b/i
      .exec(norm(p.text))?.[0]
      .trim() || quote(p.text, 30)
  for (const a of aps) {
    const head = doc.paras[a.heading]
    const inline = norm(head.text).replace(
      /^(appendix|appendices|annex)\s*([ivx]{3,5}|[a-z]{1,2}\d?|\d{1,2}[a-z]?)?\b[\s.:–—-]*/i,
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
  // Appendices may come before the references: each part then runs to the other's start.
  const first = s.references && apStart !== undefined && apStart < s.references.start
  return [
    orderOf(ctx, refs),
    apa(ctx, refs, groups),
    s.references
      ? bodyNumbers(
          ctx,
          'references.pageNumbers',
          s.references.start,
          apStart !== undefined && !first ? apStart : doc.paras.length,
          'reference pages',
        )
      : fix(
          'references.pageNumbers',
          'Add the References section, with page numbers continuing from the chapters.',
        ),
    labels(ctx),
    apStart === undefined
      ? na('appendices.pageNumbers', 'No appendices found.')
      : bodyNumbers(
          ctx,
          'appendices.pageNumbers',
          apStart,
          first ? s.references!.start : doc.paras.length,
          'appendix pages',
        ),
  ]
}
