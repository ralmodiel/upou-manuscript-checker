// Title Page, University Permission Page and Acceptance Page.
import type { Box, Para } from '../model.ts'
import { CHECKLIST } from '../checklist.ts'
import { colourfulness, dHash, hamming, shrink } from '../images.ts'
import { fix, na, ok, review, worst, type Ctx, type Finding, type Where } from '../report.ts'
import { DATE, distance, isUpper, list, lowerWords, norm, quote, shown, wordDiff } from '../text.ts'
import { judge, pdfFolio, wordFolioAt, type Want } from './numbering.ts'

// The seal in the MDC template: its file's SHA-256 and its difference hash (scripts/probe/seal-hash.mjs).
export const SEAL_SHA256 = '1d89b4e2dbe46ea14a34faeeeb4a0fc18999438b12c4fae9bc8ac66abf6ae8c9'
export const SEAL_DHASH = '0e1f2b333313170e'
// The Dean of the Faculty of Information and Communication Studies, as the template names him.
const DEAN = 'ROBERTO B. FIGUEROA, JR.'

const at = (p: Para | undefined): Where[] => (p ? [{ page: p.page, quote: quote(p.text) }] : [])

const textIn = (ctx: Ctx, start: number, end: number) =>
  ctx.doc.paras.slice(start, end).filter((p) => norm(p.text))

const find = (paras: Para[], re: RegExp) => paras.find((p) => re.test(norm(p.text)))

/** A sentence's end, unless it already has one ("Ph.D."). */
const stop = (s: string) => (s.endsWith('.') ? s : s + '.')

// ---- The title page, read once ----

export interface TitlePage {
  paras: Para[]
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
}

const TABLE_ROW = /^(invention|publication|confidential|free)\s*\(/i
const ADVISER_LABEL = /^thesis adviser\b(?!'?s?\s*signature)/i

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
  // A scanned title page has no text: what comes after it is not the title page.
  const paras = scannedFront(ctx).includes(0) ? [] : textIn(ctx, ctx.s.title.start, ctx.s.title.end)
  const idx = (p?: Para) => (p ? paras.indexOf(p) : -1)
  const program = find(paras, /master of development communication|master of|program/i)
  const adviserLabel = find(paras, ADVISER_LABEL)
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
  }
}

export const titleOf = (tp: TitlePage) => norm(tp.title.map((p) => shown(p)).join(' '))

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

/** Whether something signature-like sits around a label line on a PDF page. */
function pdfMarkNear(ctx: Ctx, label: Para): boolean {
  const page = ctx.doc.pages?.[label.page ?? -1]
  const line = label.lines?.[0]
  if (!page || !line) return false
  const zone: Box = {
    x0: line.x0 - 20,
    x1: page.width,
    y0: line.y - 4 * line.size,
    y1: line.y + 2.5 * line.size,
  }
  const inside = (b: Box) => b.x1 > zone.x0 && b.x0 < zone.x1 && b.y1 > zone.y0 && b.y0 < zone.y1
  if (page.images.some(inside)) return true
  return page.marks.some(
    (m) =>
      inside(m) && (m.kind !== 'path' ? !/Widget:(Tx|Btn)/.test(m.kind) : (m.count ?? 0) > 120),
  )
}

/** A picture anchored within a couple of paragraphs of a label (Word). */
const wordPictureNear = (ctx: Ctx, label: Para) =>
  ctx.doc.pictures.some((pic) => Math.abs(pic.para - label.i) <= 3)

// ---- Title Page ----

async function seal(ctx: Ctx): Promise<Finding> {
  const id = 'title.seal'
  const { doc, s } = ctx
  const pic =
    doc.kind === 'pdf'
      ? doc.pictures.find((p) => p.para === -1)
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
      where: [{ page: 0 }],
    },
  )
}

const ANCHORS: [string, RegExp][] = [
  ['UNIVERSITY OF THE PHILIPPINES', /university of the philippines/i],
  ['OPEN UNIVERSITY', /open university/i],
  ['MASTER OF DEVELOPMENT COMMUNICATION', /master of development communication/i],
  ['Thesis Adviser:', ADVISER_LABEL],
  [
    'Faculty of Information and Communication Studies',
    /faculty of information and communication studies/i,
  ],
  ['Permission of the classification…', /permission of the classification/i],
  ['the permission codes (Invention, Publication, Confidential, Free)', /^invention\s*\(/i],
  ["Student's Signature:", /student'?s?\s+signature/i],
  ["Thesis Adviser's Signature:", /adviser'?s?\s+signature/i],
]

function sequence(tp: TitlePage): Finding {
  const id = 'title.sequence'
  const found = ANCHORS.map(([name, re]) => ({
    name,
    k: tp.paras.findIndex((p) => re.test(norm(p.text))),
  }))
  const missing = found.filter((a) => a.k < 0).map((a) => a.name)
  const issues: string[] = []
  if (missing.length) issues.push(`Missing: ${list(missing.map((m) => `“${m}”`))}`)
  const present = found.filter((a) => a.k >= 0)
  for (let k = 1; k < present.length; k++)
    if (present[k].k < present[k - 1].k)
      issues.push(`“${present[k].name}” should come after “${present[k - 1].name}”`)
  // The author's name comes before the title; a name is short, a title is long.
  if (tp.author && tp.title.length) {
    const words = (p: Para) => norm(p.text).split(' ').length
    if (words(tp.author) > 8 && tp.title.length === 1 && words(tp.title[0]) <= 6)
      issues.push('Write your name before the thesis title')
  }
  for (const [label, re, right] of [
    ['Student', /^student\s+signature/i, "Student's Signature"],
    ['Thesis Adviser', /adviser\s+signature/i, "Thesis Adviser's Signature"],
  ] as const) {
    const p = tp.paras.find((x) => re.test(norm(x.text)))
    if (p)
      issues.push(
        `Add an apostrophe and s to the signature label: “${right}” (not “${label} Signature”)`,
      )
  }
  if (!issues.length) return ok(id, 'The title page follows the order of the template.')
  return fix(id, 'Follow the sequence of information in the MDC template.', {
    details: issues,
    where: [{ page: 0 }],
  })
}

function titleUpper(tp: TitlePage): Finding {
  const id = 'title.title'
  const t = titleOf(tp)
  if (!t)
    return fix(id, 'Indicate the final thesis title between your name and “Thesis Adviser:”.', {
      where: [{ page: 0 }],
    })
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
    return fix(id, "Write your thesis adviser's name under “Thesis Adviser:”.", {
      where: [{ page: 0 }],
    })
  if (/^name$/i.test(name))
    return fix(id, "Replace “NAME” with your thesis adviser's name.", { where: at(tp.adviser) })
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
    `Adviser: ${stop(name)} Check the spelling against your adviser's own: spelling cannot be checked here.`,
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
  const xs = [
    ...page.glyphs.filter((g) => band(g) && g.x0 > from && MARK.test(g.text)).map((g) => g.x0),
    ...page.marks.filter((m) => band(m) && m.kind !== 'path' && m.x0 > from).map((m) => m.x0),
  ]
  return pick(xs.map((x) => (x < or.x0 ? 'yes' : 'no')))
}

function permissionCode(ctx: Ctx, tp: TitlePage): Finding {
  const id = 'title.permission'
  if (tp.rows.length < 4)
    return fix(
      id,
      'Add the permission classification table from the MDC template (Invention, Publication, Confidential, Free).',
      {
        where: [{ page: 0 }],
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
  const found = ctx.doc.kind === 'pdf' ? pdfMarkNear(ctx, label) : wordPictureNear(ctx, label)
  if (found) return ok(id, `Signature found on the ${page}.`)
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
): Finding {
  const { doc } = ctx
  if (!para) return na(id, `No ${name} found.`)
  if (doc.kind === 'pdf') {
    const page = para.page ?? 0
    const folio = pdfFolio(doc, page)
    const problems = judge(folio, want, page)
    if (!problems.length)
      return ok(id, want === 'none' ? `No page number on the ${name}.` : `${name}: “${folio?.raw}”`)
    return fix(id, wantMessage(want, name), {
      details: problems.map((p) => p.text),
      where: [{ page }],
    })
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

const wantMessage = (want: Want, name: string) =>
  want === 'none'
    ? `Remove the page number on the ${name}.`
    : `Add the shortened thesis title + ellipsis + page number (${want.kind === 'roman' && want.value ? ['', 'i', 'ii', 'iii'][want.value] : 'Roman numerals'}) on the ${name}.`

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
  const placeholder =
    above.some((p) => /^name and date$/i.test(norm(p.text))) || /name and date\s*$/i.test(lead)
  if (placeholder || !(above.some((p) => DATE.test(p.text)) || DATE.test(lead))) {
    issues.push(
      'Write your name and the date of submission above “Signature over Student Name and Date”.',
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
    message: 'Add your signature and the date of submission.',
    details: issues,
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
      `Title Page: “${quote(main, 90)}”; Acceptance Page: “${quote(t, 90)}”${d.onlyB.length ? ` (differs at “${d.onlyB.slice(0, 4).join(' ')}”)` : ''}.`,
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
  if (names.dean && bareName(names.dean.name) !== bareName(DEAN))
    return review(
      id,
      `Check the Dean's name: “${names.dean.name}”. The MDC template has “${DEAN}, Ph.D.”.`,
      { where: at(names.dean.para) },
    )
  return review(
    id,
    `Names: ${stop(list(all.map((n) => n.name)))} Check each spelling: spelling cannot be checked here.`,
  )
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
  const style = (n: string) =>
    PREFIX.test(n) ? (SUFFIX.test(n) ? 'both' : 'title') : SUFFIX.test(n) ? 'degree' : 'none'
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
  return fix(
    id,
    'For uniformity, use either titles before all names (DR. JUAN A. CRUZ) or degree abbreviations after all names (JUAN A. CRUZ, Ph.D.).',
    {
      details: styles.map((s) => `${s.name}: ${describe[s.style as keyof typeof describe]}`),
      where: at(styles[0].para),
    },
  )
}

export async function frontRules(ctx: Ctx): Promise<Finding[]> {
  const tp = readTitlePage(ctx)
  const names = readNames(ctx)
  const permHead = ctx.s.permission ? ctx.doc.paras[ctx.s.permission.heading] : undefined
  const accHead = ctx.s.acceptance ? ctx.doc.paras[ctx.s.acceptance.heading] : undefined
  const pageOf = (p?: Para) => (p?.page ?? 0) + 1
  // Scanned pages cannot be read: their items are for the student to check, not to add.
  const scans = scannedFront(ctx)
  const unread = (part: string, why: string) =>
    CHECKLIST.find((p) => p.id === part)!.items.map((i) => review(i.id, why))
  const missing = (name: string) =>
    `No ${name} was found in the text. If it is one of the scanned pages, check this item yourself.`
  return [
    ...(scans.includes(0)
      ? unread(
          'title',
          'The title page is a scanned picture, so it could not be read here. Check this item yourself.',
        )
      : [
          await seal(ctx),
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
            { kind: 'roman', value: ctx.doc.kind === 'pdf' ? pageOf(permHead) : 2 },
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
            { kind: 'roman', value: ctx.doc.kind === 'pdf' ? pageOf(accHead) : 3 },
            'Acceptance Page',
          ),
        ]),
  ]
}
