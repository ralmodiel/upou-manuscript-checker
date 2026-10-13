// Page numbers ("folios"): the shortened title, an ellipsis, then i, ii... before Chapter I and
// 2, 3... after it, none on the title page and on the first page of each chapter. A PDF shows every
// footer as printed; a Word file is read from its section settings and footers instead.
import type { Doc, HeaderFooter, Line, NumberFormat, Section } from '../model.ts'
import { distance, fromRoman, norm, quote, roman } from '../text.ts'

export interface Folio {
  raw: string
  title: string
  ellipsis: boolean
  number?: string
  value?: number
  kind?: 'roman' | 'arabic' | 'other'
  /** The number is Word's PAGE field (its value depends on the page). */
  field?: boolean
  /** The number has "p." or "page" before it. */
  label?: boolean
  /** Two items of the footer print over one another (a title over its number): not readable. */
  overlap?: boolean
  /** Letters stand after the ellipsis where the number goes: a font's wrong glyphs for numerals. */
  unreadNumber?: boolean
}

const PLACEHOLDER = /shortened (thesis |dissertation |manuscript |project )?title here/i
// The number after an ellipsis, a space, or a bar or dot set where the ellipsis goes ("Title │ii").
const FOLIO = /^(.*?)(?:(…|\.{2,}|(?:\.\s?){3})\s*|\s*[|│¦•·]\s*|\s+|^)([ivxlcdm]+|\d+)\s*$/i

/** The number run into the last word of a footer ("Learningii", "Studies12"): split off when the
 *  word without it is one the manuscript uses and the whole is not. */
function unglue(t: string, words: Set<string>): { text: string; number: string } | undefined {
  // (the last word, set off by a space: not the number after dots or an ellipsis)
  const w = /(?:^|\s)([\p{L}\d]+)$/u.exec(t)?.[1] ?? ''
  for (let k = 1; k <= 6 && k < w.length; k++) {
    const tail = w.slice(-k)
    const stem = w.slice(0, -k).toLowerCase()
    if (!(/^\d{1,3}$/.test(tail) || fromRoman(tail) !== undefined)) continue
    if (
      // (a short word too before digits: "at100")
      stem.length >= (/^\d+$/.test(tail) ? 2 : 3) &&
      !/^[ivxlcdm\d]+$/.test(stem) &&
      words.has(stem) &&
      !words.has(w.toLowerCase())
    )
      return { text: `${t.slice(0, t.length - k)} ${tail}`, number: tail }
  }
  return undefined
}

export function parseFolio(raw: string, words?: Set<string>): Folio | undefined {
  let t = norm(raw.replace(/\n/g, ' '))
  // A symbol font may print the ellipsis as «: before the number at a footer's end it is one.
  t = t.replace(/«(?=\s*([ivxlcdm]+|\d+)$)/i, '…')
  if (!t) return undefined
  // A stray ".." printed over the end of the number (a second item at the same place).
  t = t.replace(/(\d|\b[ivxlcdm]+)\s*\.{2}$/i, '$1')
  // A number run into the word before it.
  if (words && !/\s([ivxlcdm]+|\d+)\s*$/i.test(t)) t = unglue(t, words)?.text ?? t
  const m = FOLIO.exec(t)
  if (!m) {
    const odd = /^(.*?)(…|\.{2,})\s*(\p{L}{1,5})$/u.exec(t)
    return {
      raw: t,
      title: (odd?.[1] ?? t.replace(/(…|\.{2,})$/, '')).trim(),
      ellipsis: !!odd || /(…|\.{2,})$/.test(t),
      ...(odd ? { unreadNumber: true } : {}),
    }
  }
  // A year closing the footer's text ("…, Author, 2020") is no page number: that one is not
  // in the text, unread.
  if (/^(19|20)\d\d$/.test(m[3]) && /,$/.test(m[1].trim()))
    return { raw: t, title: t, ellipsis: false, unreadNumber: true }
  let title = m[1].trim()
  // "p. 60", "page 7": the label of a number, which the template does not have.
  const label = /(?:^|\s)(?:p|pp|pg|page)\.?$/i.test(title)
  if (label) title = title.replace(/\s*(?:p|pp|pg|page)\.?$/i, '').trim()
  let ellipsis = !!m[2]
  // (a quoted title may close its quotation marks after the ellipsis: “A Study…” 12)
  if (!ellipsis && /(…|\.{2,})["'”’»]*$/.test(title)) {
    ellipsis = true
    title = title.replace(/(…|\.{2,})(["'”’»]*)$/, '$2').trim()
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
    ...(label ? { label: true } : {}),
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
    | 'typo'
    | 'garbled'
    | 'changed'
    | 'label'
    | 'overlap'
    | 'unread'
  page?: number
  text: string
  /** The number shown less the number expected (a wrong page number). */
  diff?: number
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
  // (what the footer's title shows is judged all the same)
  if (folio?.unreadNumber)
    return [
      { type: 'unread', page, text: `${at}the page number could not be read` },
      ...titleProblems(folio, at, page),
    ]
  if (!folio || (folio.number === undefined && !folio.field))
    return [
      {
        type: 'missing',
        page,
        text: `${at}no page number${expected ? ` (it should be ${expected})` : ''}`,
      },
    ]
  // Print over print: what the footer says is not for us to read.
  if (folio.overlap)
    return [
      {
        type: 'overlap',
        page,
        text: `${at}the footer's title and page number print over one another`,
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
    out.push({
      type: 'value',
      page,
      text: `${at}shows ${folio.number}; it should be ${expected}`,
      diff: folio.value - (want.value ?? 0),
    })
  if (folio.label)
    out.push({
      type: 'label',
      page,
      text: `${at}the number has “p.” or “page” before it; write the number alone`,
    })
  return [...out, ...titleProblems(folio, at, page)]
}

/** What a footer's title lacks: the shortening, the ellipsis. */
function titleProblems(folio: Folio, at: string, page?: number): Problem[] {
  const out: Problem[] = []
  const words = folio.title.split(/\s+/).filter(Boolean).length
  if (PLACEHOLDER.test(folio.title))
    out.push({ type: 'placeholder', page, text: `${at}still says “Shortened title here”` })
  else if (!folio.title)
    out.push({ type: 'title', page, text: `${at}has no shortened title before the number` })
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
function titleGroups(doc: Doc, pages: number[], thesis = '') {
  const groups = new Map<string, { shown: string; pages: number[] }>()
  for (const p of pages) {
    const f = pdfFolio(doc, p)
    const key = f?.number !== undefined && !f.overlap ? titleKey(f.title) : ''
    if (!key) continue
    const g = groups.get(key) ?? { shown: norm(f!.title), pages: [] }
    g.pages.push(p)
    groups.set(key, g)
  }
  // A title drawn from the thesis title (its words found there) leads, then the most common.
  const words = new Set(titleWords(thesis))
  const drawn = (t: string) => {
    const w = titleWords(t)
    return w.length > 0 && w.filter((x) => words.has(x)).length >= 0.8 * w.length ? 1 : 0
  }
  return [...groups]
    .map(([key, g]) => ({ key, ...g }))
    .sort(
      (a, b) =>
        drawn(b.shown) - drawn(a.shown) ||
        b.pages.length - a.pages.length ||
        a.pages[0] - b.pages[0],
    )
}

const titleWords = (t: string) =>
  norm(t)
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? []

/** Letters a font printed wrongly: a capital inside a word ("LeaYninN") or a symbol against one. */
const oddLetters = (t: string) =>
  /\p{L}[\\^|~[\]{}]|[\\^|~[\]{}]\p{L}/u.test(t) ||
  norm(t)
    .split(' ')
    .some((w) => /\p{Ll}\p{Lu}/u.test(w.replace(/^(Mc|Mac)/, '')))

/** Two footer titles that differ only through unreadable letters (a font's wrong or dropped
 *  glyphs): letters changed inside words, no whole word added or left out. Not a sure change. */
export function garbledVariant(a: string, b: string): boolean {
  const ka = titleKey(a)
  const kb = titleKey(b)
  if (!oddLetters(a) && !oddLetters(b)) return false
  if (ka === kb || distance(ka, kb) > 0.25 * Math.max(ka.length, kb.length)) return false
  const wa = new Set(titleWords(a))
  const wb = new Set(titleWords(b))
  return [...wa].some((w) => !wb.has(w)) && [...wb].some((w) => !wa.has(w))
}

/** The title most footers on `pages` carry, as first written; none without a majority. */
export function mainTitle(doc: Doc, pages: number[]) {
  const groups = titleGroups(doc, pages)
  const total = groups.reduce((n, g) => n + g.pages.length, 0)
  return groups[0] && groups[0].pages.length > total / 2 ? groups[0] : undefined
}

export interface TitleRef {
  key: string
  shown: string
}

/** The shortened title most of the preliminary pages carry in their footers (those before the
 *  first chapter's heading, paragraph `chapter`); none without a majority. */
export function prelimTitle(doc: Doc, chapter: number): TitleRef | undefined {
  if (doc.kind === 'pdf') {
    const page = doc.paras[chapter]?.page
    const main =
      page === undefined
        ? undefined
        : mainTitle(
            doc,
            Array.from({ length: page }, (_, p) => p),
          )
    return main && { key: main.key, shown: main.shown }
  }
  if (!doc.sections) return undefined
  const counts = new Map<string, { shown: string; n: number }>()
  let total = 0
  for (const [k, sec] of doc.sections.entries()) {
    if (sec.first >= chapter) break
    const folio = wordSectionFolios(doc, k, true)[0]?.folio
    const key = folio ? titleKey(folio.title) : ''
    if (!key) continue
    const c = counts.get(key) ?? { shown: norm(folio!.title), n: 0 }
    c.n++
    total++
    counts.set(key, c)
  }
  const best = [...counts].sort((a, b) => b[1].n - a[1].n)[0]
  return best && best[1].n > total / 2 ? { key: best[0], shown: best[1].shown } : undefined
}

/** Footers with another title than most of `pages` carry, each title once with its pages: one
 *  thesis, one title (one odd page is one change, not two). */
function titleChanges(doc: Doc, pages: number[], thesis?: string, ref?: TitleRef): Problem[] {
  const groups = titleGroups(doc, pages, thesis)
  // Against the title the preliminary pages carry, when these pages are a later part.
  if (ref)
    return groups
      .filter((g) => g.key !== ref.key)
      .map((g) => ({
        type: garbledVariant(g.shown, ref.shown) ? ('garbled' as const) : ('changed' as const),
        page: g.pages[0],
        text: `${pagesText(g.pages)}: the footer has another title, “${quote(g.shown, 40)}”, than the preliminary pages (“${quote(ref.shown, 40)}”); keep one shortened title`,
      }))
  const [main, ...others] = groups
  return others.map((g) => ({
    type: garbledVariant(g.shown, main.shown) ? ('garbled' as const) : ('changed' as const),
    page: g.pages[0],
    text: `${pagesText(g.pages)}: the footer has another title, “${quote(g.shown, 40)}”, than the other pages (“${quote(main.shown, 40)}”); keep one shortened title`,
  }))
}

// ---- PDF ----

/** A number standing by itself: a span of its own, or a line of its own. */
const NUMBER = /^([ivxlcdm]+|\d+)$/i

/** The words the manuscript uses, for telling a number run into a word from the word. */
const wordCache = new WeakMap<Doc, Set<string>>()
function docWords(doc: Doc): Set<string> {
  let w = wordCache.get(doc)
  if (!w) {
    w = new Set()
    for (const p of doc.paras)
      for (const m of p.text.matchAll(/\p{L}{3,}/gu)) w.add(m[0].toLowerCase())
    wordCache.set(doc, w)
  }
  return w
}

/** A footer of several lines whose number is not at the end of the last: the title wrapped below
 *  a number that ends its first line (as an item of its own, or the end of its text), a number
 *  alone on a line above the title, or a Roman numeral broken over two lines ("vii" and "i" for
 *  "viii"). The title is then the other lines' text, read in order, and the number the one found. */
function wrappedFolio(lines: Line[], words: Set<string>, brokenOnly = false): Folio | undefined {
  const reach = Math.max(...lines.map((l) => l.x1))
  for (const [k, l] of lines.entries()) {
    const last = l.spans.at(-1)
    // A span of its own, whatever the gap (a field is one item; a roman numeral ending a title is
    // part of the title's own item).
    const alone = l.spans.length === 1 && NUMBER.test(l.text.trim())
    const apart = l.spans.length >= 2 && !!last && NUMBER.test(last.text) && k < lines.length - 1
    // The longest line of the footer, ending in the number: the title wrapped after it.
    const inText =
      l.spans.length === 1 &&
      k < lines.length - 1 &&
      l.x1 >= reach - 3 &&
      /\s([ivxlcdm]+|\d{1,3})$/i.test(l.text)
    if (!alone && !apart && !inText) continue
    let number = alone ? l.text.trim() : apart ? last!.text : /[^\s]+$/.exec(l.text)![0]
    if (!/^\d+$/.test(number) && fromRoman(number) === undefined) continue
    // The rest of a Roman numeral on a line below, under the first part.
    const x0 = last?.x0
    const piece = lines.findIndex(
      (q, j) =>
        j > k &&
        x0 !== undefined &&
        q.spans.length >= 2 &&
        /^[ivxlc]+$/i.test(q.spans.at(-1)!.text) &&
        Math.abs(q.spans.at(-1)!.x0 - x0) <= 3 &&
        fromRoman(number + q.spans.at(-1)!.text) !== undefined,
    )
    if (brokenOnly && piece < 0) continue
    const tail = piece >= 0 ? lines[piece].spans.at(-1)!.text : ''
    number += tail
    const rest = lines.map((x, j) =>
      j === piece
        ? x.text.slice(0, x.text.lastIndexOf(tail))
        : j !== k
          ? x.text
          : alone
            ? ''
            : x.text.slice(0, x.text.lastIndexOf(number.slice(0, number.length - tail.length))),
    )
    const f = parseFolio(`${rest.filter((t) => t.trim()).join(' ')} ${number}`, words)
    return f?.number === number ? f : undefined
  }
  return undefined
}

/** Two items of a footer line that stand on one another: different text over more than half the
 *  narrower one (a stray row of dots over a number, or the same text printed twice, is no clash). */
function overlaps(lines: Line[]): boolean {
  return lines.some((l) =>
    l.spans.some((a, i) =>
      l.spans.slice(i + 1).some((b) => {
        const over = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
        return (
          over > 3 &&
          over > 0.5 * Math.min(a.x1 - a.x0, b.x1 - b.x0) &&
          norm(a.text) !== norm(b.text) &&
          /[\p{L}\p{N}]/u.test(a.text) &&
          /[\p{L}\p{N}]/u.test(b.text)
        )
      }),
    ),
  )
}

/** The page's footer, or a page number printed at the top of the page instead. */
export function pdfFolio(doc: Doc, page: number): Folio | undefined {
  const pg = doc.pages?.[page]
  const words = docWords(doc)
  const top = parseFolio(pg?.header ?? '')
  let foot = parseFolio(pg?.footer ?? '', words)
  // (a footer ending in a number may still have it broken over two lines: "vii" and "i")
  if (foot && (pg?.footerLines.length ?? 0) > 1)
    foot = wrappedFolio(pg!.footerLines, words, foot.number !== undefined) ?? foot
  // Items of the footer that print over one another (the number over the end of the title).
  if (foot && overlaps(pg!.footerLines)) foot = { ...foot, overlap: true }
  // (a line of text taken for a footer does not hide a page number set at the top)
  return foot?.number !== undefined ? foot : top?.value !== undefined ? top : foot
}

/** PDF pages with no text layer: their writing is a picture or drawn outlines, so nothing on
 *  them (a page number, a caption) can be read. */
export function noTextPages(doc: Doc): Set<number> {
  const inked = new Set(doc.paras.flatMap((p) => (p.lines ?? []).map((l) => l.page)))
  return new Set(
    (doc.pages ?? [])
      .filter(
        (pg) =>
          !inked.has(pg.n) &&
          // A picture over most of the page (a scan), or outlines of letters (many small filled
          // shapes); not a figure on a page of its own.
          (pg.images.some((b) => (b.x1 - b.x0) * (b.y1 - b.y0) >= 0.7 * pg.width * pg.height) ||
            pg.marks.filter(
              (m) => m.kind === 'path' && m.x1 - m.x0 < 40 && m.y1 - m.y0 < 40 && !!m.fill,
            ).length >= 30),
      )
      .map((pg) => pg.n),
  )
}

/** A footer title set against the thesis title: the whole title (ten words or more, so no
 *  shortening), or the title with a word misspelled (a word of the footer one or two letters off a
 *  word of the title). */
export function footerVsTitle(
  footer: string,
  thesis?: string,
): { whole?: number; typo?: [string, string] } {
  const words = (t: string) => titleWords(t).filter((w) => /\p{L}/u.test(w))
  const tw = words(thesis ?? '')
  const fw = words(footer)
  if (tw.length < 5 || fw.length < 4) return {}
  const known = new Set(tw)
  let typo: [string, string] | undefined
  for (const w of fw) {
    if (known.has(w)) continue
    const near = w.length >= 5 ? tw.find((t) => t.length >= 5 && distance(w, t) <= 2) : undefined
    if (!near) return {}
    typo ??= [w, near]
  }
  return {
    ...(fw.length >= 10 && fw.length >= 0.9 * tw.length ? { whole: fw.length } : {}),
    ...(typo ? { typo } : {}),
  }
}

/** The footer's title against the thesis title: the problems of footerVsTitle on a page. */
export function againstTitle(
  folio: Folio | undefined,
  thesis: string | undefined,
  page: number,
): Problem[] {
  if (!folio || folio.number === undefined || !folio.title) return []
  const { whole, typo } = footerVsTitle(folio.title, thesis)
  const at = `${pagesText([page])}: `
  const out: Problem[] = []
  // (a title of more than twelve words is judge's own "long")
  if (whole && whole <= 12)
    out.push({
      type: 'long',
      page,
      words: whole,
      text: `${at}has the whole ${whole}-word title before the number; shorten it`,
    })
  if (typo && !oddLetters(folio.title))
    out.push({
      type: 'typo',
      page,
      text: `${at}the footer has “${typo[0]}”, the title page “${typo[1]}”`,
    })
  return out
}

/** Checks a run of PDF pages; `want` gives what each page should show. */
export function auditPdf(
  doc: Doc,
  pages: number[],
  want: (p: number) => Want,
  thesis?: string,
  ref?: TitleRef,
): Problem[] {
  const unread = noTextPages(doc)
  // A wholly blank page (no text, no picture, no footer) is the blank-pages item's.
  const inked = new Set(doc.paras.flatMap((q) => (q.lines ?? []).map((l) => l.page)))
  const blank = (p: number) =>
    !inked.has(p) &&
    !doc.pages?.[p]?.images.length &&
    !doc.pages?.[p]?.footer &&
    !doc.pages?.[p]?.header &&
    !unread.has(p)
  return [
    ...pages
      .filter((p) => !blank(p))
      .flatMap((p) =>
        unread.has(p)
          ? [{ type: 'unread' as const, page: p, text: `${pagesText([p])}: no text layer` }]
          : [...judge(pdfFolio(doc, p), want(p), p), ...againstTitle(pdfFolio(doc, p), thesis, p)],
      ),
    ...titleChanges(doc, pages, thesis, ref),
  ]
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
  title: 'No shortened title on',
  placeholder: '“Shortened title here” is still on',
  ellipsis: 'No ellipsis (…) after the shortened title on',
  long: 'A long title, not a shortened one, on',
  typo: 'A footer title spelled differently from the title page on',
  garbled: 'A footer title that differs through unreadable letters on',
  changed: 'The title in the footer changes on',
  label: 'The number has “p.” or “page” before it on',
  overlap: 'The footer prints over itself, so it could not be read, on',
  unread: 'The page number could not be read (no text layer, or not as text) on',
}

/** Problems grouped by kind, one line each ("No page number on pp. 4–6, e.g. …"). */
export function summarize(problems: Problem[]): string[] {
  const types = [...new Set(problems.map((p) => p.type))]
  return types.flatMap((type) => {
    const ps = problems.filter((p) => p.type === type)
    const pages = ps.flatMap((p) => (p.page === undefined ? [] : [p.page]))
    // Numbers all off by the same amount, page after page (one page numbered twice, or skipped,
    // throws every page after it off): said once.
    if (type === 'value' && ps.length > 3 && ps.every((p) => p.diff !== undefined)) {
      const runs: Problem[][] = []
      for (const p of ps) {
        const run = runs.at(-1)
        const last = run?.at(-1)
        if (run && last && last.diff === p.diff && p.page === last.page! + 1) run.push(p)
        else runs.push([p])
      }
      if (runs.length <= 3)
        return runs.map((run) =>
          run.length === 1
            ? run[0].text
            : `${pagesText(run.map((p) => p.page!))}: the page numbers are ${Math.abs(run[0].diff!)} ${run[0].diff! < 0 ? 'behind' : 'ahead'} (${run[0].text})`,
        )
    }
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

/** The problems of a footer audit are all for the student to look at, not sure faults: a title
 *  spelled a little differently, or one a font printed with wrong letters. */
export const lookOnly = (problems: Problem[]) =>
  problems.length > 0 && problems.every((p) => p.type === 'typo' || p.type === 'garbled')

/** The message for pages whose footers could not be read (no text layer, printed over itself, or
 *  wrong glyphs for the number). */
export function unreadNote(problems: Problem[]): string {
  const pages = pagesText(problems.map((p) => p.page!))
  const what = problems.every((p) => p.type === 'overlap')
    ? 'have a footer that prints over itself'
    : problems.some((p) => p.text.includes('no text layer'))
      ? 'have no text layer (a picture or drawn letters)'
      : 'have a footer whose page number is printed in letters that could not be read'
  return `${pages} ${what}, so their page numbers could not be read. Check them yourself.`
}

/** What to tell when `lookOnly`: a misspelt title, or one the font printed with wrong letters. */
export const lookNote = (problems: Problem[]) =>
  problems.some((p) => p.type === 'garbled')
    ? 'The title in the footers differs from the others only in letters the font printed wrongly, so it could not be compared. Check it yourself.'
    : 'The title in the footers is spelled differently from the title page. Check it.'
