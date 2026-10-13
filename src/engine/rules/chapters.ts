// First page of each chapter, and the succeeding pages.
import type { Para } from '../model.ts'
import { fix, na, ok, review, weigh, type Ctx, type Finding } from '../report.ts'
import { bolded, isHeadingish, type Chapter } from '../structure.ts'
import { isUpper, list, norm, plural, quote, roman, shown } from '../text.ts'
import { bodyParas, CAPTION, doubleSpaced, inShape, isList, justified, textSize } from './body.ts'
import type { Caption } from './figures.ts'
import { readTitlePage, thesisTitle } from './front.ts'
import {
  auditPdf,
  lookNote,
  lookOnly,
  unreadNote,
  clip,
  judge,
  more,
  pagesText,
  noTextPages,
  pdfFolio,
  prelimTitle,
  sectionStarts,
  summarize,
  titleKey,
  wordFolioAt,
  wordSectionFolios,
  type Problem,
} from './numbering.ts'

const isArial = (font?: string) =>
  !font || /arial|arimo|liberation sans|helvetica|nimbus san|freesans|tex gyre heros/i.test(font)

/** A PDF paragraph set in a font whose name says nothing: its bold and typeface are unknown. */
const faceUnknown = (p: Para) => p.runs.some((r) => r.unknown && r.text.trim())

/** A PDF whose running text is smaller than 12 pt all through (a page printed at 94 %: 11.26 pt,
 *  11 pt) shows its chapter titles smaller too: their size is then the text's, not a fault of
 *  theirs. The text's size, then. */
const reducedScale = (ctx: Ctx) => {
  if (ctx.doc.kind !== 'pdf') return undefined
  const size = textSize(ctx.doc.paras)
  return size > 9.5 && size < 11.8 ? size : undefined
}

/** Bold, Arial and 12 pt over the paragraph's text: the problems found, and whether the size is
 *  only that of a reduced scale (`scale`: the text's own size). */
function typeface(p: Para, what: string, scale?: number): { issues: string[]; scaled: boolean } {
  const out: string[] = []
  if (p.plain) return { issues: out, scaled: false }
  const runs = p.runs.filter((r) => r.text.trim())
  if (!bolded(p) && !faceUnknown(p)) out.push(`${what} is not bold`)
  const fonts = [...new Set(runs.map((r) => r.font).filter((f) => f && !isArial(f)))]
  if (fonts.length) out.push(`${what} is in ${fonts.join(', ')}, not Arial`)
  // Small capitals (a 12 pt capital, then the rest of the word in capitals about 0.7 of that size)
  // are 12 pt type.
  const caps = runs.every((r) => r.text === r.text.toUpperCase())
  const smallCaps = (z?: number) =>
    caps && z !== undefined && z >= 0.65 * 12 && z <= 0.76 * 12 && runs.some((r) => r.size === 12)
  const off = [
    ...new Set(
      runs
        .map((r) => r.size)
        .filter((z) => z !== undefined && Math.abs(z - 12) > 0.3 && !smallCaps(z)),
    ),
  ]
  const sizes = off.filter((z) => scale === undefined || Math.abs(z! - scale) > 0.3)
  if (sizes.length) out.push(`${what} is ${sizes.join(', ')} pt, not 12 pt`)
  return { issues: out, scaled: scale !== undefined && off.length > sizes.length }
}

/** Other programs set their sections "I. INTRODUCTION", "II. …" (a special problem, a capstone
 *  project, a thesis): the MDC thesis template’s “Chapter I” label is then for the student to
 *  weigh, not to correct. Only the MDC's own program is held to it. */
const numberedSections = (ctx: Ctx) => {
  try {
    return !/development communication/i.test(norm(readTitlePage(ctx).program?.text ?? ''))
  } catch {
    return true
  }
}

const chapterName = (c: Chapter) =>
  c.unlabelled ? `“${quote(c.label, 40)}”` : c.label.replace(/^chapter/i, 'Chapter')
const at = (p?: Para) => (p ? [{ page: p.page, quote: quote(p.text, 50) }] : [])

/** Paragraphs on a chapter's first page (a PDF knows; a Word file is cut at about a page of text). */
function firstPage(ctx: Ctx, c: Chapter): Set<number> {
  const { doc } = ctx
  const head = doc.paras[c.heading]
  const out = new Set<number>()
  let chars = 0
  for (let k = c.heading; k < c.end; k++) {
    const p = doc.paras[k]
    if (doc.kind === 'pdf') {
      if (p.page !== head.page) break
    } else {
      if (k > c.heading && (p.newPage || p.renderedBreak === 'before')) break
      if (chars > 1500) break
      chars += norm(p.text).length
    }
    out.add(k)
  }
  return out
}

/** PDF: a heading that opens its page far down it, more than `drop` points (a third of the page
 *  unless given) below where the pages' text starts, with no picture above it: empty lines push
 *  it down. */
export function pushedDown(ctx: Ctx, p: Para, drop?: number): boolean {
  const first = p.lines?.[0]
  const page = ctx.doc.pages?.[first?.page ?? -1]
  if (!first || !page || page.images.some((b) => b.y1 <= first.y)) return false
  const tops = new Map<number, number>()
  for (const q of ctx.doc.paras)
    for (const l of q.lines ?? []) tops.set(l.page, Math.min(tops.get(l.page) ?? l.y, l.y))
  const ys = [...tops.values()].sort((a, b) => a - b)
  return (
    tops.get(first.page) === first.y && first.y > ys[ys.length >> 1] + (drop ?? page.height / 3)
  )
}

function newPage(ctx: Ctx): Finding {
  const id = 'chapterStart.newPage'
  const { chapters } = ctx.s
  const paras = ctx.doc.paras
  const late = chapters.filter(
    (c) => !paras[c.heading].newPage && paras[c.heading].renderedBreak !== 'before',
  )
  // On a new page, but far down it: empty lines before the label rather than a page break.
  // 1.5 in: a heading style's space before stays well under it, empty lines do not.
  const low = late.length ? [] : chapters.filter((c) => pushedDown(ctx, paras[c.heading], 108))
  if (low.length)
    return review(
      id,
      'Start each chapter at the top of a new page, with a page break (Ctrl+Enter) before it, not empty lines.',
      {
        details: low.map(
          (c) => `${chapterName(c)} starts far down ${pagesText([paras[c.heading].page!])}`,
        ),
        where: low.flatMap((c) => at(paras[c.heading])),
      },
    )
  if (!late.length) return ok(id, `All ${plural(chapters.length, 'chapter')} start on a new page.`)
  if (ctx.doc.kind === 'pdf')
    return fix(id, 'Start each chapter on a new page.', {
      details: [`Not at the top of a page: ${list(late.map(chapterName))}.`],
      where: late.flatMap((c) => at(paras[c.heading])),
    })
  // A chapter that follows text on the same page with no break between (a continuous section
  // break, or none at all) cannot be on a new page; one after empty lines may be, if they spill.
  const runsOn = (c: Chapter) => {
    const p = paras[c.heading]
    const sec = ctx.doc.sections?.[p.section ?? -1]
    return (
      ctx.doc.kind !== 'doc' &&
      ((!!sec && !sec.newPage && sec.first <= c.heading) ||
        (!!paras[c.heading - 1] && !!norm(paras[c.heading - 1].text)))
    )
  }
  const msg =
    'Start each chapter on a new page with a page or section break (Ctrl+Enter), not empty lines.'
  const sure = late.filter(runsOn)
  return (sure.length ? fix : review)(id, msg, {
    details: [
      `No page break before ${list(late.map(chapterName))}${sure.length ? `: ${list(sure.map(chapterName))} follow${sure.length === 1 ? 's' : ''} the text above on the same page` : ''}.`,
    ],
    where: late.flatMap((c) => at(paras[c.heading])),
  })
}

function number(ctx: Ctx): Finding {
  const id = 'chapterStart.number'
  const { chapters } = ctx.s
  const paras = ctx.doc.paras
  if (!chapters.length)
    return fix(
      id,
      'Start each chapter with its number (in title case, Roman numeral, bold, Arial 12 pt.), e.g. “Chapter I”.',
    )
  const issues: string[] = []
  const wrong: Para[] = []
  const unsure: string[] = []
  const soft: string[] = []
  const scaled: string[] = []
  const scale = reducedScale(ctx)
  const special = numberedSections(ctx)
  for (const c of chapters) {
    const p = paras[c.heading]
    const word = /^chapter/i.exec(norm(p.text))?.[0] ?? 'Chapter'
    // The label as it should read ("CHAPTER ONE" → "Chapter I").
    const right = `Chapter ${(c.number ? roman(c.number) : c.numeral).toUpperCase()}`
    const before = issues.length
    if (c.unlabelled) {
      ;(special ? soft : issues).push(
        `${chapterName(c)}: the chapter number is missing (write ${right} on its own line, with the title below it)`,
      )
      wrong.push(p)
      continue
    }
    if (!/^[IVXLC]+$/.test(c.numeral))
      issues.push(`“${c.label}”: chapter numbers must be in Roman numerals (${right})`)
    if (word !== 'Chapter' || /^CHAPTER$/.test(shown(p).slice(0, 7)))
      issues.push(`“${c.label}”: write it in title case (${right})`)
    const tf = typeface(p, `“${c.label}”`, scale)
    issues.push(...tf.issues)
    if (tf.scaled) scaled.push(chapterName(c))
    if (issues.length > before) wrong.push(p)
    if (faceUnknown(p)) unsure.push(chapterName(c))
  }
  const nums = chapters.map((c) => c.number ?? 0)
  // A chapter that may stand on pages with no text layer (a picture, drawn letters) between two
  // that were read is not missing, only unread.
  const unread = noTextPages(ctx.doc)
  const hidden = unread.size > 0 && ctx.doc.kind === 'pdf'
  if (nums.some((x, k) => x !== k + 1)) {
    if (hidden && nums.every((x, k) => k === 0 || x > nums[k - 1])) {
      if (!unsure.length)
        unsure.push(`the chapters (some pages have no text layer, so a chapter may be among them)`)
    } else
      issues.push(
        `Chapter numbers should run I, II, III… in order (found ${chapters.map((c) => c.numeral).join(', ')})`,
      )
  }
  if (!issues.length && soft.length)
    return review(
      id,
      'The sections are numbered “I.”, “II.”… with no “Chapter” label. The thesis template labels each chapter (“Chapter I”, with its title on the next line); check with your program whether a special problem does too.',
      { details: soft.slice(0, 8), where: wrong.slice(0, 5).flatMap(at) },
    )
  if (!issues.length && scaled.length)
    return review(
      id,
      `${list(scaled)} ${scaled.length > 1 ? 'are' : 'is'} set in the size of the body text (${scale} pt), so this PDF may have been printed at a reduced scale. Check in your file that the chapter numbers are 12 pt.`,
      { where: [{ page: paras[chapters[0].heading].page }] },
    )
  if (!issues.length && unsure.length)
    return review(
      id,
      `Check that ${list(unsure)} ${unsure.length > 1 ? 'are' : 'is'} bold, Arial 12 pt: the fonts of this PDF are not named in it, so they could not be read.`,
      { where: unsure.length ? [{ page: paras[chapters[0].heading].page }] : undefined },
    )
  if (!issues.length)
    return ctx.doc.kind === 'doc'
      ? review(
          id,
          `${list(chapters.map(chapterName))}: title case and Roman numerals. Check that they are bold, Arial 12 pt (an old .doc file does not say).`,
        )
      : ok(id, `${list(chapters.map(chapterName))}: title case, Roman numerals, bold Arial 12 pt.`)
  return fix(
    id,
    'Write each chapter number in title case with a Roman numeral, bold, Arial 12 pt. (Chapter I).',
    {
      details: issues.slice(0, 8),
      where: (wrong.length ? wrong : [paras[chapters[0].heading]]).slice(0, 5).flatMap(at),
    },
  )
}

/** The runs of a heading "I. INTRODUCTION" after its number and full stop. */
function afterNumber(p: Para) {
  let skip =
    /^\s*(\d{1,2}|[IVXLCivxlc]+)\s*[.)]\s+/.exec(p.runs.map((r) => r.text).join(''))?.[0].length ??
    0
  return p.runs.flatMap((r) => {
    const cut = Math.min(skip, r.text.length)
    skip -= cut
    return cut >= r.text.length ? [] : [{ ...r, text: r.text.slice(cut) }]
  })
}

function title(ctx: Ctx): Finding {
  const id = 'chapterStart.title'
  const { chapters } = ctx.s
  const paras = ctx.doc.paras
  const issues: string[] = []
  const where: ReturnType<typeof at> = []
  const unsure: string[] = []
  // Titles written on their number's line ("I. INTRODUCTION"): the chapter number item says so.
  const inline: string[] = []
  const scaled: string[] = []
  // Titles whose last letters stand alone on the line below ("INTRODUCTIO" / "N").
  const broken: string[] = []
  const scale = reducedScale(ctx)
  for (const c of chapters) {
    const name = chapterName(c)
    if (c.unlabelled) {
      // The heading is the title ("I. INTRODUCTION"): the missing number, and so the title's
      // place below it, is reported with the label.
      const p = paras[c.heading]
      const t = shown(p).replace(/^\s*(\d{1,2}|[IVXLCivxlc]+)\s*[.)]\s+/, '')
      const before = issues.length
      if (!isUpper(t)) issues.push(`${name}: write the title in upper case`)
      // (the title's own type: not that of the numeral before it)
      const tp = { ...p, runs: afterNumber(p) }
      const tf = typeface(tp, `${name} title`, scale)
      issues.push(...tf.issues)
      if (tf.scaled) scaled.push(name)
      if (issues.length > before) where.push(...at(p))
      if (faceUnknown(tp)) unsure.push(name)
      if (c.inlineTitle) inline.push(name)
      continue
    }
    if (c.inlineTitle) {
      issues.push(
        `${name}: enter the chapter title (“${quote(c.inlineTitle, 40)}”) into the next line, below the chapter number`,
      )
      where.push(...at(paras[c.heading]))
      continue
    }
    // The title run into the paragraph under the label (an epigraph set right under it): its
    // first line, in capitals, on the label's page.
    const next = c.titlePara === undefined ? paras[c.heading + 1] : undefined
    const line = next?.lines?.[0]
    if (
      next &&
      line &&
      c.heading + 1 < c.end &&
      next.page === paras[c.heading].page &&
      norm(line.text).length >= 4 &&
      isUpper(norm(line.text))
    ) {
      const tf = typeface({ ...next, runs: line.runs }, `${name} title`, scale)
      issues.push(...tf.issues)
      if (tf.issues.length) where.push(...at(next))
      if (tf.scaled) scaled.push(name)
      if (faceUnknown({ ...next, runs: line.runs })) unsure.push(name)
      continue
    }
    if (c.titlePara === undefined) {
      issues.push(
        `${name}: indicate the chapter title (e.g., INTRODUCTION) below the chapter number`,
      )
      where.push(...at(paras[c.heading]))
      continue
    }
    const p = paras[c.titlePara]
    // The title after a line break in the label's paragraph, or a paragraph of its own.
    let t = c.titlePara === c.heading ? shown(p).split('\n').slice(1).join(' ') : shown(p)
    // PDF: a subheading read into the title's paragraph ("SUMMARY OF FINDINGS" / "Summary"): the
    // title is its lines in capitals.
    const k =
      c.titlePara === c.heading ? -1 : (p.lines?.findIndex((l) => !isUpper(norm(l.text))) ?? -1)
    if (k > 0)
      t = p
        .lines!.slice(0, k)
        .map((l) => l.text)
        .join(' ')
    const before = issues.length
    if (!isUpper(t))
      issues.push(
        `${name}: write the title in upper case (“${quote(t, 40)}”; if this is a subheading, add the chapter title above it)`,
      )
    const tf = typeface(p, `${name} title`, scale)
    issues.push(...tf.issues)
    if (tf.scaled) scaled.push(name)
    if (issues.length > before) where.push(...at(p))
    if (faceUnknown(p)) unsure.push(name)
    const tail = c.titlePara === c.heading ? undefined : paras[c.titlePara + 1]
    if (
      ctx.doc.kind === 'pdf' &&
      !!tail &&
      tail.page === p.page &&
      /^\p{Lu}{1,2}$/u.test(norm(tail.text)) &&
      /\p{Lu}{4}$/u.test(norm(p.text)) &&
      (tail.lines?.[0]?.y ?? 0) - (p.lines?.at(-1)?.y ?? 0) <= 2.5 * (p.lines?.[0]?.size ?? 12)
    ) {
      broken.push(name)
      where.push(...at(p))
    }
  }
  if (!issues.length && broken.length)
    return review(
      id,
      'The last letters of a chapter title stand alone on the next line, as if a word were broken in two. Check that each chapter title is set on one line.',
      {
        details: broken.slice(0, 8).map((n) => `${n}: the title breaks a word across two lines`),
        where: where.slice(0, 5),
      },
    )
  if (!issues.length && inline.length)
    return review(
      id,
      'The chapter titles share a line with their numbers (“I. INTRODUCTION”). The thesis template puts each title on its own line below the “Chapter I” label (see the chapter number item); the titles themselves are in upper case, bold Arial 12 pt.',
      {
        details: inline.slice(0, 8).map((n) => `${n}: title on the number’s line`),
        where: where.slice(0, 5),
      },
    )
  if (!issues.length && scaled.length)
    return review(
      id,
      `The titles of ${list(scaled)} are set in the size of the body text (${scale} pt), so this PDF may have been printed at a reduced scale. Check in your file that they are 12 pt.`,
    )
  if (!issues.length && unsure.length)
    return review(
      id,
      `Check that the titles of ${list(unsure)} are bold, Arial 12 pt: the fonts of this PDF are not named in it, so they could not be read.`,
    )
  if (!issues.length)
    return ctx.doc.kind === 'doc'
      ? review(
          id,
          'Every chapter title is on its own line, in upper case. Check that the titles are bold, Arial 12 pt (an old .doc file does not say).',
        )
      : ok(id, 'Every chapter title is on its own line, in upper case, bold Arial 12 pt.')
  return fix(id, 'Write each chapter title below its number, in upper case, bold, Arial 12 pt.', {
    details: issues.slice(0, 8),
    where: where.slice(0, 5),
  })
}

function noPageNumber(ctx: Ctx): Finding {
  const id = 'chapterStart.noPageNumber'
  const { doc, s } = ctx
  const msg = 'Remove the page number on the first page of each chapter.'
  if (doc.kind === 'pdf') {
    const folio = (c: Chapter) => pdfFolio(doc, doc.paras[c.heading].page ?? -1)
    // A chapter that does not open its page has no first page of its own: chapterStart.newPage
    // says so.
    const shown = s.chapters.filter((c) => doc.paras[c.heading].newPage && folio(c))
    if (!shown.length) return ok(id, 'No page number on the first page of any chapter.')
    // A footer with a title too: reviewers ask for the whole footer to go.
    const footer = shown.some((c) => folio(c)!.title)
    return fix(
      id,
      footer
        ? 'Remove the footer (shortened title and page number) on the first page of each chapter.'
        : msg,
      {
        // (a chapter that begins mid-page stands on a numbered page: said too, once it goes on a
        // page of its own, that page is to carry no number)
        details: s.chapters
          .filter((c) => folio(c) && (doc.paras[c.heading].newPage || shown.length))
          .map(
            (c) =>
              `${chapterName(c)} (${pagesText([doc.paras[c.heading].page!])}${doc.paras[c.heading].newPage ? '' : ', mid-page'}) shows “${clip(folio(c)!.raw)}”`,
          ),
        where: shown.slice(0, 5).map((c) => ({ page: doc.paras[c.heading].page })),
      },
    )
  }
  if (!doc.sections)
    return review(
      id,
      'Check in the PDF version that the first page of each chapter has no page number.',
    )
  const shownOn = s.chapters.filter(
    (c) =>
      (doc.paras[c.heading].newPage || doc.paras[c.heading].renderedBreak === 'before') &&
      wordFolioAt(doc, c.heading).folio,
  )
  if (!shownOn.length)
    return ok(id, 'Each chapter opens a section whose first page has no page number.')
  return fix(id, msg, {
    details: [
      `Page number on the first page of ${list(shownOn.map(chapterName))}.`,
      'Start each chapter in a new section (Layout > Breaks > Next Page) and tick “Different First Page” in its footer, leaving that first footer empty.',
    ],
    where: shownOn.slice(0, 5).flatMap((c) => at(doc.paras[c.heading])),
  })
}

// ---- Succeeding pages ----

/** A figure's or table's note ("Source: …", "(Cruz, 2020)") and the closing lines of a letter,
 *  a questionnaire or an acknowledgment: lines that end a page without hanging. */
const NOTE_LINE =
  /^((sources?|notes?|photos?|credits?|photo credit|image|retrieved from|adapted from|courtesy of)\b\s*[:.]|\((photo|source|image|credit|taken|retrieved).{0,150}\)$|\(.{2,60}\)$|(thank you|maraming salamat|salamat po|the researcher|respectfully|sincerely|very truly yours|yours truly|god bless|to god be)\b)/i

const headingLike = (p: Para) => {
  const t = norm(p.text)
  return (
    isHeadingish(p) &&
    // Words, not a lone arrow or number from a diagram.
    /\p{L}.*\p{L}/u.test(t) &&
    t.length <= 100 &&
    !/[.:;,!]$/.test(t) &&
    !NOTE_LINE.test(t) &&
    // (a code such as "EN2V-Ii-j-1", a scale's row of numbers)
    !/^[A-Z0-9]{2,}(-[A-Za-z0-9]+){2,}$/.test(t) &&
    (t.match(/\b\d+\b/g) ?? []).length < 4 &&
    p.align !== 'right' &&
    // A heading opens with a capital or a number: a line starting with a small letter ends a
    // sentence (the last line of a quotation); a form's blank or placeholder is no heading.
    !/^\p{Ll}/u.test(t) &&
    // (nor does one with a sentence closed inside quotation marks: a quotation's end, its source)
    !/[.!?,;]["”]/.test(t) &&
    // (nor one closing a bracket it did not open, the end of a quotation's translation, nor two
    // sentences, "It is late. We left", lines of speech)
    // (a list label first, "3.)", is set aside)
    (t.replace(/^\(?\w{1,4}[.)]+\s/, '').match(/\)/g) ?? []).length <=
      (t.match(/\(/g) ?? []).length &&
    !/\p{Ll}{3,}[.!?]\s+\p{Lu}/u.test(t) &&
    !/_{3,}|\[[^\]]*\]/.test(t) &&
    (p.lines?.length ?? 1) <= 2 &&
    // (two lines of a term and its meaning, "SUPPORT - Send a message…", are a list item)
    !((p.lines?.length ?? 1) === 2 && /\s[-–—]\s\p{L}/u.test(t)) &&
    !p.inTable &&
    !p.text.includes('\t')
  )
}

// A line of source code: an argument list or assignment ("p_name => 'x'", "x := 1;"), a line
// opened by a comma, a comment mark or a quote, markup, or identifiers with underscores and brackets.
const CODE_LINE =
  /=>|:=|^\s*(,|--|\/\/)\S|^\s*'|#[A-Z_]{3,}#|<\/?[a-z][\w-]*[\s>]|\b[a-z]+_[a-z0-9_]+\s*[=(]|\w\(\s*'[^']*'|\.\w+_\w+\(|"[a-z0-9]+_[a-z0-9_]+"/i

// Words of a sentence, not of a heading: four or more in small letters besides the little ones
// ("Some pictures were also drawn and…"; a heading has "the", "of" and capitals).
const prose = (t: string) =>
  (t.match(/(?<![\p{L}'’-])\p{Ll}{3,}\b/gu) ?? []).filter(
    (w) =>
      !/^(the|and|for|with|from|into|onto|upon|between|among|through|over|under|its|their|our|your|his|her|via|per|not|but|nor|yet)$/.test(
        w,
      ),
  ).length >= 4

function hanging(ctx: Ctx, captions: Caption[] = []): Finding {
  const id = 'body.hanging'
  const { doc, s } = ctx
  const msg =
    'Avoid hanging (sub)headings and lines: start a new (sub)heading on the next page, and keep at least 2 lines of a paragraph on each page.'
  const from = s.acceptance?.end ?? s.title.end
  if (doc.kind !== 'pdf') {
    // Word's own pagination at its last save, where the file has it.
    const heads = doc.paras.filter(
      (p, k) =>
        k >= from &&
        headingLike(p) &&
        doc.paras.slice(k + 1).find((q) => norm(q.text))?.renderedBreak === 'before',
    )
    if (heads.length)
      return fix(id, msg, {
        details: heads.slice(0, 6).map((p) => `“${quote(p.text, 50)}” ends a page`),
        where: heads.slice(0, 5).flatMap(at),
      })
    const loose = doc.paras.filter(
      (p, k) =>
        k >= from &&
        !p.plain &&
        headingLike(p) &&
        !p.keepNext &&
        s.chapters.some((c) => k > c.heading + 1 && k < c.end),
    )
    return review(
      id,
      'Check the PDF version for hanging (sub)headings and lines: this file type does not record exactly where its pages break.',
      {
        details: loose.length
          ? [
              `Tip: turn on “Keep with next” (Paragraph > Line and Page Breaks) for your ${plural(loose.length, 'subheading')}.`,
            ]
          : undefined,
      },
    )
  }
  const details: string[] = []
  const where: { page?: number; quote?: string }[] = []
  // The entries of the contents and the lists of tables and figures are lists, not running text.
  const lists = s.prelims.filter(
    (x) => x.key === 'toc' || x.key === 'tables' || x.key === 'figures',
  )
  const paras = doc.paras.filter(
    (p) => p.i >= from && !lists.some((x) => p.i > x.heading && p.i < x.end),
  )
  // Past the chapters, the part a place is in: "p. 88, References".
  const place = (page: number, p: Para) => {
    const ref = s.references && p.i > s.references.heading && p.i < s.references.end
    const ap = s.appendices.find((a) => p.i > a.heading && p.i < a.end)
    const part = ref ? 'References' : ap ? quote(ap.label, 30) : ''
    return `${pagesText([page])}${part ? `, ${part}` : ''}`
  }
  // A page of headings only (a divider such as "Appendices") leaves nothing hanging.
  const texted = new Set(
    doc.paras.filter((q) => !headingLike(q)).flatMap((q) => (q.lines ?? []).map((l) => l.page)),
  )
  const row = (q?: Para) => !!q && (!!q.inTable || q.text.includes('\t'))
  const bodySize = textSize(paras)
  // How many paragraphs use each typeface.
  const faceUse = new Map<string, number>()
  for (const q of doc.paras)
    for (const f of new Set(q.runs.flatMap((r) => (r.text.trim() && r.font ? [r.font] : []))))
      faceUse.set(f, (faceUse.get(f) ?? 0) + 1)
  // Headings are judged in the chapters and after them; the preliminary pages hold prose, whose
  // closing lines (a name, a date) are not headings. A dedication's lines are not paragraphs.
  const firstBody = s.chapters[0]?.heading ?? s.references?.heading ?? doc.paras.length
  const dedication = s.prelims.find((x) => x.key === 'dedication')
  // Which side of its table or figure this document sets a caption: below it (closing it) or above
  // it, as far as the captions whose object could be placed show.
  // A caption whose own table or figure could be placed is judged by that.
  const captionAbove = (kind: Caption['kind'], para?: Para) => {
    const own = captions.find((c) => c.para === para)?.object
    if (own && own !== 'unknown') return own === 'after'
    const placed = captions.filter((c) => c.kind === kind && c.object !== 'unknown')
    return (
      placed.filter((c) => c.object === 'after').length >
      placed.filter((c) => c.object === 'before').length
    )
  }
  for (const p of paras) {
    if (dedication && p.i > dedication.heading && p.i < dedication.end) continue
    // Numbered lines of a transcript, in an appendix, are lines of speech, not paragraphs.
    if (
      /^\d{1,3}\s+(\p{Ll}|\p{Lu}\w{0,3}\s?:)/u.test(norm(p.text)) &&
      s.appendices.some((a) => p.i > a.heading && p.i < a.end)
    )
      continue
    // Source code (a listing, set line by line) is not running text.
    if (
      CODE_LINE.test(norm(p.text)) ||
      (p.runs.length > 0 &&
        p.runs.every((r) => !r.text.trim() || /mono|courier|consolas/i.test(r.font ?? '')))
    )
      continue
    const lines = p.lines ?? []
    const next = doc.paras[p.i + 1]
    const pg = doc.pages?.[p.page ?? -1]
    const end = lines.at(-1)
    // The third centred line in a row, none of them bold, of one size: a verse, or the cells of a
    // table set in one column, not a heading.
    const mid = pg ? ((pg.margins?.left ?? 72) + (pg.margins?.right ?? pg.width - 72)) / 2 : 0
    const centred = (q?: Para) =>
      !!q?.lines?.length &&
      (q.align === 'center' ||
        (q.align === undefined &&
          Math.abs((q.lines[0].x0 + q.lines[0].x1) / 2 - mid) <= 6 &&
          q.lines[0].x0 > (pg?.margins?.left ?? 72) + 20))
    if (lines.length === 1 && centred(p) && !bolded(p)) {
      const above = [doc.paras[p.i - 1], doc.paras[p.i - 2]]
      if (
        above.every(
          (q) =>
            q?.page === p.page &&
            centred(q) &&
            !bolded(q) &&
            q!.lines!.length === 1 &&
            Math.abs(q!.lines![0].size - lines[0].size) < 0.6,
        )
      )
        continue
    }
    // Lines that all start past the middle of the text area, not centred: a sign-off under a
    // letter or a dedication ("- Name"), the side text of a layout, not running text.
    if (pg && lines.length && !centred(p) && lines.every((l) => l.x0 > mid + 20)) continue
    // Text set smaller than the running text (the labels of a chart, a note) is no heading.
    if (!pg || !end || lines[0].size < bodySize - 1) continue
    // Text in a typeface the document hardly uses elsewhere (a sample of a design, a font shown
    // in a figure) is no heading.
    const faces = new Set(
      p.runs.filter((r) => r.text.trim() && r.font && !r.unknown).map((r) => r.font!),
    )
    if (faces.size && [...faces].every((f) => (faceUse.get(f) ?? 0) < 5)) continue
    // A caption's second line (the first says "Figure 4.", the next gives the title).
    const before = doc.paras[p.i - 1]
    const continued =
      !!before?.lines &&
      before.page === p.page &&
      CAPTION.test(norm(before.text)) &&
      lines[0].y - before.lines.at(-1)!.y <= 1.8 * lines[0].size
    const caption = CAPTION.test(norm(p.text)) || continued
    // A one-line label in italics: a term defined below it, or one of APA's lower headings (not a
    // quoted line, nor one closing with its source "[S1.1]").
    const t = norm(p.text)
    const label =
      lines.length === 1 &&
      !p.inTable &&
      t.length <= 60 &&
      /\p{L}.*\p{L}/u.test(t) &&
      !/^["“‘'[(\-–—]/.test(t) &&
      !/^\p{Ll}/u.test(t) &&
      !/[.:;,!?"”’'\]]$/.test(t) &&
      // (nor the end of a quotation followed by its source: "… that.” (Informant C)")
      !/[.!?,;]["”’]/.test(t) &&
      p.align !== 'right' &&
      p.runs.filter((r) => r.text.trim()).every((r) => r.italic)
    // A line that is a whole sentence (a paragraph's first line, a list item) is no heading.
    const sentence = !caption && lines.length === 1 && t.length >= 50 && /[.!?]["”’)]?$/.test(t)
    // Pictures in the text area (not a logo in the header or footer), above or below the heading.
    const pics = pg.images.filter((b) => b.y1 > 0.12 * pg.height && b.y0 < 0.88 * pg.height)
    const above = pics.some((b) => b.y1 <= lines[0].y)
    // A caption under the table (its rows right above it) or under its picture closes the figure.
    const belowTable =
      !!before?.lines &&
      before.page === p.page &&
      row(before) &&
      lines[0].y - before.lines.at(-1)!.y <= 3 * lines[0].size
    // The last thing on its page (no picture below it either), after text or a picture, and with
    // something to come on the pages after; not a caption under its picture, closing the figure.
    if (
      ((headingLike(p) && (p.i >= firstBody || s.prelims.some((x) => x.heading === p.i))) ||
        label) &&
      // (a caption closing the page is judged below, by what opens the next one)
      !(
        caption &&
        !captionAbove(
          /^table/i.test(norm(before && continued ? before.text : p.text)) ? 'table' : 'figure',
          continued ? before : p,
        )
      ) &&
      end.page === p.page &&
      (!next || next.page !== p.page) &&
      // (the legend or axis labels inside a chart's drawn frame are no heading, nor a label right
      // under a diagram, after its smaller text)
      !(!caption && inShape(ctx, p, 0.95)) &&
      !(
        !caption &&
        before?.page === p.page &&
        (before.lines?.[0]?.size ?? 99) < bodySize - 1 &&
        pg.marks.some(
          (m) => m.kind === 'path' && m.y1 <= end.y && m.y1 >= end.y - 2.5 * lines[0].size,
        )
      ) &&
      // (a figure drawn in vectors below it, above the footer: the line is not the page's last;
      // one box drawn over and over, a frame around the footer, is no figure)
      new Set(
        pg.marks
          .filter(
            (m) =>
              m.kind === 'path' &&
              m.y0 >= end.y - 2 &&
              m.y1 <= 0.9 * pg.height &&
              m.x1 - m.x0 > 20 &&
              m.y1 - m.y0 > 10 &&
              m.x1 - m.x0 < 0.95 * pg.width,
          )
          .map((m) => [m.x0, m.y0, m.x1, m.y1].map(Math.round).join()),
      ).size < 4 &&
      // (a picture below the line, or one the line is set over, near its top: a caption on it)
      !pics.some(
        (b) =>
          b.y0 >= end.y - 2 ||
          (b.y0 <= end.y && end.y - b.y0 <= 2 * lines[0].size && b.y1 > end.y + 2),
      ) &&
      (texted.has(pg.n) || above) &&
      (next || (doc.pages?.[pg.n + 1]?.images.length ?? 0) > 0) &&
      !((caption || label) && (above || belowTable)) &&
      // (one of a run of labels with no text between, "Appendix A: …", "Appendix B: …": a list
      // of the parts, not a heading over text)
      !(
        before?.page === p.page &&
        headingLike(before) &&
        !!next &&
        headingLike(next) &&
        [before, next].every(
          (q) =>
            norm(q.text).split(' ')[0] === t.split(' ')[0] &&
            Math.abs((q.lines?.[0]?.x0 ?? -99) - lines[0].x0) <= 3,
        )
      )
    ) {
      details.push(
        `${place(pg.n, p)}: ${caption ? 'the caption' : sentence ? 'the line' : prose(t) ? 'the single line' : 'the heading'} “${quote(p.text, 40)}” is the last line of the page`,
      )
      where.push({ page: pg.n, quote: quote(p.text, 40) })
      continue
    }
    // A caption (or its number alone, then its title) closing the page, its picture or table
    // opening the next one.
    if (caption && !continued && end.page === p.page && !above && !belowTable) {
      const bare = /^(table|fig(ure)?\.?|chart)\s*\S*\d\S*$/i.test(norm(p.text))
      const title = bare ? doc.paras[p.i + 1] : undefined
      const tail = title && title.page === p.page && !row(title) ? title : p
      const after = doc.paras[tail.i + 1]
      const last = tail.lines?.at(-1)
      const upper = doc.pages?.[pg.n + 1]
      const top = upper && doc.paras[upper.paras[0]]
      const topY = top?.lines?.[0]?.y
      if (
        last &&
        last.page === p.page &&
        (!after || after.page !== p.page) &&
        !pics.some(
          (b) =>
            b.y0 >= last.y - 2 ||
            (b.y0 <= last.y && last.y - b.y0 <= 2 * last.size && b.y1 > last.y + 2),
        ) &&
        !!upper &&
        (upper.images.some(
          (b) =>
            b.x1 - b.x0 > 40 &&
            (topY === undefined ||
              b.y1 <= topY + 2 ||
              // (a bare number: its title opens the next page, the picture follows the title)
              (bare &&
                !row(top) &&
                (top!.lines?.length ?? 0) <= 3 &&
                b.y0 >= topY &&
                b.y0 - top!.lines!.at(-1)!.y <= 4 * top!.lines![0].size)),
        ) ||
          row(top))
      ) {
        details.push(
          `${place(pg.n, p)}: “${quote(p.text, 40)}” is at the bottom of the page, its ${/^table/i.test(norm(p.text)) ? 'table' : 'figure'} on the next page`,
        )
        where.push({ page: pg.n, quote: quote(p.text, 40) })
        continue
      }
    }
    // A table's title with no more than an inch of its table under it at the foot of the page,
    // the table going on at the next page.
    if (caption && end.page === p.page) {
      let k = p.i + 1
      // APA: the number on its own line ("Table 1."), the title below it, then the table.
      const title = doc.paras[k]
      if (
        /^(table|fig(ure)?\.?)\s*\d+[.:]?$/i.test(norm(p.text)) &&
        title?.page === p.page &&
        !row(title) &&
        (title.lines?.length ?? 0) <= 3
      )
        k++
      const top = k
      while (doc.paras[k]?.page === p.page && row(doc.paras[k])) k++
      const rows = doc.paras.slice(top, k).flatMap((q) => q.lines ?? [])
      const rest = doc.paras[k]
      if (
        rows.length &&
        rest?.page === pg.n + 1 &&
        row(rest) &&
        rows.filter((l) => l.page === pg.n).at(-1)!.y - rows[0].y <= 72
      ) {
        // (the rows left here, against the rows that go on below)
        let m = k
        while (doc.paras[m]?.page === pg.n + 1 && row(doc.paras[m])) m++
        const here = rows.filter((l) => l.page === pg.n).length
        const there = doc.paras.slice(k, m).reduce((n, q) => n + (q.lines?.length ?? 0), 0)
        details.push(
          there >= here
            ? `${place(pg.n, p)}: the title “${quote(p.text, 40)}” is at the bottom of the page, with most of its table on the next page`
            : `${place(pg.n, p)}: the table “${quote(p.text, 40)}” is split over the page break, only its first rows are on this page`,
        )
        where.push({ page: pg.n, quote: quote(p.text, 40) })
        continue
      }
    }
    // The first item of a sub-list (a question's first option) alone at the foot of the page, the
    // other items on the next: set in from the line above it, and the next page opens with an item
    // at the same indent.
    const above1 = before?.lines?.at(-1)
    const after1 = next?.lines?.[0]
    if (
      lines.length === 1 &&
      isList(p) &&
      !p.inTable &&
      !!before &&
      isList(before) &&
      before.page === p.page &&
      above1 &&
      lines[0].x0 > above1.x0 + 8 &&
      next &&
      next.page === (p.page ?? -2) + 1 &&
      isList(next) &&
      after1 &&
      Math.abs(after1.x0 - lines[0].x0) <= 3 &&
      end.page === p.page &&
      pg.paras.at(-1) === p.i
    ) {
      details.push(
        `${place(pg.n, p)}: the item “${quote(p.text, 40)}” is alone at the bottom of the page, the rest of its list on the next page`,
      )
      where.push({ page: pg.n, quote: quote(p.text, 40) })
      continue
    }
    const pages = [...new Set(lines.map((l) => l.page))]
    if (pages.length === 2 && !p.inTable && p.align !== 'center') {
      const onFirst = lines.filter((l) => l.page === pages[0]).length
      const onNext = lines.length - onFirst
      // A line carried over counts only when what follows starts no further in than this
      // paragraph did (the next paragraph or entry, not a sub-item set further in with a tab).
      const after = next?.lines?.[0]
      const closes =
        !after || after.page !== pages[1] || after.x0 <= lines[0].x0 + 3 || headingLike(next)
      // The next paragraph opening with a small letter goes on with this one (its lines were
      // told apart by a line that stopped a little short): more than one line is carried over.
      // (or an indented paragraph whose last line is followed, at the top of the next page, by a
      // paragraph with no indent: the lines of one paragraph, told apart by a short line)
      const l1x = lines[onFirst].x0
      const goesOn =
        !!next &&
        next.page === pages[1] &&
        !isList(next) &&
        (/^\p{Ll}/u.test(norm(next.text)) ||
          (!headingLike(next) &&
            !next.inTable &&
            !!next.lines &&
            // (or a paragraph that is itself the rest of an indented one above, opening in small
            // letters)
            (lines[0].x0 > l1x + 8 ||
              (/^\p{Ll}/u.test(norm(p.text)) && (before?.lines?.[0]?.x0 ?? 0) > l1x + 8)) &&
            next.lines[0].x0 <= l1x + 3 &&
            next.lines[0].y - lines.at(-1)!.y <= 2.4 * lines.at(-1)!.size))
      // A paragraph opening mid-sentence (its first line was told from the line above), a
      // caption, and a link wrapped onto a line of its own are not paragraphs left short.
      // (the paragraph above stops on a comma: this one goes on from it)
      const fragment =
        !!before?.lines &&
        before.lines.length >= 2 &&
        before.page === p.page &&
        !isList(p) &&
        !headingLike(before) &&
        !before.inTable &&
        /[,;]$/.test(norm(before.text))
      // (the line above stops short, but by less than this one's first word, and the lines keep
      // their pitch: the paragraph goes on)
      const prevLast = before?.lines?.at(-1)
      const prevPitch =
        before?.lines && before.lines.length >= 2 ? prevLast!.y - before.lines.at(-2)!.y : 0
      const firstWord = norm(lines[0].text).split(' ')[0]
      // (its width by the size: capitals and digits wide, the rest narrow, and a space)
      const wordWidth =
        lines[0].size *
        ([...firstWord].reduce((n, c) => n + (/[\p{Lu}\d]/u.test(c) ? 0.7 : 0.48), 0) + 0.25)
      const goesOnAbove =
        !!prevLast &&
        before!.page === p.page &&
        prevLast.page === p.page &&
        prevPitch > 0 &&
        !isList(p) &&
        !headingLike(before!) &&
        !before!.inTable &&
        lines[0].x0 <= prevLast.x0 + 3 &&
        lines[0].y - prevLast.y <= 1.3 * prevPitch &&
        prevLast.x1 + wordWidth > (pg.margins?.right ?? Infinity) - 6
      const stray =
        goesOnAbove ||
        (/^\p{Ll}/u.test(norm(p.text)) && !isList(p)) ||
        fragment ||
        caption ||
        /^(https?:\/\/|www\.)/i.test(norm(p.text))
      // A first line that stops short, with room left for the next line's first word, is a whole
      // item (a list item, a note) that the lines below, set in at the same indent, do not go on.
      const l0 = lines[0]
      const l1 = lines[onFirst]
      const word = norm(l1.text).split(' ')[0]
      const room = (pg.margins?.right ?? Infinity) - l0.x1
      // (a sentence-long line followed on the next page by a line with no end mark, a heading, or
      // by a link set out from the margin, a reference of its own: the line stands alone)
      const closed =
        onFirst === 1 &&
        onNext === 1 &&
        l0.x1 < (pg.margins?.right ?? Infinity) - 10 &&
        ((/[.!?]["”’)]?$/.test(norm(l0.text)) &&
          !/[.,;:!?]$/.test(norm(l1.text)) &&
          /^[\p{Lu}\d]/u.test(norm(l1.text)) &&
          l1.x1 - l1.x0 < 0.6 * (l0.x1 - l0.x0)) ||
          (/^(https?:\/\/|www\.)/i.test(norm(l1.text)) && l1.x0 < l0.x0 - 3))
      // (a one-line sentence leading in to a quotation set in on the next page: "… said that:")
      const leadIn =
        onFirst === 1 &&
        /[.!?:]["”’)]?$/.test(norm(l0.text)) &&
        l1.x0 > l0.x0 + 20 &&
        (onNext === 1 || lines[onFirst + 1].x0 > l0.x0 + 20)
      const complete =
        closed ||
        leadIn ||
        (onFirst === 1 &&
          isList(p) &&
          room > ((l1.x1 - l1.x0) / Math.max(1, l1.text.length)) * word.length)
      // (a line near the top of its page is no foot of it, nor one near the foot its top: pages of
      // headings only, set over a picture)
      const atFoot = onFirst === 1 && !stray && lines[0].y > 0.5 * pg.height
      const atTop =
        onNext === 1 &&
        closes &&
        !goesOn &&
        !fragment &&
        lines[onFirst - 1].y > 0.5 * pg.height &&
        lines[onFirst].y < 0.5 * pg.height
      if (!complete && (atFoot || atTop)) {
        details.push(
          atFoot
            ? `${place(pages[0], p)}: one line of the paragraph “${quote(p.text, 35)}” is left at the bottom of the page`
            : `${place(pages[1], p)}: the last line of the paragraph “${quote(p.text, 35)}” (from ${pagesText([pages[0]])}) stands alone at the top of the page`,
        )
        where.push({ page: pages[atFoot ? 0 : 1], quote: quote(p.text, 40) })
      }
    }
  }
  if (!details.length)
    return ok(id, 'No hanging headings or single lines at the top or bottom of a page.')
  // Firm evidence: a heading, caption or single line left at the foot of a page in the chapters,
  // or many places there. A last line at the top of a page (two may be there), an item of a list,
  // and places in the references or appendices (forms, questionnaires, captions of scanned
  // pages) may be misread: with firm evidence they are left out, else all are for review.
  const inChapters = details.map((d) => !/^p\.\s\d+, /.test(d))
  const firm = details.filter(
    (d, k) => inChapters[k] && !/stands alone at the top|: the item “|: the line “/.test(d),
  )
  const strong = firm.length > 0 || inChapters.filter(Boolean).length > 8
  const kept = strong ? details.filter((_, k) => inChapters[k]) : details
  const places = strong ? where.filter((_, k) => inChapters[k]) : where
  return weigh(
    strong,
    id,
    msg,
    `these places may hold hanging (sub)headings or lines; ${msg[0].toLowerCase()}${msg.slice(1)}`,
    {
      details: kept.slice(0, 8).concat(
        kept.length > 8
          ? [
              more(
                kept.length - 8,
                places.slice(8).map((w) => w.page),
              ),
            ]
          : [],
      ),
      where: places.slice(0, 6),
    },
  )
}

export function bodyNumbers(
  ctx: Ctx,
  id: string,
  start: number,
  end: number,
  name: string,
): Finding {
  const { doc, s } = ctx
  if (start >= end) return na(id, `No ${name} found.`)
  const msg = `Add the shortened title + ellipsis + page number (in Arabic numerals) on the ${name}.`
  const ch1 = s.chapters[0] ? doc.paras[s.chapters[0].heading] : undefined
  if (doc.kind === 'pdf') {
    const firstPages = new Set(s.chapters.map((c) => doc.paras[c.heading].page))
    const p0 = doc.paras[start].page ?? 0
    const p1 =
      end < doc.paras.length
        ? (doc.paras[end].page ?? 0) - (doc.paras[end].newPage ? 1 : 0)
        : doc.pages!.length - 1
    const pages = Array.from({ length: Math.max(0, p1 - p0 + 1) }, (_, k) => p0 + k).filter(
      (p) => !firstPages.has(p),
    )
    if (!pages.length) return na(id, `No ${name} after a chapter's first page.`)
    const base = ch1?.page
    const problems = auditPdf(
      doc,
      pages,
      (p) => ({ kind: 'arabic', value: base === undefined ? undefined : p - base + 1 }),
      thesisTitle(ctx),
      ch1 ? prelimTitle(doc, ch1.i) : undefined,
    )
    if (!problems.length)
      return ok(
        id,
        `${pagesText(pages)} carry the shortened title, an ellipsis and Arabic page numbers in sequence.`,
      )
    const details = summarize(problems)
    if (problems.some((p) => p.type === 'value'))
      details.push(
        'Chapter I’s first page is page 1 (though not shown), so the page after it is page 2.',
      )
    // Only pages with no text layer left: nothing there could be read.
    if (lookOnly(problems))
      return review(id, lookNote(problems), {
        details: summarize(problems),
        where: [{ page: problems[0].page }],
      })
    if (problems.every((p) => p.type === 'unread' || p.type === 'overlap'))
      return review(id, unreadNote(problems), { where: [{ page: problems[0].page }] })
    return fix(id, msg, { details, where: [{ page: problems[0].page }] })
  }
  if (!doc.sections) return review(id, `Check the page numbers of the ${name} in the PDF version.`)
  const secs = [...new Set(doc.paras.slice(start, end).map((p) => p.section ?? 0))]
  const starts = sectionStarts(doc)
  const problems: Problem[] = []
  const ref = ch1 ? prelimTitle(doc, ch1.i) : undefined
  for (const k of secs) {
    const sec = doc.sections[k]
    const head = doc.paras
      .slice(Math.max(start, sec.first), Math.min(end, sec.last + 1))
      .find((p) => norm(p.text))
    const where = head ? `the section from “${quote(head.text, 30)}”` : 'a section'
    // Its first page goes unnumbered only when a chapter opens it (or it began before this part).
    const unnumbered =
      sec.first < start ||
      s.chapters.some(
        (c) => doc.paras[c.heading].section === k && wordFolioAt(doc, c.heading).firstPage,
      )
    for (const f of wordSectionFolios(doc, k, unnumbered)) {
      for (const p of judge(f.folio, { kind: 'arabic' }))
        problems.push({ ...p, text: `${f.where}${where}: ${p.text}` })
      // One shortened title throughout: the preliminary pages' against this part's.
      const shortened = f.folio?.title
      if (ref && shortened && titleKey(shortened) !== ref.key)
        problems.push({
          type: 'changed',
          text: `${f.where}${where}: the footer has another title, “${quote(shortened, 40)}”, than the preliminary pages (“${quote(ref.shown, 40)}”); keep one shortened title`,
        })
    }
    const opensChapterOne = ch1 && sec.first <= ch1.i && ch1.i <= sec.last
    if (opensChapterOne && starts[k] !== 1)
      problems.push({
        type: 'value',
        text: `${where}: restart the page numbers at 1 for Chapter I (Page Number Format > Start at 1)`,
      })
    if (!opensChapterOne && sec.start !== undefined && ch1 && sec.first > ch1.i)
      problems.push({
        type: 'value',
        text: `${where}: page numbers restart at ${sec.start}; continue them from the previous page`,
      })
  }
  if (!problems.length)
    return ok(id, `The ${name} carry the shortened title, an ellipsis and Arabic page numbers.`)
  return fix(id, msg, { details: summarize(problems) })
}

export function chapterRules(ctx: Ctx, captions: Caption[] = []): Finding[] {
  const { s, doc } = ctx
  if (!s.chapters.length) {
    // Without a chapter label the chapters cannot be told apart: nothing here was checked.
    const why =
      'No chapter label (Chapter I, Chapter II…) was found, so this was not checked. Label the chapters as in the template, or check this item yourself.'
    return [
      number(ctx),
      hanging(ctx, captions),
      ...[
        'chapterStart.newPage',
        'chapterStart.title',
        'chapterStart.justified',
        'chapterStart.spacing',
        'chapterStart.noPageNumber',
        'body.justified',
        'body.spacing',
        'body.pageNumbers',
      ].map((id) => review(id, why)),
    ]
  }
  const first = new Set<number>()
  for (const c of s.chapters) for (const k of firstPage(ctx, c)) first.add(k)
  const titles = new Set(
    s.chapters.flatMap((c) => [c.heading, ...(c.titlePara === undefined ? [] : [c.titlePara])]),
  )
  const firstParas = s.chapters.flatMap((c) =>
    bodyParas(ctx, c.heading, c.end, titles).filter((p) => first.has(p.i)),
  )
  const restParas = s.chapters.flatMap((c) =>
    bodyParas(ctx, c.heading, c.end, titles).filter((p) => !first.has(p.i)),
  )
  const bodyEnd =
    s.references?.start ?? s.appendicesHeading ?? s.appendices[0]?.start ?? doc.paras.length
  // The contents lists more chapters than were found: what passed was passed for those found only.
  const unsure = (f: Finding): Finding =>
    f.status === 'ok' && f.id !== 'body.hanging' && (s.listedChapters ?? 0) > s.chapters.length
      ? review(
          f.id,
          `Only ${s.chapters.length} of the ${s.listedChapters} chapters in the table of contents could be found (the others may be headed in an unusual way), so this was not checked for all of them. Check it yourself.`,
        )
      : f
  return [
    newPage(ctx),
    number(ctx),
    title(ctx),
    justified(ctx, 'chapterStart.justified', firstParas, 'the first page of each chapter'),
    doubleSpaced(ctx, 'chapterStart.spacing', firstParas, 'the first page of each chapter'),
    noPageNumber(ctx),
    hanging(ctx, captions),
    justified(ctx, 'body.justified', restParas, 'the chapters'),
    doubleSpaced(ctx, 'body.spacing', restParas, 'the chapters'),
    bodyNumbers(ctx, 'body.pageNumbers', s.chapters[0].start, bodyEnd, 'chapter pages'),
  ].map(unsure)
}
