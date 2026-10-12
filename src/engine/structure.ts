// Finds the parts of the manuscript by their headings, the same way for every file type: the title
// page, the permission and acceptance pages, the other preliminary pages, the chapters, the
// references and the appendices. Table of contents entries (a title then a page number) never count.
import type { Doc, Para } from './model.ts'
import { fromRoman, isUpper, norm, roman } from './text.ts'

/** Paragraph indices [start, end). */
export interface Range {
  start: number
  end: number
}
export interface Heading extends Range {
  heading: number
}
export type PrelimKey = 'bio' | 'ack' | 'dedication' | 'toc' | 'tables' | 'figures' | 'abstract'
export interface Prelim extends Heading {
  key: PrelimKey
}
export interface Chapter extends Heading {
  /** As written, e.g. "Chapter I". */
  label: string
  numeral: string
  number?: number
  /** Title written on the label's own line ("Chapter I: Introduction"). */
  inlineTitle?: string
  /** The paragraph that holds the chapter title, when it has its own line: the label's own
   *  paragraph when the title follows a line break in it ("Chapter I", Shift+Enter, "INTRODUCTION"). */
  titlePara?: number
  /** Found by its title ("I. INTRODUCTION", "INTRODUCTION") for want of a "Chapter I" label. */
  unlabelled?: boolean
}
export interface Appendix extends Heading {
  label: string
  /** "A", "B", "1"... */
  mark?: string
}
export interface Structure {
  title: Range
  permission?: Heading
  acceptance?: Heading
  prelims: Prelim[]
  chapters: Chapter[]
  references?: Heading
  /** How many chapters (or numbered sections) the table of contents lists. */
  listedChapters?: number
  appendicesHeading?: number
  appendices: Appendix[]
}

export const PRELIM_NAMES: Record<PrelimKey, string> = {
  bio: 'Biographical Sketch',
  ack: 'Acknowledgment',
  dedication: 'Dedication',
  toc: 'Table of Contents',
  tables: 'List of Tables',
  figures: 'List of Figures',
  abstract: 'Abstract',
}

const PRELIMS: [PrelimKey, RegExp][] = [
  [
    'bio',
    /^(biographical sketch|bio-?sketch|biography|curriculum vitae|about the (author|researcher))$/i,
  ],
  ['ack', /^acknowledge?ments?$/i],
  ['dedication', /^dedications?$/i],
  ['toc', /^(table of contents?|contents)$/i],
  // (a list's heading is often miswritten: "LISTS OF FIGURES", "List of Table", "LIST OF TABLE/S")
  ['tables', /^lists? of tables?(\/s)?( and (figures?|illustrations?))?$/i],
  [
    'figures',
    /^lists? of (figures?|illustrations?)(\/s)?$|^lists? of tables?(\/s)? and (figures?|illustrations?)$/i,
  ],
  ['abstract', /^(research |executive )?abstract$/i],
]

export const LIST_HEADING =
  /^lists? of (tables?|figures?|illustrations?)(\/s)?( and (figures?|illustrations?))?$/i
/** The template's own spelling of the list headings: any other is a slip for the student to look at. */
export const LIST_HEADING_EXACT =
  /^list of (tables|figures|illustrations)( and (figures|illustrations))?$/i

/** A table of contents line: a title, then a page number after a tab, dot leaders or spaces. */
const TOC_ENTRY = /(\t|\.{3,}|…|\s{2,})\s*([ivxlcdm]+|\d+(\s*[-–]\s*\d+)?)\s*$/i
/** A table-of-contents line: text, then a leader or gap, then a page number at the end. Only the
 *  tail is tested: the pattern is anchored there, and a long run of spaces would otherwise make it
 *  backtrack for minutes. */
export const isTocLine = (text: string) => TOC_ENTRY.test(text.slice(-256))

const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const CHAPTER =
  /^chapter\s+([ivxlcdm]+|\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b\.?\s*[:.\-–—]?\s*(.*)$/i
/** A chapter's title, standing alone or after its numeral ("I. INTRODUCTION"). */
const CHAPTER_TITLE =
  /^(introduction|(review of )?(related )?(literature|studies)|(research )?methodology|methods?|(presentation, )?(results?|analysis|findings)\b.*|discussion|(summary,? )?conclusions?\b.*|summary\b.*|recommendations)$/i
// ("II . REVIEW…": a space may stand before the period)
const NUMBERED_TITLE = /^([ivxlc]+|\d{1,2})\s*[.)]\s+(\S.*)$/i
const APPENDIX =
  /^(appendix|appendices|appendixes|annex|annexes)(?:\s+([ivx]{3,5}|[a-z]{1,2}\d?|\d{1,2}[a-z]?)\b)?[\s.:–—-]*(.*)$/i
/** A reference list's heading, under any of its names, with the number of a numbered section
 *  ("XII. REFERENCES"). */
const REFERENCES =
  /^(?:([ivxlc]+|\d{1,2})\s*[.)]\s*)?(references?|reference list|bibliography|literature cited|works cited|references cited|cited references)$/i
/** What follows the references and is not one of them. */
const GLOSSARY = /^(glossary( of terms)?|list of abbreviations|abbreviations)$/i

export const bolded = (p: Para) => {
  let all = 0
  let bold = 0
  for (const r of p.runs) {
    const n = r.text.replace(/\s/g, '').length
    all += n
    if (r.bold) bold += n
  }
  return all > 0 && bold / all >= 0.6
}

/** Text of a paragraph as a heading: its first line, without trailing colon or period. */
export const headingText = (p: Para) =>
  norm(p.text.split('\n')[0])
    .replace(/[:.]\s*$/, '')
    .trim()

export function isHeadingish(p: Para): boolean {
  const t = norm(p.text)
  if (!t || t.length > 120 || isTocLine(p.text) || p.inTable) return false
  // Without formatting to go by, a short line that is not a sentence may be a heading.
  if (p.plain) return t.length <= 60 && !/[.,;]$/.test(t)
  return bolded(p) || p.align === 'center' || !!p.newPage || /heading|title/i.test(p.style ?? '')
}

export const nonEmpty = (p: Para) => norm(p.text) !== '' || !!p.image

/** First paragraph at or after `i` that has text, within `end`. */
export function nextText(paras: Para[], i: number, end = paras.length): number | undefined {
  for (let k = i; k < end; k++) if (norm(paras[k].text)) return k
  return undefined
}

/** The title page's first line (anchored: the permission page grants rights to the university). */
const UP = /^university of the philippines\b/i

/** The title page's first line: the university's name, with no more than a short heading above
 *  it on its page (a cover page may set the name down the page, under the title). */
const isTitleHead = (doc: Doc, p: Para) => {
  if (!UP.test(norm(p.text))) return false
  if (p.page === undefined) return true
  let words = 0
  for (let k = p.i - 1; k >= 0 && doc.paras[k].page === p.page; k--)
    words += norm(doc.paras[k].text).split(' ').filter(Boolean).length
  return words <= 6
}

/** The title page's 0-based page (PDF): the page whose text opens with the university's name, or
 *  the first text after a cover page; else page 0 (a title page scanned as a picture). */
export const titlePage = (doc: Doc, s: Structure) => {
  const head = doc.paras.slice(s.title.start, s.title.end).find((p) => isTitleHead(doc, p))
  return (head ?? (s.title.start > 0 ? doc.paras[s.title.start] : undefined))?.page ?? 0
}

/** Where the page holding paragraph `i` starts. */
function pageStart(doc: Doc, i: number) {
  for (let k = i; k > 0; k--) if (doc.paras[k].newPage) return k
  return 0
}

export function findStructure(doc: Doc): Structure {
  const { paras } = doc
  const marks: { at: number; set: (end: number) => void }[] = []
  const s: Structure = {
    title: { start: 0, end: paras.length },
    prelims: [],
    chapters: [],
    appendices: [],
  }

  const stops: number[] = []
  const lists = listPages(doc)
  for (const p of paras) {
    const t = headingText(p)
    // Entries of the contents and the lists (a chapter's, the references', an appendix's) are
    // lines of a list, not headings.
    const entry = p.page !== undefined && lists.has(p.page)
    // The lists of tables and figures may stand on the contents page in plain capitals.
    // (a list's heading may stand in the middle of a page, in plain type)
    const plainList =
      LIST_HEADING.test(t) && norm(p.text).length < 45 && !p.inTable && !isTocLine(p.text)
    // An appendix's label in capitals with its title after it ("APPENDIX A. SUMMARY OF FINDINGS"),
    // set in plain type (a turned page): not mistaken for a sentence about an appendix.
    if (
      !isHeadingish(p) &&
      !plainList &&
      !entry &&
      !p.inTable &&
      p.lines?.length === 1 &&
      (s.chapters.length || s.references || s.prelims.length) &&
      /^APPENDIX\s+([A-Z]{1,2}\d?|\d{1,2})\s*[.:]\s+\S/.test(p.text) &&
      !/[a-z]{3}/.test(p.text.slice(0, 60))
    ) {
      s.appendices.push({
        heading: p.i,
        start: p.i,
        end: paras.length,
        label: t,
        mark: /^APPENDIX\s+(\S+?)\s*[.:]/.exec(p.text)?.[1],
      })
      continue
    }
    if (!isHeadingish(p) && !plainList) continue
    if (!s.permission && /^(university )?permission page$/i.test(t)) {
      s.permission = { heading: p.i, start: p.i, end: paras.length }
      continue
    }
    if (!s.acceptance && /^(acceptance|approval) (page|sheet)$/i.test(t)) {
      s.acceptance = { heading: p.i, start: p.i, end: paras.length }
      continue
    }
    const keys = PRELIMS.filter(([, re]) => re.test(t)).map(([k]) => k)
    if (keys.length && !s.chapters.length) {
      for (const key of keys) s.prelims.push({ key, heading: p.i, start: p.i, end: paras.length })
      continue
    }
    const ch = entry ? null : CHAPTER.exec(t)
    // A contents line that wrapped ends in its page number; a real chapter label is bold, centred
    // or styled as a heading, or at least short and opening a page.
    const styled = bolded(p) || p.align === 'center' || /heading|title/i.test(p.style ?? '')
    const tocLike = /\s(\d+|[ivxlc]+)$/i.test(ch?.[2] ?? '')
    if (ch && t.length <= 90 && !tocLike && (styled || (p.newPage && t.length <= 40))) {
      const numeral = ch[1]
      const word = NUMBER_WORDS.indexOf(numeral.toLowerCase())
      s.chapters.push({
        heading: p.i,
        start: p.i,
        end: paras.length,
        label: t.slice(0, t.length - ch[2].length).replace(/[\s:.\-–—]+$/, ''),
        numeral,
        number: word >= 0 ? word + 1 : /^\d+$/.test(numeral) ? +numeral : fromRoman(numeral),
        inlineTitle: ch[2] || undefined,
      })
      continue
    }
    if (entry) continue
    if (!s.references && (s.chapters.length || s.prelims.length)) {
      if (REFERENCES.test(t)) {
        s.references = { heading: p.i, start: p.i, end: paras.length }
        continue
      }
    }
    // A glossary after the references is not part of the list.
    // (the title of an appendix, on the line under its label, is no glossary after the list)
    const lastAp = s.appendices.at(-1)
    const titled = !!lastAp && !paras.slice(lastAp.heading + 1, p.i).some((q) => q.text.trim())
    if (s.references && GLOSSARY.test(t) && !titled) {
      stops.push(p.i)
      continue
    }
    // (appendices may stand before the references, so the front matter having been read is enough)
    if (s.chapters.length || s.references || s.prelims.length) {
      // (a numbered section "VIII. APPENDICES" too)
      if (/^(?:(?:[ivxlc]+|\d{1,2})\s*[.)]\s*)?(appendices|appendixes|annexes)$/i.test(t)) {
        s.appendicesHeading ??= p.i
        continue
      }
      const ap = APPENDIX.exec(t)
      // ("Annex Table 3." is a table's caption in an annex, not an appendix's label)
      // (a table's header row of a list of appendices — "APPENDIX", "Description", "Page" — is not one)
      if (
        ap &&
        t.length <= 100 &&
        !/^(table|fig(ure|\.)?)\s*\d/i.test(ap[3]) &&
        !(p.text.includes('\t') && !ap[2] && ap[3])
      )
        s.appendices.push({ heading: p.i, start: p.i, end: paras.length, label: t, mark: ap[2] })
    }
  }

  findUnlabelled(doc, s, lists)
  s.listedChapters = listedChapters(doc)

  // Pages found by their wording when the heading is missing.
  const find = (re: RegExp, from = 0) =>
    paras.findIndex((p) => p.i >= from && re.test(norm(p.text)))
  if (!s.permission) {
    const k = find(
      /I hereby grant the University of the Philippines|Specifically, I grant|I specifically allow/i,
    )
    if (k > 0)
      s.permission = { heading: pageStart(doc, k), start: pageStart(doc, k), end: paras.length }
  }
  if (!s.acceptance) {
    const k = find(
      /\b(paper|thesis|dissertation|study|manuscript|special problem|special project|capstone project) (prepared|written|entitled)\b.*\bby\b|is hereby accepted/i,
    )
    if (k > 0)
      s.acceptance = { heading: pageStart(doc, k), start: pageStart(doc, k), end: paras.length }
  }

  // Each part runs to the next landmark.
  const add = (at: number | undefined, set: (end: number) => void) => {
    if (at !== undefined) marks.push({ at, set })
  }
  add(s.permission?.start, (e) => s.permission && (s.permission.end = e))
  add(s.acceptance?.start, (e) => s.acceptance && (s.acceptance.end = e))
  for (const x of s.prelims) add(x.start, (e) => (x.end = e))
  for (const x of s.chapters) add(x.start, (e) => (x.end = e))
  add(s.references?.start, (e) => s.references && (s.references.end = e))
  add(s.appendicesHeading, () => {})
  for (const at of stops) add(at, () => {})
  for (const x of s.appendices) add(x.start, (e) => (x.end = e))
  marks.sort((a, b) => a.at - b.at)
  for (let k = 0; k < marks.length; k++) {
    const next = marks.slice(k + 1).find((m) => m.at > marks[k].at)
    marks[k].set(next ? next.at : paras.length)
  }
  // Two keys on one heading ("List of Tables and Figures") share a range.
  for (const x of s.prelims) {
    const twin = s.prelims.find((y) => y !== x && y.heading === x.heading)
    if (twin) x.end = twin.end = Math.max(x.end, twin.end)
  }

  const firstMark = marks[0]?.at
  if (firstMark !== undefined && firstMark > 0) s.title.end = firstMark
  else {
    const next = paras.findIndex((p) => p.i > 0 && p.newPage)
    s.title.end = next > 0 ? next : paras.length
  }
  // A cover page before the title page is not part of it: the title page opens with the university.
  const up = paras.findIndex((p) => p.i < s.title.end && isTitleHead(doc, p))
  if (up > 0) s.title.start = pageStart(doc, up)

  for (const ch of s.chapters) {
    if (ch.inlineTitle || ch.unlabelled) continue
    // The title under the label after a line break, in the same paragraph.
    if (norm(paras[ch.heading].text.split('\n').slice(1).join(' '))) {
      ch.titlePara = ch.heading
      continue
    }
    const k = nextText(paras, ch.heading + 1, ch.end)
    if (
      k !== undefined &&
      norm(paras[k].text).length <= 120 &&
      isHeadingish(paras[k]) &&
      !CHAPTER.test(norm(paras[k].text))
    )
      ch.titlePara = k
  }
  return s
}

/** PDF pages of the contents and of the lists of tables and figures: from the page of such a
 *  heading, the pages that go on with entries (a title, then a page number). */
function listPages(doc: Doc): Set<number> {
  const entries = new Map<number, number>()
  for (const p of doc.paras)
    if (p.page !== undefined && isTocLine(p.text))
      entries.set(p.page, (entries.get(p.page) ?? 0) + 1)
  const out = new Set<number>()
  for (const p of doc.paras) {
    const t = headingText(p)
    const list = PRELIMS.some(
      ([k, re]) => (k === 'toc' || k === 'tables' || k === 'figures') && re.test(t),
    )
    if (p.page === undefined || !(list || LIST_HEADING.test(t)) || !(isHeadingish(p) || isUpper(t)))
      continue
    out.add(p.page)
    for (let pg = p.page; (entries.get(pg) ?? 0) >= 3; pg++) out.add(pg)
  }
  return out
}

const letters = (t: string) => t.toLowerCase().replace(/[^a-z]/g, '')

/** Front and back matter, which a contents lists beside the chapters. */
const NOT_CHAPTER = new RegExp(
  '^(acceptance|approval|permission|biograph|bio-?sketch|curriculum|acknowledge?ment|dedication|abstract|table of contents?|contents|lists?\\s+of|references?\\b|reference list|bibliography|literature cited|works cited|cited references|appendi|annex|glossary|declaration)',
  'i',
)

/** The sections the contents lists as chapters: "Chapter IV …" lines, else numbered sections in
 *  capitals ("IV. METHODS …"); the numbered lists of the front matter and the references are not
 *  chapters. */
function tocChapters(doc: Doc): { numeral: string; key: string }[] {
  const labelled: { numeral: string; key: string }[] = []
  const numbered: { numeral: string; key: string }[] = []
  // Roman numerals in sequence before titles in any case ("I. Introduction"): chapters as well.
  const cased: { numeral: string; key: string; n: number }[] = []
  for (const p of doc.paras) {
    if (!isTocLine(p.text) || p.page === undefined) continue
    const t = norm(p.text.replace(TOC_ENTRY, ''))
    const c = CHAPTER.exec(t)
    if (c) {
      if (!NOT_CHAPTER.test(c[2].trim()))
        labelled.push({ numeral: c[1].toLowerCase(), key: letters(c[2]) })
      continue
    }
    const m = NUMBERED_TITLE.exec(t)
    if (!m || NOT_CHAPTER.test(m[2])) continue
    // (a lettered section, "C.", is no Roman numeral of a chapter)
    const n = /^\d+$/.test(m[1]) ? +m[1] : fromRoman(m[1])
    if (n === undefined || n > 40) continue
    const e = { numeral: m[1].toLowerCase(), key: letters(m[2]), n }
    if (isUpper(m[2])) numbered.push(e)
    else if (!/^\d+$/.test(m[1]) && m[1] === m[1].toUpperCase()) cased.push(e)
  }
  const sequence = [1, 2, 3].every((k) => cased.some((e) => e.n === k))
  const found =
    labelled.length >= 2 ? labelled : numbered.length >= 2 ? numbered : sequence ? cased : []
  return found.length >= 2 ? found : []
}

/** How many chapters the contents lists. */
const listedChapters = (doc: Doc) => new Set(tocChapters(doc).map((c) => c.numeral)).size

/** Chapters headed by their title alone, after the front matter and before the first labelled
 *  chapter ("I. INTRODUCTION", "REVIEW OF RELATED LITERATURE" opening a page): found for the
 *  ranges' sake; the missing label is still the student's to fix. */
function findUnlabelled(doc: Doc, s: Structure, lists: Set<number>) {
  const { paras } = doc
  const front = Math.max(
    s.permission?.heading ?? -1,
    s.acceptance?.heading ?? -1,
    ...s.prelims.map((x) => x.heading),
  )
  if (front < 0) return
  const stop = Math.min(
    s.chapters[0]?.heading ?? paras.length,
    s.references?.heading ?? paras.length,
    s.appendicesHeading ?? paras.length,
    s.appendices[0]?.heading ?? paras.length,
  )
  const listed = tocChapters(doc).map((c) => c.key)
  const found: Chapter[] = []
  for (let k = front + 1; k < stop; k++) {
    const p = paras[k]
    if (!isHeadingish(p)) continue
    const opens = p.newPage || p.renderedBreak === 'before'
    const t = headingText(p)
    const m = NUMBERED_TITLE.exec(t)
    const title = m ? m[2] : t
    // A title in capitals, as the template sets chapter titles (a subheading in title case is
    // not one), after its numeral in sequence or opening a page.
    const given = m ? (/^\d+$/.test(m[1]) ? +m[1] : fromRoman(m[1])) : undefined
    // A numeral must be the next in sequence ("C." heads a lettered section, not chapter 100).
    const number = found.length + 1
    const named = CHAPTER_TITLE.test(title.toLowerCase())
    // The contents lists it as a numbered section: it is one, wherever it stands and whatever
    // numeral it carries (a typo repeats one).
    const key = letters(title)
    const inToc =
      !!m &&
      key.length >= 5 &&
      (given ?? 99) <= 40 &&
      listed.some((t) => t.startsWith(key) || key.startsWith(t))
    if (
      !(isUpper(title) || inToc) ||
      !(m ? (given === number || inToc) && (opens || named || inToc) : opens && named)
    )
      continue
    // Contents entries have the next entries after them, not text (a heading the contents lists,
    // off the contents' own pages, may be followed by tables and subheadings only).
    const prose = paras
      .slice(k + 1, k + 12)
      .some((q) => norm(q.text).length > 80 && !isTocLine(q.text) && !q.inTable)
    if (!prose && !(inToc && !(p.page !== undefined && lists.has(p.page)))) continue
    found.push({
      heading: k,
      start: k,
      end: paras.length,
      label: t,
      numeral: m && given ? m[1].toUpperCase() : roman(number).toUpperCase(),
      number: given ?? number,
      ...(m ? { inlineTitle: title } : { titlePara: k }),
      unlabelled: true,
    })
  }
  s.chapters.unshift(...found)
}
