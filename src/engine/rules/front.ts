// Title Page, University Permission Page and Acceptance Page.
import type { Box, Doc, Para } from '../model.ts'
import { CHECKLIST } from '../checklist.ts'
import { colourfulness, dHash, hamming, shrink } from '../images.ts'
import { fix, na, ok, review, worst, type Ctx, type Finding, type Where } from '../report.ts'
import { titlePage } from '../structure.ts'
import {
  DATE,
  distance,
  garbled,
  readsOddly,
  isUpper,
  list,
  lowerWords,
  norm,
  plural,
  quote,
  roman,
  shown,
  titleForm,
  titleLoose,
  wordDiff,
} from '../text.ts'
import {
  againstTitle,
  garbledVariant,
  judge,
  lookOnly,
  mainTitle,
  pagesText,
  pdfFolio,
  titleKey,
  wordFolioAt,
  type Problem,
  type Want,
} from './numbering.ts'

// The UP seal in the template: its file's SHA-256 and its difference hash (scripts/probe/seal-hash.mjs).
export const SEAL_SHA256 = '1d89b4e2dbe46ea14a34faeeeb4a0fc18999438b12c4fae9bc8ac66abf6ae8c9'
export const SEAL_DHASH = '0e1f2b333313170e'

const at = (p: Para | undefined): Where[] => (p ? [{ page: p.page, quote: quote(p.text) }] : [])

const textIn = (ctx: Ctx, start: number, end: number) =>
  ctx.doc.paras.slice(start, end).filter((p) => norm(p.text))

const find = (paras: Para[], re: RegExp) => paras.find((p) => re.test(norm(p.text)))

// ---- The title page, read once ----

export interface TitlePage {
  paras: Para[]
  /** 0-based page of the title page (PDF; 0 for other files). */
  page: number
  /** The first text before the title page (a cover page). */
  cover?: Para
  /** A page with a picture and no text before the title page (a cover page scanned in). */
  coverPage?: number
  program?: Para
  author?: Para
  /** The author's name when it stands above the degree program, against the template's order. */
  authorAbove?: Para
  title: Para[]
  adviserLabel?: Para
  adviser?: Para
  faculty?: Para
  date?: Para
  permissionText?: Para
  rows: Para[]
  /** The permission table is a picture (PDF): no row is text, so none could be read. */
  tablePicture?: boolean
  /** The permission statement is not text but a wide picture on the page. */
  statementPicture?: boolean
  studentSig?: Para
  adviserSig?: Para
  /** What the manuscript is ("Thesis", "Dissertation", "Special Problem"…): the words before
   *  "Adviser", else what the degree suggests. */
  work: string
  /** The adviser's label as the page words it ("Thesis Adviser", "Adviser", "Special Problem
   *  Faculty-in-Charge"), else what the template would say. */
  role: string
}

/** A student number under the author's name ("MDE 2020-12345"). */
const STUDENT_NUMBER = /^(?:[A-Z]{1,6}[ -]?)?\d{4}(?:[- ]\d{1,6}[a-z]?){1,2}$/
/** A year line under the title ("ACADEMIC YEAR 2023-2024"). */
const ACADEMIC_YEAR = /^academic year\b/i

/** A PDF paragraph whose lines stand over 1.8 lines apart (a degree program, then the author's
 *  name, set one under the other in a block) is several paragraphs. */
function splitApart(paras: Para[]): Para[] {
  return paras.flatMap((p) => {
    const ls = p.lines
    if (!ls || ls.length < 2) return [p]
    const cuts = [0]
    for (let k = 1; k < ls.length; k++)
      if (ls[k].page === ls[k - 1].page && ls[k].y - ls[k - 1].y > 1.8 * ls[k].size) cuts.push(k)
    if (cuts.length === 1) return [p]
    cuts.push(ls.length)
    return cuts.slice(0, -1).map((c, j) => {
      const part = ls.slice(c, cuts[j + 1])
      return {
        ...p,
        text: part.map((l) => l.text).join(' '),
        runs: part.flatMap((l, k) => [
          ...(k ? [{ text: ' ' }] : []),
          ...l.runs.map((r) => ({ ...r })),
        ]),
        lines: part,
      }
    })
  })
}

// A row of the permission table: its code's name, then "(I)" or the Yes and No words ("Free", with
// no letter, and "Confidential I" are slips of the writer's).
const TABLE_ROW = /^(invention|publication|confidential|free)\b/i
const isRow = (p: Para) =>
  TABLE_ROW.test(norm(p.text)) &&
  (/^\w+\s*\(/.test(norm(p.text)) || /(yes|no)\b/i.test(norm(p.text)) || p.text.includes('\t'))
const ROW_LETTER: Record<string, string> = {
  invention: 'I',
  publication: 'P',
  confidential: 'C',
  free: 'F',
}
// UPOU's style guide (OVCAA 2017-4, 2022) covers every level: a bachelor's special or capstone
// project, a master's capstone project, special problem or thesis, a doctoral dissertation. The
// title page names it before "Adviser:" and gives the degree ("Master in …", "Diploma in …" too).
const WORK =
  'thesis|dissertation|special problem|special project|capstone project|capstone|research paper|project paper|project'
// A special problem's adviser is its "Faculty-in-Charge".
// ("FIC" for the faculty-in-charge; two advisers: "Thesis Advisers:")
const ROLE = 'advis[eo]rs?|faculty[- ]in[- ]charge|fic'
// Other programs name it otherwise ("Research Adviser:", "Special/Capstone Project Adviser:",
// "MMS 200 Adviser:", or only "Adviser:"): up to three words before it, then a colon.
const ADVISER_LABEL = new RegExp(
  `^(?:(?:${WORK}) (?:${ROLE})\\b|(?:[\\p{L}\\d][\\p{L}\\d/.'’]*[ -]){0,3}(?:${ROLE})\\s*:)(?!'?s?\\s*signature)`,
  'iu',
)
// "Permission of the classification…", or the older template's "Permission is given for the
// following people…".
const PERMISSION_TEXT =
  /permission of the classification|permission is given (?:for|to) the following/i
const SIGNATURE_OF = new RegExp(`\\b(?:${ROLE})'?s?\\s+signature`, 'i')
const SIGNATURE_BARE = new RegExp(`\\b(?:${ROLE})\\s+signature`, 'i')
// Another program's wording: "Signature of Special Problem Adviser".
const SIGNATURE_VARIANT = new RegExp(
  `signature of (?:the )?(?:[\\p{L}\\d-]+[ /]){0,4}(?:${ROLE})\\b`,
  'iu',
)
const SIGNATURE_ANY = new RegExp(`${SIGNATURE_OF.source}|${SIGNATURE_VARIANT.source}`, 'iu')
const PROGRAM =
  /^(associate|bachelor|master|doctor) (of|in)\b|^(diploma|graduate certificate|professional teaching certificate|certificate) in\b/i
// UPOU's three faculties.
const FACULTY =
  /faculty of (information and communication studies|management and development studies|education)\b/i

// The checklist (the MDC program's copy) asks for the title in upper case; UPOU's style guide
// (2022) shows it in title case. Outside MDC, a title not in upper case is for the student to check.
const upperRule = (tp: TitlePage) => /development communication/i.test(norm(tp.program?.text ?? ''))
const CASE_NOTE =
  "The format checklist (the MDC program's copy) asks for upper case; UPOU's style guide (2022) shows the title in title case. Follow your program's template."

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s/-])[a-z]/g, (c) => c.toUpperCase())
/** The manuscript as the adviser label names it, else as the degree suggests. */
function workOf(label?: Para, program?: Para): string {
  const named = new RegExp(`^(${WORK}|(?:[a-z]+ ){0,2}[a-z]+(?= advis[eo]r\\s*:))\\b`, 'i').exec(
    norm(label?.text ?? ''),
  )?.[1]
  if (named) return titleCase(named)
  const degree = norm(program?.text ?? '')
  if (/^doctor (of|in)/i.test(degree)) return 'Dissertation'
  return /^(associate|bachelor) (of|in)/i.test(degree) ? 'Special Project' : 'Thesis'
}

/** PDF pages before the other preliminary pages that hold a picture and no text, or a picture over
 *  much of the page (the text layer left is a stub or a scan's guesses): signed pages scanned back
 *  in, which cannot be read. */
function scannedFront(ctx: Ctx): number[] {
  const { doc, s } = ctx
  if (doc.kind !== 'pdf' || !doc.pages) return []
  const first = s.prelims[0] ?? s.chapters[0]
  const end = first ? (doc.paras[first.heading].page ?? 3) : 3
  return doc.pages
    .slice(0, end)
    .filter(
      (pg) =>
        (!pg.paras.length && pg.images.length) ||
        pg.images.some((b) => (b.x1 - b.x0) * (b.y1 - b.y0) >= 0.4 * pg.width * pg.height),
    )
    .map((pg) => pg.n)
}

export function readTitlePage(ctx: Ctx): TitlePage {
  const { start, end } = ctx.s.title
  const page = titlePage(ctx.doc, ctx.s)
  // A scanned title page has no text: what comes after it is not the title page.
  // (a stray "Title Page" heading is no part of the page)
  const paras = scannedFront(ctx).includes(page)
    ? []
    : splitApart(textIn(ctx, start, end)).filter((p) => !/^title page$/i.test(norm(p.text)))
  const idx = (p?: Para) => (p ? paras.indexOf(p) : -1)
  const program =
    find(paras, PROGRAM) ?? find(paras, /(associate|bachelor|master|doctor) (of|in)|program/i)
  const adviserLabel = find(paras, ADVISER_LABEL)
  const work = workOf(adviserLabel, program)
  const faculty =
    paras.find((p, k) => k > idx(adviserLabel) && FACULTY.test(norm(p.text))) ??
    // (a faculty the template does not list: the line is still the faculty's)
    paras.find((p, k) => k > idx(adviserLabel) && /^faculty of [a-z]/i.test(norm(p.text)))
  const permissionText = find(paras, PERMISSION_TEXT)
  // The major under the degree program, in parentheses on a line of its own, belongs to it.
  let from = idx(program) + 1
  // The rest of a degree's name on a second line, set tight under the first ("…NATURAL RESOURCES"
  // / "MANAGEMENT"): a single word, where a name takes two or more.
  const tight = (q?: Para, above?: Para) => {
    const a = above?.lines?.at(-1)
    const b = q?.lines?.[0]
    return !!a && !!b && a.page === b.page && b.y - a.y <= 1.5 * b.size
  }
  while (
    paras[from] &&
    (/^\(.*\)$/.test(norm(paras[from].text)) ||
      (tight(paras[from], paras[from - 1]) &&
        norm(paras[from].text).split(' ').length === 1 &&
        isUpper(norm(paras[from].text))))
  )
    from++
  // Between the program and "Thesis Adviser:": the author, then the title (one or more lines).
  const between = paras.slice(from, adviserLabel ? idx(adviserLabel) : from + 2)
  // A report's labelled lines ("OJT Host Institution:", then its answer) stand between the title
  // and the adviser: lines of the page, not of the title.
  const labelled = new Set<Para>()
  for (const [k, q] of between.entries())
    if (k > 1 && /:\s*$/.test(norm(q.text)) && norm(q.text).split(' ').length <= 4) {
      labelled.add(q)
      if (between[k + 1]) labelled.add(between[k + 1])
    }
  // Between the university's name and the program there is nothing; a short line there is the
  // author's name, put above the program (a heading such as "Title Page" stands above the university).
  const univ = Math.max(
    -1,
    ...paras.map((p, k) =>
      /^(university of the philippines|open university)\b/i.test(norm(p.text)) ? k : -1,
    ),
  )
  const authorAbove =
    univ >= 0 && idx(program) > univ + 1
      ? paras.slice(univ + 1, idx(program)).find((p) => norm(p.text).split(' ').length <= 8)
      : undefined
  // A copy without the author's name has the title's first line where the name stands: a line the
  // permission page repeats at its top is the title's.
  const top = (ctx.doc.pages?.slice(page + 1, page + 2) ?? [])
    .flatMap((pg) => pg.paras.slice(0, 4))
    .map((i) => norm(ctx.doc.paras[i].text).toUpperCase())
    .join(' ')
  const noAuthor =
    !authorAbove &&
    !!between[1] &&
    top.includes(norm(between[0].text + ' ' + between[1].text).toUpperCase())
  const author = authorAbove ?? (noAuthor ? undefined : between[0])
  // The student number and the academic year are lines of the page, not of the title.
  const title = (authorAbove || noAuthor ? between : between.slice(1)).filter(
    (p) =>
      !STUDENT_NUMBER.test(norm(p.text)) && !ACADEMIC_YEAR.test(norm(p.text)) && !labelled.has(p),
  )
  // "Thesis Adviser:" with the name on the same line, or on the next.
  const inline =
    adviserLabel && norm(adviserLabel.text).replace(ADVISER_LABEL, '').replace(/^\s*:/, '').trim()
  const adviser = adviserLabel ? (inline ? adviserLabel : paras[idx(adviserLabel) + 1]) : undefined
  const rows = paras.filter(isRow)
  const afterFaculty = faculty
    ? paras.slice(idx(faculty) + 1, permissionText ? idx(permissionText) : idx(faculty) + 3)
    : []
  // "Date of Submission:", the date on its line or the next.
  const dated = paras.find((p) => /^date of submission\b/i.test(norm(p.text)))
  const datedNext = dated && paras[idx(dated) + 1]
  const labelledDate = dated
    ? DATE.test(dated.text)
      ? dated
      : datedNext && DATE.test(datedNext.text)
        ? datedNext
        : undefined
    : undefined
  const date =
    afterFaculty.find((p) => DATE.test(p.text) || /day\s+month\s+year/i.test(p.text)) ??
    labelledDate ??
    afterFaculty[0]
  return {
    paras,
    page,
    cover: textIn(ctx, 0, start)[0],
    coverPage: ctx.doc.pages?.slice(0, page).find((pg) => pg.images.length)?.n,
    program,
    author,
    authorAbove,
    title: title.filter((p) => p !== adviser),
    adviserLabel,
    adviser: adviser && !/faculty of/i.test(adviser.text) ? adviser : undefined,
    faculty,
    date: date && date !== permissionText ? date : undefined,
    permissionText,
    rows,
    statementPicture:
      !permissionText &&
      !!ctx.doc.pages?.[page]?.images.some(
        (b) => b.x1 - b.x0 >= 0.5 * ctx.doc.pages![page].width && b.y1 - b.y0 >= 20,
      ),
    tablePicture:
      rows.length < 4 &&
      !!ctx.doc.pages?.[page]?.images.some(
        (b) => b.x1 - b.x0 >= 0.5 * ctx.doc.pages![page].width && b.y1 - b.y0 >= 40,
      ),
    studentSig: find(paras, /^student'?s?\s+signature/i),
    adviserSig: find(paras, SIGNATURE_ANY),
    work,
    role: adviserLabel
      ? (ADVISER_LABEL.exec(norm(adviserLabel.text))?.[0] ?? '')
          .replace(/\s*:$/, '')
          .replace(/(advis[eo]r)s$/i, '$1')
      : `${work} Adviser`,
  }
}

export const titleOf = (tp: TitlePage) => norm(tp.title.map((p) => shown(p)).join(' '))

/** The title on the title page, or '' when it cannot be read. */
export function thesisTitle(ctx: Ctx): string {
  try {
    return titleOf(readTitlePage(ctx))
  } catch {
    return ''
  }
}

/** A name line without its date column: the last line is cut at its first tab or "(date)". */
function cleanName(s: string) {
  const line = Math.max(...['\n', '\r', '\u2028', '\u2029'].map((c) => s.lastIndexOf(c))) + 1
  const date = s.slice(line).search(/\(date\)/i)
  const cuts = [s.indexOf('\t', line), date < 0 ? -1 : line + date].filter((k) => k >= line)
  return norm(cuts.length ? s.slice(0, Math.min(...cuts)) : s)
}
/** A name without titles and degrees, for comparing spellings. */
const bareName = (s: string) =>
  cleanName(s)
    .replace(/^_+/, '')
    .replace(
      /^((dr|(asst|assistant|assoc|associate)\.?\s*prof(essor)?|prof(essor)?|engr|atty|mr|ms|mrs|hon)\.?\s+)+/i,
      '',
    )
    .replace(SUFFIX_ANY, '')
    .replace(/,\s*$/, '')
    .toUpperCase()
/** The words of a name that carry its spelling: no initials, "Jr." or punctuation. */
const spelling = (s: string) =>
  bareName(s)
    .split(/[\s,.]+/)
    .filter((w) => w.length > 1 && !/^(JR|SR)$/.test(w))
    .join(' ')

// ---- Pictures and marks near a label ----

/** What signature-like sits around a label line on a PDF page: a mark (a picture, ink, a stamp,
 *  a drawn signature) or only a signature field, which may be signed or empty. */
function pdfMarkNear(ctx: Ctx, label: Para, floor?: number): 'mark' | 'field' | undefined {
  const page = ctx.doc.pages?.[label.page ?? -1]
  const line = label.lines?.[0]
  if (!page || !line) return undefined
  const zone: Box = {
    x0: line.x0 - 20,
    x1: page.width,
    y0: line.y - 4 * line.size,
    y1: line.y + 2.5 * line.size,
  }
  // The permission table's rows (and the ticks drawn on them) are above the signature: nothing
  // centred at or above the last row is the signature.
  const below = (b: Box) => floor === undefined || (b.y0 + b.y1) / 2 > floor + 3
  const inside = (b: Box) =>
    b.x1 > zone.x0 && b.x0 < zone.x1 && b.y1 > zone.y0 && b.y0 < zone.y1 && below(b)
  // A signature is wider than a letter and taller than a rule: tick boxes drawn as pictures are
  // not. Nor is a picture of the permission table (most of the page across).
  const wide = (b: Box) => b.x1 - b.x0 >= 2 * line.size
  const big = (b: Box) =>
    wide(b) && b.y1 - b.y0 >= 0.5 * line.size && b.x1 - b.x0 < 0.6 * page.width
  // A picture a white shape was painted over afterwards (a signature taken out) shows nothing.
  const white = (m: { fill?: string }) => !!m.fill && /^#f[a-f]f[a-f]f[a-f]$/i.test(m.fill)
  const covered = (b: Box & { z?: number }) =>
    b.z !== undefined &&
    page.marks.some(
      (m) =>
        m.kind === 'path' &&
        white(m) &&
        m.z !== undefined &&
        m.z > b.z! &&
        Math.min(m.x1, b.x1) - Math.max(m.x0, b.x0) >= 0.85 * (b.x1 - b.x0) &&
        Math.min(m.y1, b.y1) - Math.max(m.y0, b.y0) >= 0.85 * (b.y1 - b.y0),
    )
  if (page.images.some((b) => inside(b) && big(b) && !covered(b))) return 'mark'
  const near = page.marks.filter(inside)
  // Ink, stamps and text boxes count; so do drawn strokes as large as a signature (a rectangle is
  // a frame or a tick box, not a stroke): neither a rule nor a white box laid over a signature
  // taken out, nor a frame across the page. A line annotation is a tick or an arrow, a popup the
  // note of another annotation, a square or a highlight a box laid on the page.
  const scrawl = (m: (typeof near)[number]) =>
    wide(m) &&
    m.x1 - m.x0 < 0.6 * page.width &&
    m.y1 - m.y0 >= 1.5 * line.size &&
    m.y1 - m.y0 < 10 * line.size &&
    (m.count ?? 0) >= 20 &&
    !white(m)
  if (
    near.some((m) =>
      m.kind === 'path' ? scrawl(m) : /^(Ink|Stamp|FreeText|FileAttachment)$/.test(m.kind),
    )
  )
    return 'mark'
  // pdf.js does not tell a signed signature field from an empty one.
  return near.some((m) => m.kind === 'Widget:Sig') ? 'field' : undefined
}

/** A picture anchored within a couple of paragraphs of a label (Word). */
const wordPictureNear = (ctx: Ctx, label: Para) =>
  ctx.doc.pictures.some((pic) => Math.abs(pic.para - label.i) <= 3)

// ---- Title Page ----

/** The seal check, and whether the picture is another emblem of the university (the seal with its
 *  wordmark or a wreath: coloured, not the template's seal), which may carry the name in it. */
async function seal(ctx: Ctx, tp: TitlePage): Promise<{ finding: Finding; emblem: boolean }> {
  const id = 'title.seal'
  const only = (finding: Finding, emblem = false) => ({ finding, emblem })
  const { doc, s } = ctx
  const pic =
    doc.kind === 'pdf'
      ? doc.pictures.find((p) => p.para === -1 && (p.page ?? 0) === tp.page)
      : doc.pictures.find((p) => p.para >= s.title.start && p.para < s.title.end)
  if (!pic) return only(fix(id, 'Add the official UP seal at the top of the title page.'))
  let pixels = await pic.pixels?.()
  const bytes = pic.bytes?.()
  if (bytes && typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))
    const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
    if (hex === SEAL_SHA256)
      return only(ok(id, 'The official UP seal from the template is on the title page.'))
  }
  if (!pixels && bytes && ctx.env.decodeImage) pixels = await ctx.env.decodeImage(bytes)
  if (!pixels)
    return only(
      review(
        id,
        'Make sure the picture on the title page is the official UP seal (copy it from the template).',
      ),
    )
  const small = shrink(pixels, 64)
  const d = hamming(dHash(small), SEAL_DHASH)
  const colour = colourfulness(small)
  if (d <= 12 && colour > 25) return only(ok(id, 'The official UP seal is on the title page.'))
  if (d <= 12)
    return only(
      review(
        id,
        'The seal on the title page looks faded or grey. Use the full-color official UP seal from the template.',
      ),
    )
  // Another emblem of the university (the seal with its wordmark, a wreath) is coloured and large;
  // whether it is the university's cannot be told from here.
  if (colour > 25 && pixels.width >= 24 && pixels.height >= 24)
    return only(
      review(
        id,
        'The picture on the title page is not the seal of the template. If it is the UP or UPOU emblem, replace it with the official UP seal (copy it from the template).',
        { where: [{ page: tp.page }] },
      ),
      true,
    )
  return only(
    fix(
      id,
      'Use the official UP seal: the picture on the title page does not look like it. Copy the seal from the template.',
      {
        where: [{ page: tp.page }],
      },
    ),
  )
}

/** The title page's parts in the template's order, named as the manuscript has them. */
const anchors = (role: TitlePage['role']): [string, RegExp][] => [
  ['UNIVERSITY OF THE PHILIPPINES', /university of the philippines/i],
  ['OPEN UNIVERSITY', /open university/i],
  ['the degree program (BACHELOR OF …, MASTER OF …, DOCTOR OF …)', PROGRAM],
  [`${role}:`, ADVISER_LABEL],
  ['the Faculty (Faculty of …)', FACULTY],
  ['Permission of the classification…', PERMISSION_TEXT],
  ['the permission codes (Invention, Publication, Confidential, Free)', /^invention\b/i],
  ["Student's Signature:", /student'?s?\s+signature/i],
  [`${role}'s Signature:`, SIGNATURE_ANY],
]

function sequence(tp: TitlePage, emblem: boolean): Finding {
  const id = 'title.sequence'
  // Text from a font that was re-encoded cannot be matched with the template's words.
  if (tp.paras.length && garbled(tp.paras.map((p) => p.text).join(' ')))
    return review(
      id,
      'The text of the title page could not be read reliably (its font is encoded oddly), so its order was not checked. Check it against the template yourself.',
      { where: [{ page: tp.page }] },
    )
  const found = anchors(tp.role).map(([name, re]) => ({
    name,
    // (a crossed box's "x" may stand inside a label: "adviserx’s signature")
    k: tp.paras.findIndex(
      (p) => re.test(norm(p.text)) || re.test(norm(p.text).replace(/(?<=\p{L})x(?=[’'])/gu, '')),
    ),
  }))
  // The university's name may be part of the emblem picture: not text, so not missing, but said.
  const named = (n: string) => /^(UNIVERSITY OF THE PHILIPPINES|OPEN UNIVERSITY)$/.test(n)
  const inPicture = emblem ? found.filter((a) => a.k < 0 && named(a.name)) : []
  // The permission table as a picture: its rows are not text, but not missing.
  const sure = found
    .filter(
      (a) =>
        a.k < 0 &&
        !inPicture.includes(a) &&
        !(tp.tablePicture && /^the permission codes|signature/i.test(a.name)) &&
        !(tp.statementPicture && /^permission of/i.test(a.name)) &&
        !(tp.faculty && /^the faculty/i.test(a.name)),
    )
    .map((a) => a.name)
  // Lines in a font that could not be read (control characters for letters): the labels may be
  // those, and a joint program names its college or school where the template names a faculty.
  const unreadable = tp.paras.some((p) =>
    [...p.text].some((c) => c.charCodeAt(0) < 32 && c !== '\t' && c !== '\n'),
  )
  const college = tp.paras.find((p) =>
    /^(college|school|institute|graduate school) of\b/i.test(norm(p.text)),
  )
  const hidden = sure.filter(
    (n) => (unreadable && /signature/i.test(n)) || (!!college && /^the Faculty/.test(n)),
  )
  const missing = sure.filter((n) => !hidden.includes(n))
  const issues: string[] = []
  // The lines the issues are about, for the places.
  const lines: Para[] = []
  if (tp.cover) {
    issues.push(
      `Remove the page before the title page (“${quote(tp.cover.text, 40)}”): the title page comes first`,
    )
    lines.push(tp.cover)
  } else if (tp.coverPage !== undefined)
    issues.push(
      `Remove the page before the title page (${pagesText([tp.coverPage])}): the title page comes first`,
    )
  if (missing.length) issues.push(`Missing: ${list(missing.map((m) => `“${m}”`))}`)
  if (inPicture.length)
    issues.push(
      `${list(inPicture.map((a) => `“${a.name}”`))} ${inPicture.length > 1 ? 'are' : 'is'} not text on the page (perhaps part of the picture): the template has the name as text under the seal`,
    )
  const present = found.filter((a) => a.k >= 0)
  for (let k = 1; k < present.length; k++)
    if (present[k].k < present[k - 1].k) {
      issues.push(`“${present[k].name}” should come after “${present[k - 1].name}”`)
      lines.push(tp.paras[present[k].k])
    }
  if (tp.authorAbove) {
    issues.push(
      `“${quote(tp.authorAbove.text, 40)}” stands above the degree program: write the program first, then your name below it`,
    )
    lines.push(tp.authorAbove)
  }
  // The author's name comes before the title; a name is short, a title is long.
  if (tp.author && tp.title.length) {
    const words = (p: Para) => norm(p.text).split(' ').length
    if (words(tp.author) > 8 && tp.title.length === 1 && words(tp.title[0]) <= 6) {
      issues.push(`Write your name before the ${tp.work.toLowerCase()} title`)
      lines.push(tp.author)
    }
  }
  // A signature label without its apostrophe, or worded otherwise ("Signature of Thesis
  // Adviser"): the template's wording, which title pages do not always follow, so it is for the
  // student to look at.
  const soft: string[] = []
  // The permission table is a picture and the signature labels are not text: they may be part of it.
  const pictured = tp.tablePicture
    ? found.filter((a) => a.k < 0 && /signature/i.test(a.name)).map((a) => `“${a.name}`)
    : []
  if (pictured.length)
    soft.push(
      `${list(pictured.map((n) => n + '”'))} ${pictured.length > 1 ? 'are' : 'is'} not text on the page (perhaps part of the permission picture): check ${pictured.length > 1 ? 'them' : 'it'} yourself`,
    )
  for (const [re, right] of [
    [/^student\s+signature/i, "Student's Signature"],
    [SIGNATURE_BARE, ''],
    // (an apostrophe and no "s": "Dissertation adviser' signature")
    [new RegExp(`\\b(?:${ROLE})['’]\\s*signature`, 'i'), ''],
  ] as const) {
    const p = tp.paras.find((x) => re.test(norm(x.text)))
    if (p) {
      // As the file words the label: "Thesis", "Dissertation", "Special Problem" Adviser, or only "Adviser".
      // (two labels set close together may share a line: the words after the colon before this one)
      const whole = norm(p.text)
      const at = re.exec(whole)?.index ?? 0
      const label = whole
        .slice(whole.lastIndexOf(':', Math.max(0, at - 1)) + 1)
        .replace(/\s*:$/, '')
        .trim()
      const want = right || `${titleCase(label.replace(/['’]?\s*signature\s*$/i, ''))}'s Signature`
      soft.push(
        `Add an apostrophe and s to the signature label: “${want}” (not “${quote(label, 40)}”)`,
      )
      lines.push(p)
    }
  }
  if (tp.statementPicture && !found.some((a) => a.k >= 0 && /^permission of/i.test(a.name)))
    soft.push(
      '“Permission of the classification…” is not text on the page (perhaps a picture): check that the statement is there, as in the template',
    )
  if (tp.faculty && !FACULTY.test(norm(tp.faculty.text)))
    soft.push(
      `Check the faculty line, “${quote(tp.faculty.text, 60)}”, against the template: it names Information and Communication Studies, Management and Development Studies or Education`,
    )
  if (hidden.length)
    soft.push(
      `Check ${list(hidden.map((n) => `“${n}”`))} yourself: ${
        college && hidden.some((n) => /^the Faculty/.test(n))
          ? `the page names “${quote(college.text, 40)}” where the template names one of UPOU's faculties`
          : 'part of the title page is in a font that could not be read'
      }`,
    )
  const variant = tp.paras.find(
    (x) => SIGNATURE_VARIANT.test(norm(x.text)) && !SIGNATURE_OF.test(norm(x.text)),
  )
  if (variant) {
    soft.push(
      `The adviser's signature label reads “${quote(norm(variant.text).replace(/\s*:$/, ''), 40)}”; the template says “${tp.role}'s Signature”`,
    )
    lines.push(variant)
  }
  if (!issues.length && soft.length)
    return review(
      id,
      "Check the wording of the signature labels against your program's template.",
      {
        details: soft,
        where: lines.slice(0, 5).flatMap(at),
      },
    )
  if (!issues.length) return ok(id, 'The title page follows the order of the template.')
  issues.push(...soft)
  return fix(id, 'Follow the sequence of information in the template.', {
    details: issues,
    where: [
      // A scanned cover: its page is the place.
      ...(!tp.cover && tp.coverPage !== undefined ? [{ page: tp.coverPage }] : []),
      ...lines.slice(0, 5).flatMap(at),
      ...(missing.length || (!lines.length && tp.coverPage === undefined)
        ? [{ page: tp.page }]
        : []),
    ],
  })
}

function titleUpper(tp: TitlePage): Finding {
  const id = 'title.title'
  const t = titleOf(tp)
  if (!t)
    return fix(
      id,
      `Indicate the final ${tp.work.toLowerCase()} title between your name and “${tp.role}:”.`,
      {
        where: [{ page: tp.page }],
      },
    )
  if (/^title$/i.test(t))
    return fix(
      id,
      `Replace “TITLE” with your final ${tp.work.toLowerCase()} title, in upper case.`,
      {
        where: at(tp.title[0]),
      },
    )
  if (garbled(t))
    return review(
      id,
      `The ${tp.work.toLowerCase()} title could not be read reliably (its font is encoded oddly). Check that it is in upper case.`,
      { where: at(tp.title[0]) },
    )
  if (!isUpper(t)) {
    const words = `Not in upper case: ${list(
      lowerWords(t)
        .slice(0, 8)
        .map((w) => `“${w}”`),
    )}`
    // All lower case is neither of the two styles, in any program.
    if (!upperRule(tp) && t !== t.toLowerCase())
      return review(id, `Check the case of the ${tp.work.toLowerCase()} title. ${CASE_NOTE}`, {
        details: [words],
        where: at(tp.title[0]),
      })
    return fix(
      id,
      `Write the ${tp.work.toLowerCase()} title in ${upperRule(tp) ? 'upper case' : 'title case or upper case, as your template shows'}.`,
      {
        details: [words],
        where: at(tp.title[0]),
      },
    )
  }
  return ok(id, `Title (in upper case): “${quote(t, 120)}”`)
}

function adviser(tp: TitlePage, committee: string[]): Finding {
  const id = 'title.adviser'
  const raw = tp.adviser ? shown(tp.adviser) : ''
  const name = cleanName(
    tp.adviser === tp.adviserLabel
      ? norm(raw).replace(ADVISER_LABEL, '').replace(/^\s*:/, '')
      : raw,
  )
  if (!name)
    return fix(id, `Write your ${tp.work.toLowerCase()} adviser's name under “${tp.role}:”.`, {
      where: [{ page: tp.page }],
    })
  if (/^name$/i.test(name))
    return fix(id, `Replace “NAME” with your ${tp.work.toLowerCase()} adviser's name.`, {
      where: at(tp.adviser),
    })
  // A difference of punctuation, an initial or a title is no misspelling.
  const chair = committee[0] ? spelling(committee[0]) : ''
  const mine = spelling(name)
  if (chair && chair !== mine && distance(chair, mine) <= 3)
    return fix(
      id,
      `Check the spelling of your adviser's name: “${name}” here, “${cleanName(committee[0])}” on the Acceptance Page.`,
      {
        where: at(tp.adviser),
      },
    )
  // Spelling cannot be checked here, only compared with the Acceptance Page.
  return review(
    id,
    `Check the spelling of your adviser's name, “${name}”, against your adviser's own: it cannot be checked here.`,
  )
}

function dateOf(p: Para | undefined, id: string, where: string): Finding {
  if (!p || /day\s+month\s+year/i.test(p.text))
    return fix(id, `Indicate the date of submission on the ${where}.`, { where: at(p) })
  if (DATE.test(p.text)) {
    // The template reads "Day Month Year" (15 October 2026): "October 15, 2026" and "10/15/2026"
    // are other forms; an abbreviated month is probably the same form, so the student checks it.
    const dmy =
      /\b\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december),?\s+\d{4}\b/i
    if (dmy.test(p.text)) return ok(id, `Date of submission: ${norm(p.text)}`)
    if (/\b\d{1,2}\s+[a-z]{3,4}\.?,?\s+\d{4}\b/i.test(p.text))
      return review(
        id,
        `Write the month of the date of submission in full (15 October 2026): “${quote(p.text, 40)}”.`,
        { where: at(p) },
      )
    // (the checklist asks only that the date be indicated: the form of it is the template's, not a rule)
    return review(
      id,
      `Write the date of submission as Day Month Year (15 October 2026) on the ${where}: “${quote(p.text, 40)}”.`,
      { where: at(p) },
    )
  }
  return review(
    id,
    `Write the date of submission (Day Month Year) on the ${where}; “${quote(p.text, 40)}” is not a date.`,
    { where: at(p) },
  )
}

type Choice = 'yes' | 'no' | 'both' | 'none'
// Ticks and crosses, including symbol-font ticks that PDFs extract as ü, þ or private-use letters.
// The private-use range U+F000–U+F0FF (Wingdings, Wingdings 2) holds boxes too: the empty ones
// are not marks.
const MARK = /[✓✔✗✘☒☑■◼◾▪⬛●√xX/üþýû-]/
const EMPTY_BOXES = new Set([
  0x2610, 0x25a1, 0xf030, 0xf06f, 0xf070, 0xf071, 0xf072, 0xf07f, 0xf0a1, 0xf0a3, 0xf0a8, 0xf0ff,
])
const isSymbolMark = (code: number) => code >= 0xf000 && code <= 0xf0ff && !EMPTY_BOXES.has(code)
const isMark = (s: string) => [...s].some((c) => MARK.test(c) || isSymbolMark(c.charCodeAt(0)))
const pick = (sides: ('yes' | 'no')[]): Choice =>
  !sides.length ? 'none' : new Set(sides).size === 2 ? 'both' : sides[0]

/** A mark typed beside the words ("☒ Yes or ☐ No", "Yes or No ✓"), or one of the two words deleted:
 *  a mark left of "or" picks Yes, one right of it picks No. */
function typedChoice(text: string): Choice {
  // (a box with a letter "O" over it is circled)
  const t = norm(text)
    .replace(/[☐□]\s*O\b/g, '☒ ')
    .replace(/[☐□]/g, ' ')
  const yes = /\byes\b/i.exec(t)
  const no = /\bno\b/i.exec(t)
  if (yes && !no) return 'yes'
  if (no && !yes) return 'no'
  if (!yes || !no) return 'none'
  const divider = /\bor\b/i.exec(t)?.index ?? (yes.index + no.index) / 2
  const marks = [...t.matchAll(/[✓✔✗✘☒☑■◼◾▪⬛●√]|(?<![a-z])[xX](?![a-z])/g)].map((m) => m.index)
  // Symbol-font boxes drawn ticked (private-use letters).
  for (let k = 0; k < t.length; k++) {
    const code = t.charCodeAt(k)
    if (isSymbolMark(code)) marks.push(k)
  }
  return pick(marks.map((k) => (k < divider ? 'yes' : 'no')))
}

/** Which option of a permission row is marked. The template's boxes stand before each word
 *  ("☐ Yes or ☐ No"), so a mark left of "or" picks Yes and one right of it picks No. */
function rowChoice(ctx: Ctx, row: Para): Choice {
  const { doc } = ctx
  if (doc.kind !== 'pdf') {
    // The Yes/No cell: this paragraph (a merged row) or the next one in the same table.
    const cell = [row, doc.paras[row.i + 1]].find(
      (p) => p && /\byes\b|\bno\b/i.test(p.text) && p.table === row.table,
    )
    if (!cell) return 'none'
    const boxes = (cell.shapes ?? []).filter((s) => s.x !== undefined).sort((a, b) => a.x! - b.x!)
    const boxed = pick([
      ...(boxes[0] && isMark(boxes[0].text) ? (['yes'] as const) : []),
      ...(boxes[1] && isMark(boxes[1].text) ? (['no'] as const) : []),
    ])
    if (boxed !== 'none') return boxed
    return typedChoice(cell.text)
  }
  // PDF: a tick or cross (a one-letter word or an annotation) in this row's band.
  const page = doc.pages?.[row.page ?? -1]
  const line = row.lines?.[0]
  if (!page || !line) return 'none'
  // One of the two words deleted, as in a Word file.
  const yes = /\byes\b/i.test(line.text)
  if (yes !== /\bno\b/i.test(line.text)) return yes ? 'yes' : 'no'
  // "or" may share its span with "No" ("or No"). With no "or", the Yes group ends before the next
  // thing on the line: that is the No box when the boxes stand before the words ("☐ Yes ☐ No"), the
  // Yes box when they stand after them ("Yes ☐ No ☐").
  const or = line.spans.find((s) => /^or\b/i.test(s.text))
  const yesWord = line.spans.find((s) => /^yes$/i.test(s.text))
  const noWord = line.spans.find((s) => /^no$/i.test(s.text))
  const symbol = (s: { text: string }) => /^[^\p{L}\p{N}\s]$/u.test(s.text)
  // Same row: the mark's middle within half a line of the row's middle.
  const band = (b: Box) =>
    Math.abs((b.y0 + b.y1) / 2 - (line.y - 0.3 * line.size)) < 0.5 * line.size
  const width = (b: Box) => b.x1 - b.x0
  // Boxes drawn as shapes or small pictures (empty or filled), left to right.
  const squares = [
    ...page.marks.filter((m) => m.kind === 'path'),
    ...page.images.filter((b) => b.y1 - b.y0 <= 2 * line.size),
  ]
    .filter(
      (m) =>
        band(m) &&
        width(m) >= 0.5 * line.size &&
        width(m) <= 1.6 * line.size &&
        m.y1 - m.y0 >= 0.4 * line.size &&
        m.y1 - m.y0 <= 1.2 * line.size,
    )
    .map((m) => m.x0)
    .sort((a, b) => a - b)
  const divider = (() => {
    if (or) return or.x0
    if (!yesWord || !noWord) return undefined
    const next = line.spans.filter((s) => s.x0 >= yesWord.x1 - 1 && s !== yesWord && s !== noWord)
    const boxBefore =
      line.spans.some((s) => symbol(s) && s.x1 <= yesWord.x0 + 1) ||
      squares.some((x) => x < yesWord.x0 && x > yesWord.x0 - 4 * line.size)
    const edge = boxBefore ? yesWord.x1 : (next.find(symbol)?.x1 ?? yesWord.x1)
    // (a box drawn as a shape before the No word ends the Yes group too)
    const nextBox = boxBefore ? squares.find((x) => x >= edge - 1 && x < noWord.x0) : undefined
    const start = line.spans.find((s) => s.x0 >= edge + 1 && s !== yesWord)
    const stop = Math.min(start?.x0 ?? Infinity, nextBox ?? Infinity)
    return stop < Infinity ? (edge + stop) / 2 : (yesWord.x1 + noWord.x0) / 2
  })()
  // The words in one span ("Yes or No") or a mark inside one ("X Yes"): read the line's text.
  if (divider === undefined || !yesWord) return typedChoice(line.text)
  const from = yesWord.x0 - 4 * line.size
  const side = (x: number) => (x < divider ? 'yes' : 'no')
  // Filled shapes on both sides are the boxes themselves; on one side only, they mark it: a box
  // filled in, a word highlighted (a filled shape, not white, wider than a rule, no wider than a word).
  const oneSide = (xs: number[]) => (new Set(xs.map(side)).size === 1 ? xs : [])
  // Pictures (a Google Docs export draws its boxes as pictures): those on one side only, or more of
  // them on one side (a tick pasted on its box), mark it; with one box picture a side, the clearly
  // darker one is a ticked box swapped in.
  const pics = page.images.filter((b) => band(b) && b.x0 > from)
  const on = (s: Choice) => pics.filter((b) => side(b.x0) === s)
  const ink = (s: Choice) => Math.max(0, ...on(s).map((b) => b.ink ?? 0))
  const [left, right] = [on('yes').length, on('no').length]
  // (a ticked box swapped in is a taller picture than the empty one beside it)
  const tall = (s: Choice) => Math.max(0, ...on(s).map((b) => b.y1 - b.y0))
  const taller: Choice | undefined =
    left === 1 &&
    right === 1 &&
    // (a box filled in is much darker: that one is the mark, not the taller)
    Math.abs(ink('yes') - ink('no')) < 0.4 &&
    Math.abs(tall('yes') - tall('no')) > 0.2 * tall('no')
      ? tall('yes') > tall('no')
        ? 'yes'
        : 'no'
      : undefined
  const marked: Choice | undefined =
    left !== right
      ? left > right
        ? 'yes'
        : 'no'
      : taller
        ? taller
        : Math.abs(ink('yes') - ink('no')) > 0.02
          ? ink('yes') > ink('no')
            ? 'yes'
            : 'no'
          : undefined
  const pictures = marked ? on(marked).map((b) => b.x0) : []
  // (a box's own edges are thin filled strips: a box filled in is as tall as the text)
  const filled = page.marks
    .filter(
      (m) =>
        m.kind === 'path' &&
        !!m.fill &&
        m.fill !== '#ffffff' &&
        band(m) &&
        m.x0 > from &&
        width(m) >= 0.4 * line.size &&
        width(m) <= 4 * line.size &&
        m.y1 - m.y0 >= 0.4 * line.size,
    )
    .map((m) => m.x0)
  // A box drawn once is empty; one drawn over again (ticked by stroking it over) has extra paths
  // of the same size.
  const boxes = page.marks.filter(
    (m) =>
      m.kind === 'path' &&
      !m.fill &&
      band(m) &&
      m.x0 > from &&
      width(m) >= 0.5 * line.size &&
      width(m) <= 1.6 * line.size &&
      Math.abs(width(m) - (m.y1 - m.y0)) <= 0.3 * line.size,
  )
  // A box with two or more strokes inside it (an X drawn in, the lines of a cross) is crossed.
  const crossed = boxes.filter(
    (b) =>
      page.marks.filter(
        (m) =>
          m.kind === 'path' &&
          !m.fill &&
          m !== b &&
          m.x0 >= b.x0 - 1 &&
          m.x1 <= b.x1 + 1 &&
          m.y0 >= b.y0 - 1 &&
          m.y1 <= b.y1 + 1 &&
          // (a stroke across the box, not a hairline or a second outline drawn over it)
          m.x1 - m.x0 >= 0.3 * width(b) &&
          m.y1 - m.y0 >= 0.3 * (b.y1 - b.y0) &&
          (m.x1 - m.x0 < width(b) - 1 || m.y1 - m.y0 < b.y1 - b.y0 - 0.5),
      ).length >= 2,
  )
  // (boxes drawn over one another: their middles within a few points, as a tick box and the
  // slightly smaller squares stroked over it)
  const same = (m: Box, n: Box) =>
    Math.abs((n.x0 + n.x1 - m.x0 - m.x1) / 2) <= 2 && Math.abs((n.y0 + n.y1 - m.y0 - m.y1) / 2) <= 3
  const struck = boxes.filter(
    (m, k) =>
      boxes.filter((n) => same(m, n)).length >= 3 && boxes.findIndex((n) => same(m, n)) === k,
  )
  // A letter "O" over a box glyph circles it.
  const boxGlyphs = page.glyphs.filter((g) => band(g) && /[☐□]/.test(g.text))
  // A tick stroked inside an empty box glyph (a small drawn path over the box).
  const emptyBox = page.glyphs.filter(
    (g) => band(g) && [...g.text].length === 1 && EMPTY_BOXES.has(g.text.charCodeAt(0)),
  )
  const ticked = page.marks
    .filter(
      (m) =>
        m.kind === 'path' &&
        band(m) &&
        width(m) <= line.size &&
        m.y1 - m.y0 >= 0.3 * line.size &&
        emptyBox.some((g) => (m.x0 + m.x1) / 2 >= g.x0 - 1 && (m.x0 + m.x1) / 2 <= g.x1 + 1),
    )
    .map((m) => m.x0)
  const circled = (g: { x0: number; text: string }) =>
    /^[Oo]$/.test(g.text) && boxGlyphs.some((b) => Math.abs(b.x0 - g.x0) <= 3)
  // What marks a choice, the surest first: a drawn mark, a typed one, a form field, a picture, and
  // only last a bare "/" (it may be a stray character beside the word).
  const typed = page.glyphs
    .filter((g) => band(g) && g.x0 > from && g.text !== '/' && (isMark(g.text) || circled(g)))
    .map((g) => g.x0)
  const fields = page.marks
    .filter((m) => band(m) && m.kind !== 'path' && m.on !== false && m.x0 > from)
    .map((m) => m.x0)
  const slash = page.glyphs.filter((g) => band(g) && g.x0 > from && g.text === '/').map((g) => g.x0)
  const evidence = [
    [...oneSide(filled), ...struck.map((m) => m.x0), ...crossed.map((m) => m.x0), ...ticked],
    typed,
    fields,
    pictures,
    slash,
  ]
  const xs = evidence.find((e) => e.length) ?? []
  const chosen = pick(xs.map(side))
  return chosen === 'none' ? typedChoice(line.text) : chosen
}

/** A permission row whose two boxes are glyphs of a symbol font (one before "Yes", one before
 *  "No") that differ from one another: which glyph is the ticked box depends on the font. */
function symbolBoxes(ctx: Ctx, row: Para): boolean {
  const page = ctx.doc.pages?.[row.page ?? -1]
  const line = row.lines?.[0]
  const yes = line?.spans.find((s) => /^yes$/i.test(s.text))
  if (!page || !line || !yes) return false
  const near = page.glyphs.filter(
    (g) =>
      /^[^\p{L}\p{N}\s]$/u.test(g.text) &&
      g.x0 > yes.x0 - 4 * line.size &&
      Math.abs((g.y0 + g.y1) / 2 - (line.y - 0.3 * line.size)) < 0.5 * line.size,
  )
  return near.length >= 2 && new Set(near.map((g) => g.text)).size === 2
}

function permissionCode(ctx: Ctx, tp: TitlePage): Finding {
  const id = 'title.permission'
  if (tp.rows.length < 4 && tp.tablePicture)
    return review(
      id,
      'The permission table on the title page is a picture, so its marks could not be read here. Check that one code is marked “Yes” and the others “No”.',
      { where: [{ page: tp.page }] },
    )
  // An older form of the page: access rows ("Available to the general public … Yes") in place of
  // the codes. With one row "Yes" and the rest "No" it is filled in as that form asks.
  const access = tp.paras.filter((p) => /^available (to|only)\b/i.test(norm(p.text)))
  if (tp.rows.length < 4 && access.length >= 2) {
    const yes = access.filter((p) => typedChoice(p.text) === 'yes').length
    const no = access.filter((p) => typedChoice(p.text) === 'no').length
    if (yes === 1 && yes + no === access.length)
      return review(
        id,
        'The title page has the older access list (“Available to the general public…”) with one “Yes”, not the permission codes of the current template (Invention, Publication, Confidential, Free). Check which form your program asks for.',
        { where: at(access[0]) },
      )
    return fix(
      id,
      'Use the permission classification table of the current template (Invention, Publication, Confidential, Free), with one code marked “Yes”, in place of the older access list.',
      {
        details: yes > 1 ? [`${yes} rows of the access list read “Yes”.`] : undefined,
        where: at(access[0]),
      },
    )
  }
  if (tp.rows.length < 4)
    return fix(
      id,
      'Add the permission classification table from the template (Invention, Publication, Confidential, Free).',
      {
        where: [{ page: tp.page }],
      },
    )
  const rows = tp.rows.slice(0, 4).map((r) => ({
    name: (() => {
      const word = TABLE_ROW.exec(norm(r.text))![1]
      return `${titleCase(word)} (${ROW_LETTER[word.toLowerCase()]})`
    })(),
    choice: rowChoice(ctx, r),
  }))
  const yes = rows.filter((r) => r.choice === 'yes')
  const unmarked = rows.filter((r) => r.choice === 'none')
  const both = rows.filter((r) => r.choice === 'both')
  const where = at(tp.rows[0])
  const msg = "Select one permission code (one 'Yes', others marked as 'No')."
  if (unmarked.length === 4 && tp.rows.slice(0, 4).every((r) => symbolBoxes(ctx, r)))
    return review(
      id,
      'The boxes beside “Yes” and “No” are drawn with a symbol font, so which of them is ticked could not be read here. Check that one code is marked “Yes” and the others “No”.',
      { where },
    )
  if (unmarked.length === 4)
    return fix(id, msg, { details: ['No mark found beside any “Yes” or “No”.'], where })
  const details: string[] = []
  // A tick before the unfilled words "Yes or No" on every row: nothing was chosen.
  if (
    yes.length === 4 &&
    tp.rows.slice(0, 4).every((r) => /[✓✔√] ?yes or no\b[^\p{L}]*$/iu.test(r.text))
  )
    return fix(id, msg, {
      details: ['Every row still reads “Yes or No” with a tick before it: no code was chosen.'],
      where,
    })
  if (both.length === 4)
    return review(
      id,
      'Check the permission table: every row reads as marked both “Yes” and “No”, so which code is chosen could not be told here. Mark one code “Yes” and the others “No”.',
      { where },
    )
  if (both.length)
    details.push(`Both “Yes” and “No” are marked for ${list(both.map((r) => r.name))}.`)
  if (yes.length > 1)
    details.push(`More than one code is marked “Yes”: ${list(yes.map((r) => r.name))}.`)
  if (!yes.length && !both.length) details.push('No code is marked “Yes”.')
  if (unmarked.length) details.push(`Not marked: ${list(unmarked.map((r) => r.name))}.`)
  if (details.length) return fix(id, msg, { details, where })
  return ok(id, `Permission code: ${yes[0].name} is “Yes”; the others are “No”.`)
}

function signature(
  ctx: Ctx,
  label: Para | undefined,
  id: string,
  page: string,
  /** The permission table's last row (title page): the signature is below it. */
  floor?: number,
): Finding {
  if (!label) return fix(id, `Affix your signature on the ${page}.`)
  const found =
    ctx.doc.kind === 'pdf' ? pdfMarkNear(ctx, label, floor) : wordPictureNear(ctx, label) && 'mark'
  if (found === 'mark') return ok(id, `Signature found on the ${page}.`)
  if (found === 'field')
    return review(
      id,
      `Check that the signature field beside “${quote(label.text, 40)}” is signed: an empty field looks the same here.`,
      { where: at(label) },
    )
  // A name typed after "Signature:" may be meant as the signature (a script font): not for us to rule.
  const typed = /signature\s*:\s*(\p{L}.*)$/iu.test(norm(label.text))
  if (ctx.doc.kind === 'pdf' && typed)
    return review(
      id,
      `A name is typed beside “${quote(label.text, 40)}”, with no signature picture. Check that it is your own signature, as the template asks.`,
      { where: at(label) },
    )
  return ctx.doc.kind === 'pdf'
    ? fix(id, `Affix your signature on the ${page}.`, { where: at(label) })
    : review(
        id,
        `No signature image next to “${quote(label.text, 40)}”. Affix your signature on the ${page} before you send the PDF.`,
        {
          where: at(label),
        },
      )
}

/**
 * Whether a page after the title page carries title-page content (the access table or its
 * Yes/No lines, signature or adviser labels, the date of submission): a second sheet. A page with
 * a heading of its own (copyright, contents) is a page of its own.
 */
function titleSheet(doc: Doc, q: number): boolean {
  const lines = (doc.pages?.[q]?.paras ?? [])
    .map((i) => norm(doc.paras[i].text))
    .filter((t) => !/\.{4,}/.test(t))
  return lines.some((t) =>
    /(signature|adviser|date of submission|permission is given|yes\s*(or|\/)\s*no)/i.test(t),
  )
}

/** A footer check for one page: the title page, the permission page, the acceptance page. */
function folioCheck(
  ctx: Ctx,
  id: string,
  para: Para | undefined,
  want: Want,
  name: string,
  /** The whole title (title page): a footer holding it is no shortened title. */
  full?: string,
): Finding {
  const { doc } = ctx
  if (!para) return na(id, `No ${name} found.`)
  if (doc.kind === 'pdf') {
    const page = para.page ?? 0
    const folio = pdfFolio(doc, page)
    // The number follows the page's place after the title page (i), so an extra page between
    // (a copyright page) moves the pages after it on, as it should.
    const here =
      want !== 'none' && want.value !== undefined
        ? { ...want, value: page - titlePage(doc, ctx.s) + 1 }
        : want
    // A short title printed whole has no shortening to mark with an ellipsis: for the student to
    // look at, not a fault.
    const shortWhole = (p: Problem) =>
      p.type === 'ellipsis' &&
      !!full &&
      full.split(/\s+/).length <= 8 &&
      !!folio &&
      titleKey(folio.raw.replace(/\s*[ivxlcdm\d]+$/i, '')) === titleKey(full)
    // A title page that runs over to a second sheet shows no number on it either.
    const permPage = ctx.s.permission ? (doc.paras[ctx.s.permission.heading].page ?? 0) : 0
    const more =
      want === 'none'
        ? Array.from(
            { length: Math.max(0, Math.min(permPage, page + 3) - page - 1) },
            (_, k) => page + 1 + k,
          ).filter((q) => titleSheet(doc, q))
        : []
    const found = [
      ...judge(folio, here, page),
      ...more.flatMap((q) => judge(pdfFolio(doc, q), want, q)),
      // (the title page's own footer is judged as a footer to remove)
      ...(want === 'none' ? [] : againstTitle(folio, full, page)),
    ]
    const problems = found.filter((p) => !shortWhole(p))
    // One shortened title throughout: this page's against the one most pages before Chapter I carry.
    if (want !== 'none' && folio?.title && folio.number !== undefined) {
      const ch = ctx.s.chapters[0]
      const last = ch ? (doc.paras[ch.heading].page ?? 0) : (doc.pages?.length ?? 0)
      const main = mainTitle(
        doc,
        Array.from({ length: last }, (_, p) => p),
      )
      if (main && titleKey(folio.title) !== main.key)
        problems.push({
          type: garbledVariant(folio.title, main.shown) ? 'garbled' : 'changed',
          page,
          text: `${pagesText([page])}: the footer has another title, “${quote(folio.title, 40)}”, than the other preliminary pages (“${quote(main.shown, 40)}”); keep one shortened title`,
        })
    }
    // A misspelt title alone is for the student to look at, not a sure fault.
    if (lookOnly(problems))
      return review(
        id,
        problems.some((p) => p.type === 'garbled')
          ? `The footer of the ${name} has a title that differs from the other pages' only in letters the font printed wrongly, so it could not be compared. Check it yourself.`
          : `The footer of the ${name} spells the title differently from the title page. Check it.`,
        { details: problems.map((p) => p.text), where: [{ page }] },
      )
    if (!problems.length && found.some(shortWhole))
      return review(
        id,
        `The footer of the ${name} holds the whole title, which is short; the template shows the shortened title, an ellipsis (…) and the number. Check that yours does.`,
        { where: [{ page }] },
      )
    if (!problems.length)
      return ok(id, want === 'none' ? `No page number on the ${name}.` : `${name}: “${folio?.raw}”`)
    if (problems.every((p) => p.type === 'overlap'))
      return review(
        id,
        `The footer of the ${name} prints over itself (the title over its page number), so it could not be read. Check it yourself.`,
        { where: [{ page }] },
      )
    const whole =
      !!full && !!titleKey(full) && titleKey(folio?.title ?? '').includes(titleKey(full))
    return fix(
      id,
      problems.length === 1 && problems[0].type === 'changed'
        ? `Use the same shortened title in the footer of the ${name} as on the other preliminary pages.`
        : wantMessage(here, name, folio?.title ? (whole ? 'title' : 'shortened title') : undefined),
      { details: problems.map((p) => p.text), where: [{ page }] },
    )
  }
  if (!doc.sections) return review(id, `Check the page number on the ${name} in the PDF version.`)
  const { folio, firstPage } = wordFolioAt(doc, para.i)
  const w = want !== 'none' && !firstPage ? { ...want, value: undefined } : want
  const problems = judge(folio, w)
  if (!problems.length)
    return ok(id, want === 'none' ? `No page number on the ${name}.` : `${name}: “${folio?.raw}”`)
  return fix(id, wantMessage(want, name), {
    details: problems.map((p) => p.text.charAt(0).toUpperCase() + p.text.slice(1)),
    where: at(para),
  })
}

/** `title`: what the footer shows before the number, a title or a shortened one. */
const wantMessage = (want: Want, name: string, title?: string) =>
  want === 'none'
    ? `Remove the ${title ? `footer (${title} and page number)` : 'page number'} on the ${name}.`
    : `Add the shortened title + ellipsis + page number (${want.kind === 'roman' && want.value ? roman(want.value) : 'Roman numerals'}) on the ${name}.`

// ---- University Permission Page ----

function permissionTitle(ctx: Ctx, tp: TitlePage): Finding {
  const id = 'permission.title'
  const r = ctx.s.permission
  if (!r) return fix(id, 'Add the University Permission Page from the template.')
  // A page found by its wording has no heading: its first line is the title's.
  const named = /permission( page)?\s*$/i.test(norm(ctx.doc.paras[r.heading]?.text ?? ''))
  const paras = textIn(ctx, r.heading + (named ? 1 : 0), r.end)
  // The title ends where the statement begins, even within a paragraph (a PDF joins the title's
  // lines to the statement's when they stand as close).
  const units = paras
    .filter((p) => !/^university permission( page)?$/i.test(norm(p.text)))
    .flatMap((p) =>
      p.lines && p.lines.length > 1
        ? p.lines.map((l) => ({ p, text: l.text }))
        : [{ p, text: shown(p) }],
    )
  // A title in capitals ends where the lines turn to ordinary text: the statement, even when its
  // words came out of a font as nonsense.
  const upperTitle = !!units[0] && isUpper(norm(units[0].text))
  const end = units.findIndex(
    (u, k) =>
      /^["“]?\s*I hereby grant|specifically/i.test(norm(u.text)) ||
      garbled(u.text.split(/\s+/).slice(0, 8).join(' ')) ||
      (upperTitle && k > 0 && lowerWords(norm(u.text)).length >= 4),
  )
  const used = end < 0 ? units.filter((u) => u.p === units[0]?.p) : units.slice(0, end)
  const lines = [...new Set(used.map((u) => u.p))]
  const t = norm(used.map((u) => u.text).join(' '))
  if (garbled(t))
    return review(
      id,
      `The title on the University Permission Page could not be read reliably (its font is encoded oddly). Check that it is the ${tp.work.toLowerCase()} title as on the Title Page, in upper case.`,
      { where: at(lines[0]) },
    )
  if (!t || /^title$/i.test(t))
    return fix(
      id,
      `Indicate the ${tp.work.toLowerCase()} title (in upper case) on the University Permission Page.`,
      {
        where: at(lines[0]),
      },
    )
  const main = titleOf(tp)
  const details: string[] = []
  if (!isUpper(t))
    details.push(
      `Write it in upper case (not in upper case: ${list(
        lowerWords(t)
          .slice(0, 6)
          .map((w) => `“${w}”`),
      )}).`,
    )
  const differs = !!main && titleForm(main) !== titleForm(t)
  if (differs && readsOddly(main, t))
    return review(
      id,
      `The title on the University Permission Page could not be read reliably (its letters are spaced out or out of order in the file). Check that it is the ${tp.work.toLowerCase()} title as on the Title Page, in upper case.`,
      { where: at(lines[0]) },
    )
  if (differs && isUpper(t) && titleLoose(main) === titleLoose(t))
    return review(
      id,
      'The title differs from the Title Page in punctuation or hyphens only. Check that it is the same title.',
      { where: at(lines[0]) },
    )
  if (details.length && !differs && !upperRule(tp))
    return review(id, `Check the case of the ${tp.work.toLowerCase()} title. ${CASE_NOTE}`, {
      details,
      where: at(lines[0]),
    })
  // (outside MDC the case is for the student to check; the words differing are still a fault)
  if (details.length && !upperRule(tp)) details[0] = `Check the case of the title. ${CASE_NOTE}`
  if (differs) {
    const d = wordDiff(main, t)
    details.push(
      `It differs from the Title Page${d.onlyB.length ? `: “${d.onlyB.slice(0, 5).join(' ')}” here` : ''}${d.onlyA.length ? `, “${d.onlyA.slice(0, 5).join(' ')}” on the Title Page` : ''}.`,
    )
  }
  if (details.length)
    return fix(
      id,
      `Use the final ${tp.work.toLowerCase()} title${upperRule(tp) ? ', in upper case,' : ''} as on the Title Page.`,
      {
        details,
        where: at(lines[0]),
      },
    )
  return ok(id, 'The title matches the Title Page and is in upper case.')
}

function permissionStatement(ctx: Ctx): Finding {
  const id = 'permission.statement'
  const r = ctx.s.permission
  if (!r) return fix(id, 'Add the University Permission Page from the template.')
  const paras = textIn(ctx, r.start, r.end)
  const allow = find(paras, /I specifically allow/i)
  const grant = find(paras, /Specifically,? I grant/i)
  if (allow && grant)
    return fix(id, 'Omit the “I specifically allow…”; retain the “Specifically, I grant…”.', {
      where: at(allow),
    })
  if (allow || grant)
    return ok(id, `Uses only “${allow ? 'I specifically allow…' : 'Specifically, I grant…'}”.`)
  const msg =
    'The permission statement (“Specifically, I grant…”) was not found. Use the wording of the template.'
  // Readable text with no word of a grant or allowance at all: the statement is missing, not reworded.
  const readable = paras.length >= 3 && !paras.some((p) => garbled(p.text))
  if (
    readable &&
    !paras.some(
      (p) =>
        !/^["“]?\s*I hereby grant/i.test(norm(p.text)) && /grant|allow|specifically/i.test(p.text),
    )
  )
    return fix(id, msg, { where: at(paras[0]) })
  return review(id, msg)
}

function permissionSignature(ctx: Ctx): Finding {
  const id = 'permission.signature'
  const r = ctx.s.permission
  if (!r) return fix(id, 'Add the University Permission Page from the template.')
  const paras = textIn(ctx, r.start, r.end)
  const label = find(paras, /signature over (student|printed)? ?name/i) ?? find(paras, /signature/i)
  const k = label ? paras.indexOf(label) : paras.length
  const above = paras.slice(Math.max(0, k - 3), k)
  // The name and date may share the label's paragraph (a PDF line above it, joined).
  // (the caption itself, either way round: "Signature over Student Name", "Student Name over
  // Signature and Date")
  const lead = label
    ? norm(label.text).split(/\b(?:signature over|(?:student|printed) name over)\b/i)[0]
    : ''
  const issues: string[] = []
  const statuses: Finding['status'][] = []
  const typed = [...above.map((p) => norm(p.text)), lead.trim()]
  const placeholder = typed.some((t) => /\bname and date$/i.test(t))
  // A date written in any form, maybe across two lines ("03 June" / "2021", "10-Dec-21",
  // "04/08/2021"), and a typed name ("Juan B. Cruz"): only what is missing is asked for.
  const dated =
    DATE.test(typed.join(' ')) ||
    typed.some((t) => /(?<!\d)\d{1,2}[\s/.-]+(?:[a-z]{3,9}|\d{1,2})[\s/.,-]+\d{2,5}(?!\d)/i.test(t))
  const named = typed.some((t) =>
    /^\p{Lu}[\p{L}.'’-]*(?:\s+\p{Lu}[\p{L}.'’-]*){1,5}$/u.test(
      t.replace(/_+|\s[/|,]\s.*$|,?\s*\d.*$/g, ' ').trim(),
    ),
  )
  // A name or a date whose digits came out of the font as control characters.
  const unreadable = typed.some((t) => [...t].some((c) => c.charCodeAt(0) < 32 && c !== '	'))
  // The signature block as a picture under the text (name, line and date typed in it).
  const last = paras.at(-1)?.lines?.at(-1)
  const pg = ctx.doc.pages?.[last?.page ?? -1]
  const pictured =
    !label &&
    !!last &&
    !!pg?.images.some((b) => b.x1 - b.x0 >= 100 && b.y0 >= last.y - 2 && b.y1 < pg.height - 40)
  if (pictured && !placeholder && !dated) {
    issues.push(
      'The signature block of the University Permission Page is a picture, so the name and date in it could not be read. Check that your name and the date of submission are there.',
    )
    statuses.push('review')
  } else if (!placeholder && !dated && unreadable) {
    issues.push(
      'The name or the date above the label could not be read reliably (its font is encoded oddly). Check that your name and the date of submission are there.',
    )
    statuses.push('review')
  } else if (placeholder || !dated) {
    issues.push(
      // The template's "and Date" kept after the student's own name.
      !placeholder && typed.some((t) => /\band date$/i.test(t))
        ? 'Replace “and Date” after your name with the date of submission.'
        : named && !placeholder
          ? 'Write the date of submission with your name, above “Signature over Student Name and Date”.'
          : 'Write your name and the date of submission above “Signature over Student Name and Date”.',
    )
    statuses.push('fix')
  }
  // With no "Signature over Student Name" caption (a signature set over the typed name and date),
  // the last line of the page is where to look.
  const sig = signature(
    ctx,
    label ?? (ctx.doc.kind === 'pdf' ? paras.at(-1) : undefined),
    id,
    'University Permission Page',
  )
  if (sig.status !== 'ok') {
    issues.push(sig.message)
    statuses.push(sig.status)
  }
  if (!issues.length)
    return ok(id, 'Signature, name and date are on the University Permission Page.')
  return {
    id,
    status: worst(statuses),
    message:
      issues.length === 1
        ? issues[0]
        : pictured && sig.status !== 'ok'
          ? sig.message
          : 'Add your signature and the date of submission.',
    details: issues.length === 1 ? undefined : issues,
    where: at(label),
  }
}

// ---- Acceptance Page ----

interface Names {
  /** `real`: the name written above a line that still says “NAME”. */
  committee: { name: string; para: Para; real?: string }[]
  dean?: { name: string; para: Para }
}

// A committee member's role under the name: "Adviser", "Program Chair", "Critic/ Reader, Member",
// "Reader, Dissertation Committee" (a date may follow after a tab).
const ROLE_LINE =
  /^(?:(?:program|thesis|dissertation|research|panel|committee) )?(?:chair(?:person)?|member|advis[eo]r|co-advis[eo]r|reader|critic)\b/i

// A name and its role on one line, under the signature line: "Name, Ph.D., Member, Advisory
// Committee", "Name, Dean, Faculty of …".
const NAME_ROLE = new RegExp(
  `^([^:;]{3,80}?)(?:,\\s*(?:${ROLE_LINE.source.slice(1)}|dean\\b)|\\s+dean\\b(?=,|\\s+(?:faculty|of)\\b|\\s*$))`,
  'i',
)

// A title standing alone on the line above the name ("ASSISTANT PROFESSOR", then the name).
const TITLE_ONLY =
  /^(dr|prof(essor)?|(asst|assistant|assoc|associate)\.?\s*prof(essor)?|engr|atty|mr|ms|mrs|hon)\.?$/i

function readNames(ctx: Ctx): Names {
  const r = ctx.s.acceptance
  if (!r) return { committee: [] }
  const paras = textIn(ctx, r.start, r.end)
  const committee: Names['committee'] = []
  let dean: Names['dean']
  paras.forEach((p, k) => {
    const t = norm(p.text)
    const prev = paras[k - 1]
    if (!prev) return
    if (ROLE_LINE.test(t)) {
      // (the sentence of the page above a role with no name: the name was taken out)
      const alone = paras[k - 2] && TITLE_ONLY.test(norm(paras[k - 2].text))
      // (the name typed above an empty underlined line: the line is the paragraph before the role)
      const typed = /^[_\s]*$/.test(prev.text) ? paras[k - 2] : undefined
      const typedName =
        typed &&
        norm(typed.text).split(' ').length <= 10 &&
        !ROLE_LINE.test(norm(typed.text)) &&
        !/^(dean|faculty|date|name|this )/i.test(norm(typed.text)) &&
        !/(accepted|prepared|title)/i.test(typed.text) &&
        !/^[_\s]*$/.test(typed.text)
          ? cleanName(shown(typed)).replace(/^_+/, '')
          : ''
      const name =
        norm(prev.text).split(' ').length > 12 || ROLE_LINE.test(norm(prev.text))
          ? ''
          : typedName ||
            (alone ? norm(paras[k - 2].text) + ' ' : '') + cleanName(shown(prev)).replace(/^_+/, '')
      // "NAME" set over the line, the name itself above it.
      const above = paras[k - 2]
      const real =
        /^name$/i.test(name) &&
        above &&
        norm(above.text).split(' ').length <= 10 &&
        !ROLE_LINE.test(norm(above.text)) &&
        !/^(dean|faculty|this )/i.test(norm(above.text)) &&
        !/(accepted|prepared|title)/i.test(above.text)
          ? cleanName(shown(above)).replace(/^_+/, '')
          : undefined
      committee.push({ name, para: prev, ...(real ? { real } : {}) })
    } else if (!/^dean\b/i.test(t) && t.split(' ').length <= 14 && NAME_ROLE.test(t)) {
      const name = NAME_ROLE.exec(t)![1]
      if (/^(,\s*|\s+)dean\b/i.test(t.slice(name.length))) dean = { name, para: p }
      else committee.push({ name, para: p })
    } else if (/^dean\b/i.test(t))
      dean = {
        name:
          (paras[k - 2] && TITLE_ONLY.test(norm(paras[k - 2].text))
            ? norm(paras[k - 2].text) + ' '
            : '') + cleanName(shown(prev)).replace(/^_+/, ''),
        para: prev,
      }
  })
  // A Dean's block with no line "Dean": the name, then the faculty alone on its line.
  if (!dean) {
    const k = paras.findIndex(
      (p, j) => j > 0 && /^faculty of\b/i.test(norm(p.text)) && norm(p.text).length < 80,
    )
    const above = paras[k - 1]
    if (k > 0 && !committee.some((c) => c.para === above) && !ROLE_LINE.test(norm(above.text)))
      dean = { name: cleanName(shown(above)), para: above }
  }
  return { committee, dean }
}

/** How many letters two words share at their starts and ends together. */
function sharedEnds(a: string, b: string) {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  let j = 0
  while (j < a.length - i && j < b.length - i && a.at(-1 - j) === b.at(-1 - j)) j++
  return i + j
}

function acceptanceTitle(ctx: Ctx, tp: TitlePage): Finding {
  const id = 'acceptance.title'
  const r = ctx.s.acceptance
  if (!r) return fix(id, 'Add the Acceptance Page from the template.')
  const paras = textIn(ctx, r.start, r.end)
  // (or no word for it: "The dissertation attached hereto A STUDY OF RADIO in partial fulfilment…")
  const p = find(paras, /with the title|entitled|titled|\btitle\s*:|attached hereto/i)
  // The sentence may come in pieces (a PDF splits it where the bold title starts): read on to "accepted".
  const k = p ? paras.indexOf(p) : -1
  const end = paras.findIndex((q, j) => j >= k && /accepted/i.test(q.text))
  const sentence =
    k < 0
      ? ''
      : norm(
          paras
            .slice(k, end >= k ? end + 1 : k + 1)
            .map(shown)
            .join(' ')
            // A re-encoded font prints the quotes around the title as ³ and ´.
            .replace(/(title|titled)(\s*:?\s*)³/i, '$1$2“')
            .replace(/´(?=\s*(is hereby|which|has been|is accepted))/i, '”'),
        )
  // A title in quotes ends at the closing quote (the words after it, "prepared and submitted by…",
  // are not the title); one without, at "is hereby accepted".
  const m = p
    ? (/(?:with the title|entitled|titled|\btitle\s*:)\s*:?\s*["“‘]\s*(.+?)[,.]?\s*["”’]\s*(?=,?\s*(?:is hereby|which|has been|is accepted|prepared|submitted|by\b|$))/i.exec(
        sentence,
      ) ??
      // (a quote closed with the sentence's end, "…Kuwait.” The thesis attached hereto was…":
      // the next sentence is not the title)
      [
        /(?:with the title|entitled|titled|\btitle\s*:)\s*:?\s*["“‘]\s*(.+?)(?:[.,]\s*["”’]|["”’][.,])\s+(\S)/i.exec(
          sentence,
        ),
      ].find((x) => x && /\p{Lu}/u.test(x[2])) ??
      /(?:with the title|entitled|titled|\btitle\s*:|attached hereto,?(?!\s*,?\s*(?:entitled|titled|with the title|was|is|has)\b))\s*:?\s*["“'‘]?(.+?)["”'’]?\s*,?\s*(?:is hereby accepted|which|has been|is accepted|(?:prepared|submitted)(?: and submitted)? by\b|in partial fulfil|$)/i.exec(
        sentence,
      ))
    : null
  const t = m?.[1]?.replace(/["”]$/, '').trim() ?? ''
  if (!t || /^x{4,}$/i.test(t))
    return fix(id, `Indicate the final ${tp.work.toLowerCase()} title on the Acceptance Page.`, {
      where: at(p),
    })
  const main = titleOf(tp)
  if (garbled(t) || garbled(main))
    return review(
      id,
      `The title could not be read reliably (its font is encoded oddly). Check that the Acceptance Page has the same ${tp.work.toLowerCase()} title as the Title Page.`,
      { where: at(p) },
    )
  // Letters spaced out, runs out of order, a glyph read as a digit: the text layer's failing.
  if (main && titleForm(main) !== titleForm(t) && readsOddly(main, t))
    return review(
      id,
      `The title on the Acceptance Page could not be read reliably (its letters are spaced out or out of order in the file). Check that it is the same ${tp.work.toLowerCase()} title as on the Title Page.`,
      { where: at(p) },
    )
  // Differences in punctuation, a hyphen or a space only: for the student to look at.
  if (main && titleForm(main) !== titleForm(t) && titleLoose(main) === titleLoose(t))
    return review(
      id,
      `The title differs from the Title Page in punctuation or hyphens only. Check that the Acceptance Page has the same title.`,
      {
        details: [`Title Page: “${quote(main, 90)}”; Acceptance Page: “${quote(t, 90)}”.`],
        where: at(p),
      },
    )
  // One word of the two titles differs by a letter or two, and one of them has a small letter
  // among capitals ("LEARmNG"): a glyph the text layer got wrong, for the student to look at.
  if (main && titleForm(main) !== titleForm(t)) {
    const d = wordDiff(main, t)
    if (
      d.onlyA.length === 1 &&
      d.onlyB.length === 1 &&
      Math.abs(d.onlyA[0].length - d.onlyB[0].length) <= 1 &&
      sharedEnds(d.onlyA[0], d.onlyB[0]) >= Math.max(d.onlyA[0].length, d.onlyB[0].length) - 3 &&
      /\p{Lu}{2}\p{Ll}\p{Lu}{2}/u.test(`${main} ${t}`)
    )
      return review(
        id,
        `A word of the title, “${quote(d.onlyA[0], 20)}” on the Title Page, “${quote(d.onlyB[0], 20)}” here, differs by a letter that may be a misread glyph. Check that the Acceptance Page has the same title.`,
        { where: at(p) },
      )
  }
  const issues: string[] = []
  if (main && titleForm(main) !== titleForm(t)) {
    // (the sentence's own words, "the thesis attached hereto", are no difference to name)
    const only = wordDiff(main, t).onlyB.filter(
      (w) =>
        !/^(the|a|an|of|and|this|thesis|dissertation|project|paper|attached|hereto|entitled|titled)$/i.test(
          w,
        ),
    )
    issues.push(
      `Title Page: “${quote(main, 90)}”; Acceptance Page: “${quote(t, 90)}”${
        only.length
          ? ` (not on the Title Page: ${only
              .slice(0, 4)
              .map((w) => `“${w}”`)
              .join(', ')})`
          : ''
      }.`,
    )
  }
  const author = /prepared by\s+(.+?)\s+with the title/i.exec(sentence)?.[1]
  if (author && /author'?s name/i.test(author))
    issues.push('Replace “AUTHOR’S NAME” with your name.')
  if (issues.length)
    return fix(
      id,
      `Replace with the approved ${tp.work.toLowerCase()} title (the same as on the Title Page).`,
      {
        details: issues,
        where: at(p),
      },
    )
  return ok(id, 'The title matches the Title Page.')
}

function acceptanceNames(ctx: Ctx, names: Names): Finding {
  const id = 'acceptance.names'
  if (!ctx.s.acceptance) return fix(id, 'Add the Acceptance Page from the template.')
  // (a name typed above a caption "NAME" that was left in: extra.placeholders says so)
  const all: { name: string; para: Para }[] = [
    ...names.committee.map((n) => ({ name: n.real || n.name, para: n.para })),
    ...(names.dean ? [names.dean] : []),
  ]
  const blank = all.filter((n) => !n.name || /^name$/i.test(n.name))
  // No name in the text, but a picture where the names and signatures would stand: for the student.
  const acc = ctx.s.acceptance
  const page = ctx.doc.pages?.[ctx.doc.paras[acc.heading].page ?? -1]
  if (
    !all.length &&
    page?.images.some((b) => b.x1 - b.x0 >= 120 && b.y1 - b.y0 >= 60 && b.y0 > 0.2 * page.height)
  )
    return review(
      id,
      'The names under the Acceptance Page’s sentence are in a picture, so they could not be read here. Check that the advisory committee’s and the Dean’s names are complete and spelled right.',
      { where: [{ page: page.n }] },
    )
  // A PDF whose other names read but one line shows only its underscores: the name may sit in a
  // layer of the page that cannot be read here (typed over the line), so for the student to look at.
  if (
    ctx.doc.kind === 'pdf' &&
    blank.length &&
    blank.length < all.length &&
    blank.every((n) => !n.name && /_{4,}/.test(n.para.text))
  )
    return review(
      id,
      `${plural(blank.length, 'name line')} could not be read (only the signature line shows); the name may be in a layer of the PDF that cannot be read here. Check that the advisory committee’s and the Dean’s names are complete and spelled right.`,
      { where: at(blank[0].para) },
    )
  if (!all.length || blank.length)
    return fix(id, "Complete the advisory committee's and the Dean's names.", {
      details: blank.length
        ? [
            `${plural(blank.length, 'name line')} ${
              blank.every((n) => n.name)
                ? `still say${blank.length > 1 ? '' : 's'} “NAME”`
                : blank.some((n) => n.name)
                  ? 'are blank or still say “NAME”'
                  : `${blank.length > 1 ? 'are' : 'is'} blank`
            }.`,
          ]
        : undefined,
      where: at(blank[0]?.para),
    })
  const dean = names.dean
  // A committee member's name on the Dean's line: a line copied and not changed, or a Dean who
  // sits on the committee. Deans change and each faculty has its own: only the student can tell.
  if (dean && names.committee.some((c) => bareName(c.name) === bareName(dean.name)))
    return review(
      id,
      `“${dean.name}” is on the Dean's line and is also a committee member's name. Check that the Dean's line names your faculty's current Dean, and the spelling of each committee name below.`,
      { details: names.committee.map((c) => c.name), where: at(dean.para) },
    )
  // A name line ending in a comma ("…, Ph.D,"): a typo, certain enough to correct.
  const comma = all.filter((n) => /,\s*$/.test(n.name))
  if (comma.length)
    return fix(
      id,
      `Remove the comma at the end of ${list(comma.map((n) => `“${n.name}”`))}. Check the spelling of each name below.`,
      { details: all.map((n) => n.name), where: at(comma[0].para) },
    )
  // Deans change and each faculty has its own: the name is the student's to check.
  if (dean)
    return review(
      id,
      "Check that the Dean's line names your faculty's current Dean, and the spelling of each name below: spelling cannot be checked here.",
      { details: all.map((n) => n.name), where: at(dean.para) },
    )
  // No line says "Dean" anywhere on the page: the Dean's block is missing.
  const r = ctx.s.acceptance
  if (r && !textIn(ctx, r.start, r.end).some((p) => /\bdean\b/i.test(p.text)))
    return fix(
      id,
      "Add the Dean's name and the line “Dean” with the faculty, as in the template.",
      {
        details: all.map((n) => n.name),
        where: at(all[all.length - 1].para),
      },
    )
  return review(id, 'Check the spelling of each name below: spelling cannot be checked here.', {
    details: all.map((n) => n.name),
  })
}

const PREFIX =
  /^(dr|(asst|assistant|assoc|associate)\.?\s*prof(essor)?|prof(essor)?|engr|atty|ms|mr|mrs|hon)\b\.?/i
// Degrees after a name, UPOU's among them (MDC, MDE, MDM, MAEd, MIS, MNSE…).
const DEGREES =
  'ph\\.?\\s?d|ed\\.?\\s?d|d\\.?\\s?comm|dcomm|d\\.?p\\.?a|mdc|mde|mdm|mis|mnse|maed|ma\\.?ed|m\\.?a|m\\.?s|m\\.?sc|mpa|mba|med|mph|mm|dvm|md|' +
  'dr\\.?\\s?p\\.?h|d\\.?p\\.?h|dprof(st)?|dnp|lpt|rgc|rpsy|rsw|rnd|psy\\.?\\s?d|j\\.?d|d\\.?b\\.?a|d\\.?sc|sc\\.?d|msn|mha|m\\.?eng|llb|llm|cpa|rn|rpm|mpm|mhrm'
const SUFFIX = new RegExp(`,\\s*(${DEGREES})\\.?$`, 'i')
// A space or a comma before it, so "ROMA" keeps its "MA".
const SUFFIX_ANY = new RegExp(`(?:,\\s*|\\s+)(${DEGREES})\\.?$`, 'i')

function convention(names: Names): Finding {
  const id = 'acceptance.convention'
  const all = [
    ...names.committee.map((n) => ({ ...n, name: n.real ?? n.name })),
    ...(names.dean ? [names.dean] : []),
  ].filter((n) => n.name && !/^name$/i.test(n.name))
  if (!all.length) return na(id, 'No committee names yet.')
  // With the names taken out (see the names item), one is no convention to compare.
  if (all.length < 2 && names.committee.some((n) => !n.name))
    return review(
      id,
      'Most names on the Acceptance Page are missing, so their style could not be compared. Once they are in, use titles before all names or degrees after all names.',
      { where: all.flatMap((n) => at(n.para)) },
    )
  // A name whose font came out as control characters: its title or degree cannot be told.
  const unreadable = all.filter((n) => [...n.name].some((c) => c.charCodeAt(0) < 32))
  if (unreadable.length)
    return review(
      id,
      'A name on the Acceptance Page could not be read reliably (its font is encoded oddly). Check that the names use titles before all names or degrees after all names, not a mix.',
      { where: unreadable.flatMap((n) => at(n.para)) },
    )
  // A stray comma after the degree ("Ph.D,") is a typo (acceptance.names says so), not a style.
  const style = (raw: string) => {
    // (a qualifier in brackets after the name, as "(candidate)", is neither title nor degree)
    const n = raw.replace(/[,;]\s*$/, '').replace(/\s*\([^)]*\)\s*$/, '')
    if (PREFIX.test(n)) return SUFFIX.test(n) ? 'both' : 'title'
    if (SUFFIX.test(n)) return 'degree'
    // Something short after a comma that is no degree this list knows (and no "Jr."): a degree
    // of another kind, or a typo.
    return /,\s*[^,\s][^,]{0,11}$/.test(n) && !/,\s*(jr|sr|ii|iii|iv)\.?$/i.test(n)
      ? 'unknown'
      : 'none'
  }
  const styles = all.map((n) => ({ ...n, style: style(n.name) }))
  const kinds = new Set(styles.map((s) => s.style))
  const unknown = styles.filter((s) => s.style === 'unknown')
  const known = new Set(styles.map((s) => s.style).filter((k) => k !== 'unknown'))
  if (unknown.length && known.size <= 1 && !known.has('both'))
    return review(
      id,
      `Check ${list(unknown.map((s) => `“${s.name}”`))}: the title or degree after the name is not one this checker knows. Use either titles before all names (DR. JUAN A. CRUZ) or degree abbreviations after all names (JUAN A. CRUZ, Ph.D.).`,
      { details: styles.map((s) => s.name), where: unknown.flatMap((s) => at(s.para)) },
    )
  // No name with a title or a degree: alike, but neither form the checklist names.
  if (kinds.size === 1 && kinds.has('none'))
    return review(
      id,
      'No name on the Acceptance Page has a title before it or a degree after it. Check whether your program asks for titles before all names (DR. JUAN A. CRUZ) or degree abbreviations after all names (JUAN A. CRUZ, Ph.D.).',
      { where: styles.flatMap((x) => at(x.para)) },
    )
  if (kinds.size === 1 && !kinds.has('both'))
    return ok(
      id,
      `All names use ${[...kinds][0] === 'title' ? 'titles (Dr./Asst. Prof.)' : [...kinds][0] === 'degree' ? 'degree abbreviations (Ph.D./MA)' : 'the same convention'}.`,
    )
  const describe = {
    title: 'title before the name',
    degree: 'degree after the name',
    both: 'title and degree',
    none: 'neither title nor degree',
    unknown: 'a title or degree this checker does not know',
  }
  // Where the mix is not a clear one, the student looks: a name with neither title nor degree
  // among the rest (a person may have none to show), a rank (Prof.) beside a Dean's degree, a Dean
  // with title and degree beside titles (the Dean's line comes from the template).
  const peers = styles.filter((x) => x.para !== names.dean?.para)
  const rank = (n: string) => /^(asst|assistant|assoc|associate)?\.?\s*prof/i.test(n)
  const bare = styles.filter((x) => x.style === 'none')
  const others = new Set(styles.filter((x) => x.style !== 'none').map((x) => x.style))
  const soft =
    (bare.length > 0 && others.size === 1 && !others.has('both')) ||
    (!!names.dean &&
      peers.length > 0 &&
      peers.every((x) => x.style === 'title') &&
      (kinds.has('both') || peers.every((x) => rank(x.name))))
  if (soft)
    return review(
      id,
      'Check the names on the Acceptance Page for uniformity: use either titles before all names (DR. JUAN A. CRUZ) or degree abbreviations after all names (JUAN A. CRUZ, Ph.D.). A name with neither, or a Dean whose line is fixed by the template, may be right as it is.',
      {
        details: styles.map((x) => `${x.name}: ${describe[x.style as keyof typeof describe]}`),
        where: styles.flatMap((x) => at(x.para)),
      },
    )
  // The places: the names that break the convention most of them follow.
  const count = (st: string) => styles.filter((s) => s.style === st).length
  const most = [...kinds].reduce((x, y) => (count(y) > count(x) ? y : x))
  const odd = new Set(
    styles.filter((s) => s.style !== most || s.style === 'both').map((s) => s.para),
  )
  return fix(
    id,
    'For uniformity, use either titles before all names (DR. JUAN A. CRUZ) or degree abbreviations after all names (JUAN A. CRUZ, Ph.D.).',
    {
      details: styles.map((s) => `${s.name}: ${describe[s.style as keyof typeof describe]}`),
      where: [...odd].flatMap(at),
    },
  )
}

export async function frontRules(ctx: Ctx): Promise<Finding[]> {
  const tp = readTitlePage(ctx)
  const names = readNames(ctx)
  const permHead = ctx.s.permission ? ctx.doc.paras[ctx.s.permission.heading] : undefined
  const accHead = ctx.s.acceptance ? ctx.doc.paras[ctx.s.acceptance.heading] : undefined
  // Scanned pages cannot be read: their items are for the student to check, not to add.
  const scans = scannedFront(ctx)
  const sealed = scans.includes(tp.page) ? undefined : await seal(ctx, tp)
  const unread = (part: string, why: string) =>
    CHECKLIST.find((p) => p.id === part)!.items.map((i) => review(i.id, why))
  const missing = (name: string) =>
    `No ${name} was found in the text. If it is one of the scanned pages, check this item yourself.`
  return [
    ...(!sealed
      ? unread(
          'title',
          'The title page is a scanned picture, so it could not be read here. Check this item yourself.',
        )
      : [
          sealed.finding,
          sequence(tp, sealed.emblem),
          titleUpper(tp),
          adviser(
            tp,
            names.committee.map((c) => c.name),
          ),
          dateOf(tp.date, 'title.date', 'title page'),
          permissionCode(ctx, tp),
          signature(
            ctx,
            tp.studentSig,
            'title.signature',
            'title page',
            tp.rows.at(-1)?.lines?.[0]?.y,
          ),
          folioCheck(
            ctx,
            'title.pageNumber',
            tp.paras[0] ?? ctx.doc.paras[0],
            'none',
            'title page',
            titleOf(tp),
          ),
        ]),
    ...((!permHead && scans.length) || scans.includes(permHead?.page ?? -1)
      ? unread(
          'permission',
          permHead
            ? 'This page is a scanned picture, so its text could not be read reliably. Check this item yourself.'
            : missing('University Permission Page'),
        )
      : [
          permissionTitle(ctx, tp),
          permissionStatement(ctx),
          permissionSignature(ctx),
          folioCheck(
            ctx,
            'permission.pageNumber',
            permHead,
            { kind: 'roman', value: 2 },
            'University Permission Page',
            titleOf(tp),
          ),
        ]),
    ...((!accHead && scans.length) || scans.includes(accHead?.page ?? -1)
      ? unread(
          'acceptance',
          accHead
            ? 'This page is a scanned picture, so its text could not be read reliably. Check this item yourself.'
            : missing('Acceptance Page'),
        )
      : [
          acceptanceTitle(ctx, tp),
          acceptanceNames(ctx, names),
          convention(names),
          folioCheck(
            ctx,
            'acceptance.pageNumber',
            accHead,
            { kind: 'roman', value: 3 },
            'Acceptance Page',
            titleOf(tp),
          ),
        ]),
  ]
}
