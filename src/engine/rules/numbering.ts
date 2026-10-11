// Page numbers ("folios"): the shortened title, an ellipsis, then i, ii... before Chapter I and
// 2, 3... after it, none on the title page and on the first page of each chapter. A PDF shows every
// footer as printed; a Word file is read from its section settings and footers instead.
import type { Doc, HeaderFooter, NumberFormat, Section } from '../model.ts'
import { fromRoman, norm, quote, roman } from '../text.ts'

export interface Folio {
  raw: string
  title: string
  ellipsis: boolean
  number?: string
  value?: number
  kind?: 'roman' | 'arabic' | 'other'
  /** The number is Word's PAGE field (its value depends on the page). */
  field?: boolean
}

const PLACEHOLDER = /shortened thesis title here/i
// The number after an ellipsis, a space, or a bar or dot set where the ellipsis goes ("Title │ii").
const FOLIO = /^(.*?)(?:(…|\.{2,}|(?:\.\s?){3})\s*|\s*[|│¦•·]\s*|\s+|^)([ivxlcdm]+|\d+)\s*$/i

export function parseFolio(raw: string): Folio | undefined {
  const t = norm(raw.replace(/\n/g, ' '))
  if (!t) return undefined
  const m = FOLIO.exec(t)
  if (!m)
    return { raw: t, title: t.replace(/(…|\.{2,})$/, '').trim(), ellipsis: /(…|\.{2,})$/.test(t) }
  let title = m[1].trim()
  let ellipsis = !!m[2]
  if (!ellipsis && /(…|\.{2,})$/.test(title)) {
    ellipsis = true
    title = title.replace(/(…|\.{2,})$/, '').trim()
  }
  const number = m[3]
  const r = fromRoman(number)
  return {
    raw: t,
    title,
    ellipsis,
    number,
    kind: /^\d+$/.test(number) ? 'arabic' : r !== undefined ? 'roman' : 'other',
    value: /^\d+$/.test(number) ? +number : r,
  }
}

/** A Word footer, its `{PAGE}` field read with the section's number format. */
function wordFolio(text: string, format: NumberFormat, value?: number): Folio | undefined {
  if (!text.includes('{PAGE}')) return parseFolio(text)
  const before = norm(text.slice(0, text.indexOf('{PAGE}')))
  const kind = format === 'decimal' ? 'arabic' : /Roman$/.test(format) ? 'roman' : 'other'
  const shown =
    value === undefined
      ? undefined
      : kind === 'roman'
        ? format === 'upperRoman'
          ? roman(value).toUpperCase()
          : roman(value)
        : String(value)
  return {
    raw: norm(text.replace('{PAGE}', shown ?? '#')),
    title: before.replace(/(…|\.{2,})$/, '').trim(),
    ellipsis: /(…|\.{2,}|(\.\s?){3})$/.test(before),
    number: shown,
    value,
    kind,
    field: true,
  }
}

/** pp. 2–5, 8 (1-based) */
export function pagesText(pages: number[]): string {
  const ps = [...new Set(pages)].sort((a, b) => a - b).map((p) => p + 1)
  const out: string[] = []
  for (let k = 0; k < ps.length; k++) {
    let j = k
    while (j + 1 < ps.length && ps[j + 1] === ps[j] + 1) j++
    // Word joiners keep a range on one line ("18–26", not "18–" then "26").
    out.push(j > k ? `${ps[k]}\u2060–\u2060${ps[j]}` : `${ps[k]}`)
    k = j
  }
  // A no-break space keeps "p." with its number.
  return `${ps.length === 1 ? 'p.' : 'pp.'}\u00a0${out.join(', ')}`
}

/** The line closing a cut list: "…and 5 more, on pp. 7, 9–11". */
export const more = (n: number, pages: (number | undefined)[]) => {
  const known = pages.filter((p) => p !== undefined)
  return `…and ${n} more${known.length ? `, on ${pagesText(known)}` : ''}`
}

export type Want = { kind: 'roman' | 'arabic'; value?: number } | 'none'

export interface Problem {
  /** Kind of problem, for grouping. */
  type:
    | 'missing'
    | 'present'
    | 'kind'
    | 'value'
    | 'title'
    | 'placeholder'
    | 'ellipsis'
    | 'long'
    | 'changed'
  page?: number
  text: string
  /** A long title's length in words (on its own problem and on a missing ellipsis after it). */
  words?: number
}

/** A footer as quoted in a message: a long one by its end, where the page number is. */
export const clip = (raw: string) => {
  if (raw.length <= 50) return raw
  const tail = raw.slice(-45)
  return '…' + tail.slice(tail.indexOf(' ') + 1)
}

/** Checks one footer against what the page should show. */
export function judge(folio: Folio | undefined, want: Want, page?: number): Problem[] {
  const at = page === undefined ? '' : `${pagesText([page])}: `
  if (want === 'none')
    return folio ? [{ type: 'present', page, text: `${at}shows “${clip(folio.raw)}”` }] : []
  const expected =
    want.value === undefined
      ? undefined
      : want.kind === 'roman'
        ? roman(want.value)
        : String(want.value)
  if (!folio || (folio.number === undefined && !folio.field))
    return [
      {
        type: 'missing',
        page,
        text: `${at}no page number${expected ? ` (it should be ${expected})` : ''}`,
      },
    ]
  const out: Problem[] = []
  // A Word page field whose value depends on the page: say how it numbers instead.
  const shows =
    folio.number ??
    (folio.kind === 'arabic'
      ? 'Arabic numbers (1, 2, 3)'
      : folio.kind === 'roman'
        ? 'Roman numbers'
        : 'letters')
  if (folio.kind !== want.kind)
    out.push({
      type: 'kind',
      page,
      text: `${at}shows ${shows}; use ${want.kind === 'roman' ? 'Roman' : 'Arabic'} numerals${expected ? ` (${expected})` : ''}`,
    })
  else if (expected !== undefined && folio.value !== undefined && folio.value !== want.value)
    out.push({ type: 'value', page, text: `${at}shows ${folio.number}; it should be ${expected}` })
  const words = folio.title.split(/\s+/).filter(Boolean).length
  if (PLACEHOLDER.test(folio.title))
    out.push({ type: 'placeholder', page, text: `${at}still says “Shortened thesis title here”` })
  else if (!folio.title)
    out.push({ type: 'title', page, text: `${at}has no shortened thesis title before the number` })
  else {
    // A shortened title is a few words; the whole title runs longer.
    if (words > 12)
      out.push({
        type: 'long',
        page,
        words,
        text: `${at}has a ${words}-word title before the number; shorten it`,
      })
    // A whole title is no shortened one: the ellipsis goes after "the title" then.
    if (!folio.ellipsis)
      out.push({
        type: 'ellipsis',
        page,
        words: words > 12 ? words : undefined,
        text: `${at}has no ellipsis (…) after the ${words > 12 ? '' : 'shortened '}title`,
      })
  }
  return out
}

/** A footer title for comparing: its letters and digits only ("TITLE │" and "Title│" are one). */
export const titleKey = (t: string) =>
  norm(t)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')

/** The footer titles on `pages` by key, the most common first (a tie: the earliest). Only pages
 *  whose number was read: a number run into the title leaves the title unknown. */
function titleGroups(doc: Doc, pages: number[]) {
  const groups = new Map<string, { shown: string; pages: number[] }>()
  for (const p of pages) {
    const f = pdfFolio(doc, p)
    const key = f?.number !== undefined ? titleKey(f.title) : ''
    if (!key) continue
    const g = groups.get(key) ?? { shown: norm(f!.title), pages: [] }
    g.pages.push(p)
    groups.set(key, g)
  }
  return [...groups]
    .map(([key, g]) => ({ key, ...g }))
    .sort((a, b) => b.pages.length - a.pages.length || a.pages[0] - b.pages[0])
}

/** The title most footers on `pages` carry, as first written; none without a majority. */
export function mainTitle(doc: Doc, pages: number[]) {
  const groups = titleGroups(doc, pages)
  const total = groups.reduce((n, g) => n + g.pages.length, 0)
  return groups[0] && groups[0].pages.length > total / 2 ? groups[0] : undefined
}

/** Footers with another title than most of `pages` carry, each title once with its pages: one
 *  thesis, one title (one odd page is one change, not two). */
function titleChanges(doc: Doc, pages: number[]): Problem[] {
  const [main, ...others] = titleGroups(doc, pages)
  return others.map((g) => ({
    type: 'changed',
    page: g.pages[0],
    text: `${pagesText(g.pages)}: the footer has another title, “${quote(g.shown, 40)}”, than the other pages (“${quote(main.shown, 40)}”); keep one shortened title`,
  }))
}

// ---- PDF ----

/** The page's footer, or a page number printed at the top of the page instead. */
export function pdfFolio(doc: Doc, page: number): Folio | undefined {
  const pg = doc.pages?.[page]
  const top = parseFolio(pg?.header ?? '')
  return parseFolio(pg?.footer ?? '') ?? (top?.value !== undefined ? top : undefined)
}

/** Checks a run of PDF pages; `want` gives what each page should show. */
export function auditPdf(doc: Doc, pages: number[], want: (p: number) => Want): Problem[] {
  return [...pages.flatMap((p) => judge(pdfFolio(doc, p), want(p), p)), ...titleChanges(doc, pages)]
}

// ---- Word ----

/** The first paragraph of the section that starts a page. */
const firstPagePara = (doc: Doc, sec: Section) => {
  for (let k = sec.first; k <= sec.last; k++) if (doc.paras[k].newPage) return k
  return sec.first
}

/** Explicit pages in a section (page and section breaks), at least one. */
const explicitPages = (doc: Doc, sec: Section) => {
  let n = 0
  for (let k = sec.first; k <= sec.last; k++) if (doc.paras[k].newPage) n++
  return Math.max(1, n)
}

/** Page number at the start of each section, where the breaks tell it. */
export function sectionStarts(doc: Doc): (number | undefined)[] {
  const out: (number | undefined)[] = []
  for (const [k, sec] of (doc.sections ?? []).entries()) {
    const prev = out[k - 1]
    out.push(
      sec.start ??
        (k === 0
          ? 1
          : prev === undefined
            ? undefined
            : prev + explicitPages(doc, doc.sections![k - 1])),
    )
  }
  return out
}

/** The footer on the page where paragraph `i` stands, as far as a Word file can tell. */
export function wordFolioAt(
  doc: Doc,
  i: number,
): { folio?: Folio; section: number; firstPage: boolean } {
  const k = doc.paras[i]?.section ?? 0
  const sec = doc.sections![k]
  // Text before `i` in its section means the page is not the section's first (unless a break says so).
  const firstPage =
    firstPagePara(doc, sec) === i || !doc.paras.slice(sec.first, i).some((p) => norm(p.text))
  const value = firstPage ? sectionStarts(doc)[k] : undefined
  const hf =
    firstPage && sec.titlePage
      ? sec.footer.first
      : doc.evenOdd && value !== undefined && value % 2 === 0
        ? sec.footer.even
        : sec.footer.default
  const format = hf?.format ?? sec.format
  return { folio: hf ? wordFolio(hf.text, format, value) : undefined, section: k, firstPage }
}

/** The footers the pages of section `k` show: most pages, its first page when that one differs
 *  (unless it is meant to have no number, as a chapter's first page) and its even pages when odd
 *  and even pages differ. `where` names the pages for messages. */
export function wordSectionFolios(
  doc: Doc,
  k: number,
  firstUnnumbered: boolean,
): { where: string; folio?: Folio }[] {
  const sec = doc.sections![k]
  const read = (hf?: HeaderFooter) => (hf ? wordFolio(hf.text, hf.format ?? sec.format) : undefined)
  const out = [{ where: '', folio: read(sec.footer.default) }]
  if (sec.titlePage && !firstUnnumbered)
    out.push({ where: 'the first page of ', folio: read(sec.footer.first) })
  if (doc.evenOdd) out.push({ where: 'the even pages of ', folio: read(sec.footer.even) })
  return out
}

const LABEL: Record<Problem['type'], string> = {
  missing: 'No page number on',
  present: 'A page number shows on',
  kind: 'The wrong kind of numerals on',
  value: 'The wrong page number on',
  title: 'No shortened thesis title on',
  placeholder: '“Shortened thesis title here” is still on',
  ellipsis: 'No ellipsis (…) after the shortened title on',
  long: 'A long title, not a shortened one, on',
  changed: 'The title in the footer changes on',
}

/** Problems grouped by kind, one line each ("No page number on pp. 4–6, e.g. …"). */
export function summarize(problems: Problem[]): string[] {
  const types = [...new Set(problems.map((p) => p.type))]
  return types.flatMap((type) => {
    const ps = problems.filter((p) => p.type === type)
    const pages = ps.flatMap((p) => (p.page === undefined ? [] : [p.page]))
    if (type === 'value' || type === 'changed' || pages.length < 3) {
      // "p. 5: …" keeps its small p; a sentence starts with a capital.
      const shown = ps
        .slice(0, 3)
        .map((p) =>
          p.page === undefined ? p.text.charAt(0).toUpperCase() + p.text.slice(1) : p.text,
        )
      return ps.length > 3
        ? [
            ...shown,
            more(
              ps.length - 3,
              ps.slice(3).map((p) => p.page),
            ),
          ]
        : shown
    }
    // An example only where it says more than the label: what shows instead.
    if (type === 'kind' || type === 'present')
      return [`${LABEL[type]} ${pagesText(pages)} (for example ${ps[0].text})`]
    if (type === 'long')
      return [
        `A long title (${ps[0].words} words), not a shortened one, on ${pagesText(pages)}: shorten it`,
      ]
    if (type === 'ellipsis' && ps.some((p) => p.words))
      return [`No ellipsis (…) after the title on ${pagesText(pages)}`]
    return [`${LABEL[type]} ${pagesText(pages)}`]
  })
}
