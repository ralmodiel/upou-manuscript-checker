// Finds the parts of the manuscript by their headings, the same way for every file type: the title
// page, the permission and acceptance pages, the other preliminary pages, the chapters, the
// references and the appendices. Table of contents entries (a title then a page number) never count.
import type { Doc, Para } from './model.ts'
import { fromRoman, norm } from './text.ts'

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
  ['tables', /^list of tables( and (figures|illustrations))?$/i],
  ['figures', /^list of (figures|illustrations)$|^list of tables and (figures|illustrations)$/i],
  ['abstract', /^abstract$/i],
]

/** A table of contents line: a title, then a page number after a tab, dot leaders or spaces. */
const TOC_ENTRY = /(\t|\.{3,}|…|\s{2,})\s*([ivxlcdm]+|\d+)\s*$/i
/** A table-of-contents line: text, then a leader or gap, then a page number at the end. Only the
 *  tail is tested: the pattern is anchored there, and a long run of spaces would otherwise make it
 *  backtrack for minutes. */
export const isTocLine = (text: string) => TOC_ENTRY.test(text.slice(-256))

const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const CHAPTER =
  /^chapter\s+([ivxlcdm]+|\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b\.?\s*[:.\-–—]?\s*(.*)$/i
const APPENDIX = /^(appendix|annex)(?:\s+([a-z]{1,2}|\d{1,2})\b)?[\s.:–—-]*(.*)$/i

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

/** The title page's 0-based page (PDF): the page whose text opens with the university's name, or
 *  the first text after a cover page; else page 0 (a title page scanned as a picture). */
export const titlePage = (doc: Doc, s: Structure) => {
  const head = doc.paras.slice(s.title.start, s.title.end).find((p) => UP.test(norm(p.text)))
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

  for (const p of paras) {
    if (!isHeadingish(p)) continue
    const t = headingText(p)
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
    const ch = CHAPTER.exec(t)
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
    if (!s.references && (s.chapters.length || s.prelims.length)) {
      if (/^(references?|reference list|bibliography|literature cited|works cited)$/i.test(t)) {
        s.references = { heading: p.i, start: p.i, end: paras.length }
        continue
      }
    }
    if (s.chapters.length || s.references) {
      if (/^(appendices|appendixes|annexes)$/i.test(t)) {
        s.appendicesHeading ??= p.i
        continue
      }
      const ap = APPENDIX.exec(t)
      if (ap && t.length <= 100)
        s.appendices.push({ heading: p.i, start: p.i, end: paras.length, label: t, mark: ap[2] })
    }
  }

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
      /\b(paper|thesis|dissertation|study|manuscript) (prepared|written|entitled)\b.*\bby\b|is hereby accepted/i,
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
  const up = paras.findIndex((p) => p.i < s.title.end && UP.test(norm(p.text)))
  if (up > 0) s.title.start = pageStart(doc, up)

  for (const ch of s.chapters) {
    if (ch.inlineTitle) continue
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
