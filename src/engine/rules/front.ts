// Title Page, University Permission Page and Acceptance Page.
import type { Box, Para } from '../model.ts'
import { CHECKLIST } from '../checklist.ts'
import { colourfulness, dHash, hamming, shrink } from '../images.ts'
import { fix, na, ok, review, worst, type Ctx, type Finding, type Where } from '../report.ts'
import { titlePage } from '../structure.ts'
import {
  DATE,
  distance,
  isUpper,
  list,
  lowerWords,
  norm,
  quote,
  roman,
  shown,
  wordDiff,
} from '../text.ts'
import {
  judge,
  mainTitle,
  pagesText,
  pdfFolio,
  titleKey,
  wordFolioAt,
  type Want,
} from './numbering.ts'

// The seal in the MDC template: its file's SHA-256 and its difference hash (scripts/probe/seal-hash.mjs).
export const SEAL_SHA256 = '1d89b4e2dbe46ea14a34faeeeb4a0fc18999438b12c4fae9bc8ac66abf6ae8c9'
export const SEAL_DHASH = '0e1f2b333313170e'
// The Dean of the Faculty of Information and Communication Studies, as the template names him.
const DEAN = 'ROBERTO B. FIGUEROA, JR.'

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
  title: Para[]
  adviserLabel?: Para
  adviser?: Para
  faculty?: Para
  date?: Para
  permissionText?: Para
  rows: Para[]
  studentSig?: Para
  adviserSig?: Para
  /** "Thesis" or, on a doctoral dissertation, "Dissertation": the word before "Adviser". */
  work: 'Thesis' | 'Dissertation'
}

const TABLE_ROW = /^(invention|publication|confidential|free)\s*\(/i
// A doctoral dissertation on the same template has a "Dissertation Adviser:" and a "Doctor of …".
const ADVISER_LABEL = /^(thesis|dissertation) adviser\b(?!'?s?\s*signature)/i
const PROGRAM = /master of development communication|^doctor of\b/i

/** PDF pages before the other preliminary pages that hold a picture and no text: signed pages
 *  scanned back in, which cannot be read. */
function scannedFront(ctx: Ctx): number[] {
  const { doc, s } = ctx
  if (doc.kind !== 'pdf' || !doc.pages) return []
  const first = s.prelims[0] ?? s.chapters[0]
  const end = first ? (doc.paras[first.heading].page ?? 3) : 3
  return doc.pages
    .slice(0, end)
    .filter((pg) => !pg.paras.length && pg.images.length)
    .map((pg) => pg.n)
}

export function readTitlePage(ctx: Ctx): TitlePage {
  const { start, end } = ctx.s.title
  const page = titlePage(ctx.doc, ctx.s)
  // A scanned title page has no text: what comes after it is not the title page.
  const paras = scannedFront(ctx).includes(page) ? [] : textIn(ctx, start, end)
  const idx = (p?: Para) => (p ? paras.indexOf(p) : -1)
  const program = find(paras, PROGRAM) ?? find(paras, /master of|program/i)
  const adviserLabel = find(paras, ADVISER_LABEL)
  const work =
    /^dissertation/i.test(norm(adviserLabel?.text ?? '')) ||
    (!adviserLabel && /^doctor of/i.test(norm(program?.text ?? '')))
      ? 'Dissertation'
      : 'Thesis'
  const faculty = paras.find(
    (p, k) =>
      k > idx(adviserLabel) &&
      /faculty of information and communication studies/i.test(norm(p.text)),
  )
  const permissionText = find(paras, /permission of the classification/i)
  // Between the program and "Thesis Adviser:": the author, then the title (one or more lines).
  const between = paras.slice(idx(program) + 1, adviserLabel ? idx(adviserLabel) : idx(program) + 3)
  const author = between[0]
  const title = between.slice(1)
  // "Thesis Adviser:" with the name on the same line, or on the next.
  const inline =
    adviserLabel && norm(adviserLabel.text).replace(ADVISER_LABEL, '').replace(/^\s*:/, '').trim()
  const adviser = adviserLabel ? (inline ? adviserLabel : paras[idx(adviserLabel) + 1]) : undefined
  const afterFaculty = faculty
    ? paras.slice(idx(faculty) + 1, permissionText ? idx(permissionText) : idx(faculty) + 3)
    : []
  const date =
    afterFaculty.find((p) => DATE.test(p.text) || /day\s+month\s+year/i.test(p.text)) ??
    afterFaculty[0]
  return {
    paras,
    page,
    cover: textIn(ctx, 0, start)[0],
    coverPage: ctx.doc.pages?.slice(0, page).find((pg) => pg.images.length)?.n,
    program,
    author,
    title: title.filter((p) => p !== adviser),
    adviserLabel,
    adviser: adviser && !/faculty of/i.test(adviser.text) ? adviser : undefined,
    faculty,
    date: date && date !== permissionText ? date : undefined,
    permissionText,
    rows: paras.filter((p) => TABLE_ROW.test(norm(p.text))),
    studentSig: find(paras, /^student'?s?\s+signature/i),
    adviserSig: find(paras, /adviser'?s?\s+signature/i),
    work,
  }
}

export const titleOf = (tp: TitlePage) => norm(tp.title.map((p) => shown(p)).join(' '))

/** The thesis title on the title page, or '' when it cannot be read. */
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
    .replace(/^((dr|asst|assoc|prof|engr|atty|mr|ms|mrs)\.?\s+)+/i, '')
    .replace(
      /,?\s*(ph\.?\s?d|ed\.?\s?d|d\.?\s?comm|dcomm|d\.?p\.?a|mdc|m\.?a|m\.?s|m\.?sc|mpa|mba|med|mph)\.?$/i,
      '',
    )
    .replace(/,\s*$/, '')
    .toUpperCase()

// ---- Pictures and marks near a label ----

/** What signature-like sits around a label line on a PDF page: a mark (a picture, ink, a stamp,
 *  a drawn signature) or only a signature field, which may be signed or empty. */
function pdfMarkNear(ctx: Ctx, label: Para): 'mark' | 'field' | undefined {
  const page = ctx.doc.pages?.[label.page ?? -1]
  const line = label.lines?.[0]
  if (!page || !line) return undefined
  const zone: Box = {
    x0: line.x0 - 20,
    x1: page.width,
    y0: line.y - 4 * line.size,
    y1: line.y + 2.5 * line.size,
  }
  const inside = (b: Box) => b.x1 > zone.x0 && b.x0 < zone.x1 && b.y1 > zone.y0 && b.y0 < zone.y1
  // A signature is wider than a letter and taller than a rule: tick boxes drawn as pictures are not.
  const big = (b: Box) => b.x1 - b.x0 >= 2 * line.size && b.y1 - b.y0 >= 0.5 * line.size
  if (page.images.some((b) => inside(b) && big(b))) return 'mark'
  const near = page.marks.filter(inside)
  if (near.some((m) => (m.kind === 'path' ? (m.count ?? 0) > 120 : !/^Widget:/.test(m.kind))))
    return 'mark'
  // pdf.js does not tell a signed signature field from an empty one.
  return near.some((m) => m.kind === 'Widget:Sig') ? 'field' : undefined
}

/** A picture anchored within a couple of paragraphs of a label (Word). */
const wordPictureNear = (ctx: Ctx, label: Para) =>
  ctx.doc.pictures.some((pic) => Math.abs(pic.para - label.i) <= 3)

// ---- Title Page ----

async function seal(ctx: Ctx, tp: TitlePage): Promise<Finding> {
  const id = 'title.seal'
  const { doc, s } = ctx
  const pic =
    doc.kind === 'pdf'
      ? doc.pictures.find((p) => p.para === -1 && (p.page ?? 0) === tp.page)
      : doc.pictures.find((p) => p.para >= s.title.start && p.para < s.title.end)
  if (!pic) return fix(id, 'Add the official UP seal at the top of the title page.')
  let pixels = await pic.pixels?.()
  const bytes = pic.bytes?.()
  if (bytes && typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))
    const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
    if (hex === SEAL_SHA256)
      return ok(id, 'The official UP seal from the template is on the title page.')
  }
  if (!pixels && bytes && ctx.env.decodeImage) pixels = await ctx.env.decodeImage(bytes)
  if (!pixels)
    return review(
      id,
      'Make sure the picture on the title page is the official UP seal (copy it from the MDC template).',
    )
  const small = shrink(pixels, 64)
  const d = hamming(dHash(small), SEAL_DHASH)
  if (d <= 12 && colourfulness(small) > 25)
    return ok(id, 'The official UP seal is on the title page.')
  if (d <= 12)
    return review(
      id,
      'The seal on the title page looks faded or grey. Use the full-color official UP seal from the MDC template.',
    )
  return fix(
    id,
    'Use the official UP seal: the picture on the title page does not look like it. Copy the seal from the MDC template.',
    {
      where: [{ page: tp.page }],
    },
  )
}

/** The title page's parts in the template's order, named as a thesis or a dissertation has them. */
const anchors = (work: TitlePage['work']): [string, RegExp][] => [
  ['UNIVERSITY OF THE PHILIPPINES', /university of the philippines/i],
  ['OPEN UNIVERSITY', /open university/i],
  [
    work === 'Dissertation'
      ? 'the degree program (DOCTOR OF …)'
      : 'MASTER OF DEVELOPMENT COMMUNICATION',
    PROGRAM,
  ],
  [`${work} Adviser:`, ADVISER_LABEL],
  [
    'Faculty of Information and Communication Studies',
    /faculty of information and communication studies/i,
  ],
  ['Permission of the classification…', /permission of the classification/i],
  ['the permission codes (Invention, Publication, Confidential, Free)', /^invention\s*\(/i],
  ["Student's Signature:", /student'?s?\s+signature/i],
  [`${work} Adviser's Signature:`, /adviser'?s?\s+signature/i],
]

function sequence(tp: TitlePage): Finding {
  const id = 'title.sequence'
  const found = anchors(tp.work).map(([name, re]) => ({
    name,
    k: tp.paras.findIndex((p) => re.test(norm(p.text))),
  }))
  const missing = found.filter((a) => a.k < 0).map((a) => a.name)
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
  const present = found.filter((a) => a.k >= 0)
  for (let k = 1; k < present.length; k++)
    if (present[k].k < present[k - 1].k) {
      issues.push(`“${present[k].name}” should come after “${present[k - 1].name}”`)
      lines.push(tp.paras[present[k].k])
    }
  // The author's name comes before the title; a name is short, a title is long.
  if (tp.author && tp.title.length) {
    const words = (p: Para) => norm(p.text).split(' ').length
    if (words(tp.author) > 8 && tp.title.length === 1 && words(tp.title[0]) <= 6) {
      issues.push(`Write your name before the ${tp.work.toLowerCase()} title`)
      lines.push(tp.author)
    }
  }
  for (const [re, right] of [
    [/^student\s+signature/i, "Student's Signature"],
    [/adviser\s+signature/i, "Adviser's Signature"],
  ] as const) {
    const p = tp.paras.find((x) => re.test(norm(x.text)))
    if (p) {
      // As the file names the work: "Thesis" or "Dissertation" Adviser.
      const label = norm(p.text).replace(/\s*:$/, '')
      const work = /^(thesis|dissertation)\b/i.exec(label)?.[1] ?? tp.work
      const want = right.startsWith('Adviser')
        ? `${work[0].toUpperCase()}${work.slice(1).toLowerCase()} ${right}`
        : right
      issues.push(
        `Add an apostrophe and s to the signature label: “${want}” (not “${quote(label, 40)}”)`,
      )
      lines.push(p)
    }
  }
  if (!issues.length) return ok(id, 'The title page follows the order of the template.')
  return fix(id, 'Follow the sequence of information in the MDC template.', {
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
      `Indicate the final ${tp.work.toLowerCase()} title between your name and “${tp.work} Adviser:”.`,
      {
        where: [{ page: tp.page }],
      },
    )
  if (/^title$/i.test(t))
    return fix(id, 'Replace “TITLE” with your final thesis title, in upper case.', {
      where: at(tp.title[0]),
    })
  if (!isUpper(t))
    return fix(id, 'Write the thesis title in upper case.', {
      details: [
        `Not in upper case: ${list(
          lowerWords(t)
            .slice(0, 8)
            .map((w) => `“${w}”`),
        )}`,
      ],
      where: at(tp.title[0]),
    })
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
    return fix(
      id,
      `Write your ${tp.work.toLowerCase()} adviser's name under “${tp.work} Adviser:”.`,
      {
        where: [{ page: tp.page }],
      },
    )
  if (/^name$/i.test(name))
    return fix(id, `Replace “NAME” with your ${tp.work.toLowerCase()} adviser's name.`, {
      where: at(tp.adviser),
    })
  const chair = committee[0] ? bareName(committee[0]) : ''
  const mine = bareName(name)
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
  if (DATE.test(p.text)) return ok(id, `Date of submission: ${norm(p.text)}`)
  return review(
    id,
    `Write the date of submission (Day Month Year) on the ${where}; “${quote(p.text, 40)}” is not a date.`,
    { where: at(p) },
  )
}

type Choice = 'yes' | 'no' | 'both' | 'none'
// Ticks and crosses, including symbol-font ticks that PDFs extract as ü, þ or private-use letters.
const MARK = /[✓✔✗✘☒☑■●√xX/üþýû-]/
const pick = (sides: ('yes' | 'no')[]): Choice =>
  !sides.length ? 'none' : new Set(sides).size === 2 ? 'both' : sides[0]

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
      ...(boxes[0] && MARK.test(boxes[0].text) ? (['yes'] as const) : []),
      ...(boxes[1] && MARK.test(boxes[1].text) ? (['no'] as const) : []),
    ])
    if (boxed !== 'none') return boxed
    // Typed beside the words ("☒ Yes or ☐ No"), or one of the two words deleted.
    const t = norm(cell.text).replace(/[☐□]/g, ' ')
    const yes = /\byes\b/i.exec(t)
    const no = /\bno\b/i.exec(t)
    if (yes && !no) return 'yes'
    if (no && !yes) return 'no'
    if (!yes || !no) return 'none'
    const divider = /\bor\b/i.exec(t)?.index ?? (yes.index + no.index) / 2
    const marks = [...t.matchAll(/[✓✔✗✘☒☑■●√]|(?<![a-z])[xX](?![a-z])/g)].map((m) => m.index)
    return pick(marks.map((k) => (k < divider ? 'yes' : 'no')))
  }
  // PDF: a tick or cross (a one-letter word or an annotation) in this row's band.
  const page = doc.pages?.[row.page ?? -1]
  const line = row.lines?.[0]
  if (!page || !line) return 'none'
  // One of the two words deleted, as in a Word file.
  const yes = /\byes\b/i.test(line.text)
  if (yes !== /\bno\b/i.test(line.text)) return yes ? 'yes' : 'no'
  const or = line.spans.find((s) => /^or$/i.test(s.text))
  const yesWord = line.spans.find((s) => /^yes$/i.test(s.text))
  if (!or || !yesWord) return 'none'
  // Same row: the mark's middle within half a line of the row's middle.
  const band = (b: Box) =>
    Math.abs((b.y0 + b.y1) / 2 - (line.y - 0.3 * line.size)) < 0.5 * line.size
  const from = yesWord.x0 - 4 * line.size
  const side = (x: number) => (x < or.x0 ? 'yes' : 'no')
  // Filled shapes on both sides are the boxes themselves; on one side only, they mark it: a box
  // filled in, a word highlighted (a filled shape, not white, wider than a rule, no wider than a word).
  const oneSide = (xs: number[]) => (new Set(xs.map(side)).size === 1 ? xs : [])
  const width = (b: Box) => b.x1 - b.x0
  // Pictures (a Google Docs export draws its boxes as pictures): those on one side only, or more of
  // them on one side (a tick pasted on its box), mark it; with one box picture a side, the clearly
  // darker one is a ticked box swapped in.
  const pics = page.images.filter((b) => band(b) && b.x0 > from)
  const on = (s: Choice) => pics.filter((b) => side(b.x0) === s)
  const ink = (s: Choice) => Math.max(0, ...on(s).map((b) => b.ink ?? 0))
  const [left, right] = [on('yes').length, on('no').length]
  const marked: Choice | undefined =
    left !== right
      ? left > right
        ? 'yes'
        : 'no'
      : Math.abs(ink('yes') - ink('no')) > 0.02
        ? ink('yes') > ink('no')
          ? 'yes'
          : 'no'
        : undefined
  const pictures = marked ? on(marked).map((b) => b.x0) : []
  const filled = page.marks
    .filter(
      (m) =>
        m.kind === 'path' &&
        !!m.fill &&
        m.fill !== '#ffffff' &&
        band(m) &&
        m.x0 > from &&
        width(m) >= 0.4 * line.size &&
        width(m) <= 4 * line.size,
    )
    .map((m) => m.x0)
  const xs = [
    ...page.glyphs.filter((g) => band(g) && g.x0 > from && MARK.test(g.text)).map((g) => g.x0),
    // Annotations and form fields, but not a checkbox left unticked.
    ...page.marks
      .filter((m) => band(m) && m.kind !== 'path' && m.on !== false && m.x0 > from)
      .map((m) => m.x0),
    ...pictures,
    ...oneSide(filled),
  ]
  return pick(xs.map(side))
}

function permissionCode(ctx: Ctx, tp: TitlePage): Finding {
  const id = 'title.permission'
  if (tp.rows.length < 4)
    return fix(
      id,
      'Add the permission classification table from the MDC template (Invention, Publication, Confidential, Free).',
      {
        where: [{ page: tp.page }],
      },
    )
  const rows = tp.rows.slice(0, 4).map((r) => ({
    name:
      TABLE_ROW.exec(norm(r.text))?.[0].replace(/\($/, '').trim() +
      ` (${/\(([A-Z])\)/.exec(r.text)?.[1] ?? '?'})`,
    choice: rowChoice(ctx, r),
  }))
  const yes = rows.filter((r) => r.choice === 'yes')
  const unmarked = rows.filter((r) => r.choice === 'none')
  const both = rows.filter((r) => r.choice === 'both')
  const where = at(tp.rows[0])
  const msg = "Select one permission code (one 'Yes', others marked as 'No')."
  if (unmarked.length === 4)
    return fix(id, msg, { details: ['No mark found beside any “Yes” or “No”.'], where })
  const details: string[] = []
  if (both.length)
    details.push(`Both “Yes” and “No” are marked for ${list(both.map((r) => r.name))}.`)
  if (yes.length > 1)
    details.push(`More than one code is marked “Yes”: ${list(yes.map((r) => r.name))}.`)
  if (!yes.length && !both.length) details.push('No code is marked “Yes”.')
  if (unmarked.length) details.push(`Not marked: ${list(unmarked.map((r) => r.name))}.`)
  if (details.length) return fix(id, msg, { details, where })
  return ok(id, `Permission code: ${yes[0].name} is “Yes”; the others are “No”.`)
}

function signature(ctx: Ctx, label: Para | undefined, id: string, page: string): Finding {
  if (!label) return fix(id, `Affix your signature on the ${page}.`)
  const found =
    ctx.doc.kind === 'pdf' ? pdfMarkNear(ctx, label) : wordPictureNear(ctx, label) && 'mark'
  if (found === 'mark') return ok(id, `Signature found on the ${page}.`)
  if (found === 'field')
    return review(
      id,
      `Check that the signature field beside “${quote(label.text, 40)}” is signed: an empty field looks the same here.`,
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
    const problems = judge(folio, want, page)
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
          type: 'changed',
          page,
          text: `${pagesText([page])}: the footer has another title, “${quote(folio.title, 40)}”, than the other preliminary pages (“${quote(main.shown, 40)}”); keep one shortened title`,
        })
    }
    if (!problems.length)
      return ok(id, want === 'none' ? `No page number on the ${name}.` : `${name}: “${folio?.raw}”`)
    const whole =
      !!full && !!titleKey(full) && titleKey(folio?.title ?? '').includes(titleKey(full))
    return fix(
      id,
      problems.length === 1 && problems[0].type === 'changed'
        ? `Use the same shortened title in the footer of the ${name} as on the other preliminary pages.`
        : wantMessage(want, name, folio?.title ? (whole ? 'title' : 'shortened title') : undefined),
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
    : `Add the shortened thesis title + ellipsis + page number (${want.kind === 'roman' && want.value ? roman(want.value) : 'Roman numerals'}) on the ${name}.`

// ---- University Permission Page ----

function permissionTitle(ctx: Ctx, tp: TitlePage): Finding {
  const id = 'permission.title'
  const r = ctx.s.permission
  if (!r) return fix(id, 'Add the University Permission Page from the MDC template.')
  const paras = textIn(ctx, r.heading + 1, r.end)
  const end = paras.findIndex((p) => /^["“]?\s*I hereby grant|specifically/i.test(norm(p.text)))
  const lines = paras
    .slice(0, end < 0 ? 1 : end)
    .filter((p) => !/^university permission page$/i.test(norm(p.text)))
  const t = norm(lines.map(shown).join(' '))
  if (!t || /^title$/i.test(t))
    return fix(id, 'Indicate the thesis title (in upper case) on the University Permission Page.', {
      where: at(lines[0]),
    })
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
  if (main && norm(main).toLowerCase() !== t.toLowerCase()) {
    const d = wordDiff(main, t)
    details.push(
      `It differs from the Title Page${d.onlyB.length ? `: “${d.onlyB.slice(0, 5).join(' ')}” here` : ''}${d.onlyA.length ? `, “${d.onlyA.slice(0, 5).join(' ')}” on the Title Page` : ''}.`,
    )
  }
  if (details.length)
    return fix(id, 'Use the final thesis title, in upper case, as on the Title Page.', {
      details,
      where: at(lines[0]),
    })
  return ok(id, 'The title matches the Title Page and is in upper case.')
}

function permissionStatement(ctx: Ctx): Finding {
  const id = 'permission.statement'
  const r = ctx.s.permission
  if (!r) return fix(id, 'Add the University Permission Page from the MDC template.')
  const paras = textIn(ctx, r.start, r.end)
  const allow = find(paras, /I specifically allow/i)
  const grant = find(paras, /Specifically,? I grant/i)
  if (allow && grant)
    return fix(id, 'Omit the “I specifically allow…”; retain the “Specifically, I grant…”.', {
      where: at(allow),
    })
  if (allow || grant)
    return ok(id, `Uses only “${allow ? 'I specifically allow…' : 'Specifically, I grant…'}”.`)
  return review(
    id,
    'The permission statement (“Specifically, I grant…”) was not found. Use the wording of the MDC template.',
  )
}

function permissionSignature(ctx: Ctx): Finding {
  const id = 'permission.signature'
  const r = ctx.s.permission
  if (!r) return fix(id, 'Add the University Permission Page from the MDC template.')
  const paras = textIn(ctx, r.start, r.end)
  const label = find(paras, /signature over (student|printed)? ?name/i) ?? find(paras, /signature/i)
  const k = label ? paras.indexOf(label) : paras.length
  const above = paras.slice(Math.max(0, k - 3), k)
  // The name and date may share the label's paragraph (a PDF line above it, joined).
  const lead = label ? norm(label.text).split(/signature over/i)[0] : ''
  const issues: string[] = []
  const statuses: Finding['status'][] = []
  const typed = [...above.map((p) => norm(p.text)), lead.trim()]
  const placeholder = typed.some((t) => /\bname and date$/i.test(t))
  if (placeholder || !typed.some((t) => DATE.test(t))) {
    issues.push(
      // The template's "and Date" kept after the student's own name.
      !placeholder && typed.some((t) => /\band date$/i.test(t))
        ? 'Replace “and Date” after your name with the date of submission.'
        : 'Write your name and the date of submission above “Signature over Student Name and Date”.',
    )
    statuses.push('fix')
  }
  const sig = signature(ctx, label, id, 'University Permission Page')
  if (sig.status !== 'ok') {
    issues.push(sig.message)
    statuses.push(sig.status)
  }
  if (!issues.length)
    return ok(id, 'Signature, name and date are on the University Permission Page.')
  return {
    id,
    status: worst(statuses),
    message: issues.length === 1 ? issues[0] : 'Add your signature and the date of submission.',
    details: issues.length === 1 ? undefined : issues,
    where: at(label),
  }
}

// ---- Acceptance Page ----

interface Names {
  committee: { name: string; para: Para }[]
  dean?: { name: string; para: Para }
}

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
    if (/^(chair|member|adviser|co-adviser|reader)\b.*committee|^(chair|member)\b/i.test(t))
      committee.push({ name: cleanName(shown(prev)), para: prev })
    else if (/^dean\b/i.test(t)) dean = { name: cleanName(shown(prev)), para: prev }
  })
  return { committee, dean }
}

function acceptanceTitle(ctx: Ctx, tp: TitlePage): Finding {
  const id = 'acceptance.title'
  const r = ctx.s.acceptance
  if (!r) return fix(id, 'Add the Acceptance Page from the MDC template.')
  const paras = textIn(ctx, r.start, r.end)
  const p = find(paras, /with the title|entitled|titled/i)
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
            .join(' '),
        )
  const m = p
    ? /(?:with the title|entitled|titled)\s*:?\s*["“'‘]?(.+?)["”'’]?\s*,?\s*(?:is hereby accepted|which|has been|is accepted|$)/i.exec(
        sentence,
      )
    : null
  const t = m?.[1]?.replace(/["”]$/, '').trim() ?? ''
  if (!t || /^x{4,}$/i.test(t))
    return fix(id, 'Indicate the final thesis title on the Acceptance Page.', { where: at(p) })
  const main = titleOf(tp)
  const issues: string[] = []
  if (main && norm(main).toLowerCase() !== norm(t).toLowerCase()) {
    const d = wordDiff(main, t)
    issues.push(
      `Title Page: “${quote(main, 90)}”; Acceptance Page: “${quote(t, 90)}”${
        d.onlyB.length
          ? ` (not on the Title Page: ${d.onlyB
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
    return fix(id, 'Replace with the approved thesis title (the same as on the Title Page).', {
      details: issues,
      where: at(p),
    })
  return ok(id, 'The title matches the Title Page.')
}

function acceptanceNames(ctx: Ctx, names: Names): Finding {
  const id = 'acceptance.names'
  if (!ctx.s.acceptance) return fix(id, 'Add the Acceptance Page from the MDC template.')
  const all = [...names.committee, ...(names.dean ? [names.dean] : [])]
  const blank = all.filter((n) => !n.name || /^name$/i.test(n.name))
  if (!all.length || blank.length)
    return fix(id, "Complete the advisory committee's and the Dean's names.", {
      details: blank.length
        ? [`${blank.length} name line${blank.length > 1 ? 's still say' : ' still says'} “NAME”.`]
        : undefined,
      where: at(blank[0]?.para),
    })
  const dean = names.dean
  const deanOff = !!dean && bareName(dean.name) !== bareName(DEAN)
  // A committee member's name left on the Dean's line (a line copied and not changed).
  if (dean && deanOff && names.committee.some((c) => bareName(c.name) === bareName(dean.name)))
    return fix(
      id,
      `Write the Dean's name on the Dean's line: “${dean.name}” is a committee member's name (the MDC template has “${DEAN}, Ph.D.”). Check the spelling of each committee name below.`,
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
  if (dean && deanOff)
    return review(
      id,
      `Check the Dean's name (the MDC template has “${DEAN}, Ph.D.”) and the spelling of each name below: spelling cannot be checked here.`,
      { details: all.map((n) => n.name), where: at(dean.para) },
    )
  return review(id, 'Check the spelling of each name below: spelling cannot be checked here.', {
    details: all.map((n) => n.name),
  })
}

const PREFIX = /^(dr|asst\.?\s*prof|assoc\.?\s*prof|prof|engr|atty)\b\.?/i
const SUFFIX =
  /,\s*(ph\.?\s?d|ed\.?\s?d|d\.?\s?comm|dcomm|d\.?p\.?a|mdc|m\.?a|m\.?s|m\.?sc|mpa|mba|med|mph|dvm|md)\.?$/i

function convention(names: Names): Finding {
  const id = 'acceptance.convention'
  const all = [...names.committee, ...(names.dean ? [names.dean] : [])].filter(
    (n) => n.name && !/^name$/i.test(n.name),
  )
  if (!all.length) return na(id, 'No committee names yet.')
  // A stray comma after the degree ("Ph.D,") is a typo (acceptance.names says so), not a style.
  const style = (raw: string) => {
    const n = raw.replace(/[,;]\s*$/, '')
    return PREFIX.test(n) ? (SUFFIX.test(n) ? 'both' : 'title') : SUFFIX.test(n) ? 'degree' : 'none'
  }
  const styles = all.map((n) => ({ ...n, style: style(n.name) }))
  const kinds = new Set(styles.map((s) => s.style))
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
  }
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
  const unread = (part: string, why: string) =>
    CHECKLIST.find((p) => p.id === part)!.items.map((i) => review(i.id, why))
  const missing = (name: string) =>
    `No ${name} was found in the text. If it is one of the scanned pages, check this item yourself.`
  return [
    ...(scans.includes(tp.page)
      ? unread(
          'title',
          'The title page is a scanned picture, so it could not be read here. Check this item yourself.',
        )
      : [
          await seal(ctx, tp),
          sequence(tp),
          titleUpper(tp),
          adviser(
            tp,
            names.committee.map((c) => c.name),
          ),
          dateOf(tp.date, 'title.date', 'title page'),
          permissionCode(ctx, tp),
          signature(ctx, tp.studentSig, 'title.signature', 'title page'),
          folioCheck(
            ctx,
            'title.pageNumber',
            tp.paras[0] ?? ctx.doc.paras[0],
            'none',
            'title page',
            titleOf(tp),
          ),
        ]),
    ...(!permHead && scans.length
      ? unread('permission', missing('University Permission Page'))
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
          ),
        ]),
    ...(!accHead && scans.length
      ? unread('acceptance', missing('Acceptance Page'))
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
          ),
        ]),
  ]
}
