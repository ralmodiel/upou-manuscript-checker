// First page of each chapter, and the succeeding pages.
import type { Para } from '../model.ts'
import { fix, na, ok, review, type Ctx, type Finding } from '../report.ts'
import { bolded, isHeadingish, type Chapter } from '../structure.ts'
import { isUpper, list, norm, plural, quote, roman, shown } from '../text.ts'
import { bodyParas, CAPTION, doubleSpaced, isList, justified } from './body.ts'
import {
  auditPdf,
  clip,
  judge,
  more,
  pagesText,
  pdfFolio,
  sectionStarts,
  summarize,
  wordFolioAt,
  wordSectionFolios,
  type Problem,
} from './numbering.ts'

const isArial = (font?: string) => !font || /arial|arimo|liberation sans|helvetica/i.test(font)

/** Bold, Arial and 12 pt over the paragraph's text: the problems found. */
function typeface(p: Para, what: string): string[] {
  if (p.plain) return []
  const runs = p.runs.filter((r) => r.text.trim())
  const out: string[] = []
  if (!bolded(p)) out.push(`${what} is not bold`)
  const fonts = [...new Set(runs.map((r) => r.font).filter((f) => f && !isArial(f)))]
  if (fonts.length) out.push(`${what} is in ${fonts.join(', ')}, not Arial`)
  const sizes = [
    ...new Set(runs.map((r) => r.size).filter((z) => z !== undefined && Math.abs(z - 12) > 0.3)),
  ]
  if (sizes.length) out.push(`${what} is ${sizes.join(', ')} pt, not 12 pt`)
  return out
}

const chapterName = (c: Chapter) => c.label.replace(/^chapter/i, 'Chapter')
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
  return review(
    id,
    'Start each chapter on a new page with a page or section break (Ctrl+Enter), not empty lines.',
    {
      details: [`No page break before ${list(late.map(chapterName))}.`],
      where: late.flatMap((c) => at(paras[c.heading])),
    },
  )
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
  for (const c of chapters) {
    const p = paras[c.heading]
    const word = /^chapter/i.exec(norm(p.text))?.[0] ?? 'Chapter'
    // The label as it should read ("CHAPTER ONE" → "Chapter I").
    const right = `Chapter ${(c.number ? roman(c.number) : c.numeral).toUpperCase()}`
    const before = issues.length
    if (!/^[IVXLC]+$/.test(c.numeral))
      issues.push(`“${c.label}”: chapter numbers must be in Roman numerals (${right})`)
    if (word !== 'Chapter' || /^CHAPTER$/.test(shown(p).slice(0, 7)))
      issues.push(`“${c.label}”: write it in title case (${right})`)
    for (const t of typeface(p, `“${c.label}”`)) issues.push(t)
    if (issues.length > before) wrong.push(p)
  }
  const nums = chapters.map((c) => c.number ?? 0)
  if (nums.some((x, k) => x !== k + 1))
    issues.push(
      `Chapter numbers should run I, II, III… in order (found ${chapters.map((c) => c.numeral).join(', ')})`,
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

function title(ctx: Ctx): Finding {
  const id = 'chapterStart.title'
  const { chapters } = ctx.s
  const paras = ctx.doc.paras
  const issues: string[] = []
  const where: ReturnType<typeof at> = []
  for (const c of chapters) {
    const name = chapterName(c)
    if (c.inlineTitle) {
      issues.push(
        `${name}: enter the chapter title (“${quote(c.inlineTitle, 40)}”) into the next line, below the chapter number`,
      )
      where.push(...at(paras[c.heading]))
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
    const t = c.titlePara === c.heading ? shown(p).split('\n').slice(1).join(' ') : shown(p)
    const before = issues.length
    if (!isUpper(t))
      issues.push(
        `${name}: write the title in upper case (“${quote(t, 40)}”; if this is a subheading, add the chapter title above it)`,
      )
    for (const x of typeface(p, `${name} title`)) issues.push(x)
    if (issues.length > before) where.push(...at(p))
  }
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
    const shown = s.chapters.filter((c) => folio(c))
    if (!shown.length) return ok(id, 'No page number on the first page of any chapter.')
    // A footer with a title too: reviewers ask for the whole footer to go.
    const footer = shown.some((c) => folio(c)!.title)
    return fix(
      id,
      footer
        ? 'Remove the footer (shortened title and page number) on the first page of each chapter.'
        : msg,
      {
        details: shown
          .map(
            (c) =>
              `${chapterName(c)} (${pagesText([doc.paras[c.heading].page!])}) shows “${clip(folio(c)!.raw)}”`,
          )
          .slice(0, 6),
        where: shown.slice(0, 5).map((c) => ({ page: doc.paras[c.heading].page })),
      },
    )
  }
  if (!doc.sections)
    return review(
      id,
      'Check in the PDF version that the first page of each chapter has no page number.',
    )
  const shownOn = s.chapters.filter((c) => wordFolioAt(doc, c.heading).folio)
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

const headingLike = (p: Para) => {
  const t = norm(p.text)
  return (
    isHeadingish(p) &&
    // Words, not a lone arrow or number from a diagram.
    /\p{L}.*\p{L}/u.test(t) &&
    t.length <= 100 &&
    !/[.:;,]$/.test(t) &&
    (p.lines?.length ?? 1) <= 2 &&
    !p.inTable &&
    !p.text.includes('\t')
  )
}

function hanging(ctx: Ctx): Finding {
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
  for (const p of paras) {
    const lines = p.lines ?? []
    const next = doc.paras[p.i + 1]
    const pg = doc.pages?.[p.page ?? -1]
    const end = lines.at(-1)
    if (!pg || !end) continue
    const caption = CAPTION.test(norm(p.text))
    // A one-line label in italics: a term defined below it, or one of APA's lower headings (not a
    // quoted line, nor one closing with its source "[S1.1]").
    const t = norm(p.text)
    const label =
      lines.length === 1 &&
      !p.inTable &&
      t.length <= 60 &&
      /\p{L}.*\p{L}/u.test(t) &&
      !/^["“‘'[(]/.test(t) &&
      !/[.:;,!?"”’'\]]$/.test(t) &&
      p.runs.filter((r) => r.text.trim()).every((r) => r.italic)
    // Pictures in the text area (not a logo in the header or footer), above or below the heading.
    const pics = pg.images.filter((b) => b.y1 > 0.12 * pg.height && b.y0 < 0.88 * pg.height)
    const above = pics.some((b) => b.y1 <= lines[0].y)
    // The last thing on its page (no picture below it either), after text or a picture, and with
    // something to come on the pages after; not a caption under its picture, closing the figure.
    if (
      (headingLike(p) || label) &&
      end.page === p.page &&
      (!next || next.page !== p.page) &&
      !pics.some((b) => b.y0 >= end.y - 2) &&
      (texted.has(pg.n) || above) &&
      (next || (doc.pages?.[pg.n + 1]?.images.length ?? 0) > 0) &&
      !((caption || label) && above)
    ) {
      details.push(
        `${place(pg.n, p)}: the heading “${quote(p.text, 40)}” is the last line of the page`,
      )
      where.push({ page: pg.n, quote: quote(p.text, 40) })
      continue
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
        details.push(
          `${place(pg.n, p)}: the title “${quote(p.text, 40)}” is at the bottom of the page, with most of its table on the next page`,
        )
        where.push({ page: pg.n, quote: quote(p.text, 40) })
        continue
      }
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
      if (onFirst === 1 || (onNext === 1 && closes)) {
        details.push(
          onFirst === 1
            ? `${place(pages[0], p)}: one line of the paragraph “${quote(p.text, 35)}” is left at the bottom of the page`
            : `${place(pages[1], p)}: the last line of the paragraph “${quote(p.text, 35)}” (from ${pagesText([pages[0]])}) stands alone at the top of the page`,
        )
        where.push({ page: pages[onFirst === 1 ? 0 : 1], quote: quote(p.text, 40) })
      }
    }
    // A list of one-line items (each its own paragraph) that a page break leaves with one item
    // alone on a page.
    const x0 = lines[0].x0
    const item = (q?: Para): q is Para =>
      !!q && q.lines?.length === 1 && isList(q) && !bolded(q) && Math.abs(q.lines[0].x0 - x0) <= 3
    // The last thing on its page (no picture under it), the list going on at the next page.
    if (item(p) && item(next) && next.page === pg.n + 1 && !pics.some((b) => b.y0 >= end.y - 2)) {
      // Items set further in (sub-items) belong to the same list.
      const count = (k: number, step: number, page: number) => {
        let c = 0
        const q = (j: number) => doc.paras[j]
        while (
          q(k)?.lines?.length === 1 &&
          isList(q(k)) &&
          q(k).lines![0].x0 >= x0 - 3 &&
          q(k).page === page
        ) {
          c++
          k += step
        }
        return c
      }
      const one =
        count(next.i, 1, pg.n + 1) === 1 ? next : count(p.i, -1, pg.n) === 1 ? p : undefined
      if (one) {
        details.push(
          `${place(one.page!, one)}: the list item “${quote(one.text, 35)}” ${one === next ? 'stands alone at the top of the page' : 'is left alone at the bottom of the page'}`,
        )
        where.push({ page: one.page, quote: quote(one.text, 40) })
      }
    }
  }
  if (!details.length)
    return ok(id, 'No hanging headings or single lines at the top or bottom of a page.')
  return fix(id, msg, {
    details: details.slice(0, 8).concat(
      details.length > 8
        ? [
            more(
              details.length - 8,
              where.slice(8).map((w) => w.page),
            ),
          ]
        : [],
    ),
    where: where.slice(0, 6),
  })
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
  const msg = `Add the shortened thesis title + ellipsis + page number (in Arabic numerals) on the ${name}.`
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
    const problems = auditPdf(doc, pages, (p) => ({
      kind: 'arabic',
      value: base === undefined ? undefined : p - base + 1,
    }))
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
    return fix(id, msg, { details, where: [{ page: problems[0].page }] })
  }
  if (!doc.sections) return review(id, `Check the page numbers of the ${name} in the PDF version.`)
  const secs = [...new Set(doc.paras.slice(start, end).map((p) => p.section ?? 0))]
  const starts = sectionStarts(doc)
  const problems: Problem[] = []
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
    for (const f of wordSectionFolios(doc, k, unnumbered))
      for (const p of judge(f.folio, { kind: 'arabic' }))
        problems.push({ ...p, text: `${f.where}${where}: ${p.text}` })
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

export function chapterRules(ctx: Ctx): Finding[] {
  const { s, doc } = ctx
  if (!s.chapters.length) {
    // Without a chapter label the chapters cannot be told apart: nothing here was checked.
    const why =
      'No chapter label (Chapter I, Chapter II…) was found, so this was not checked. Label the chapters as in the MDC template, or check this item yourself.'
    return [
      number(ctx),
      hanging(ctx),
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
  return [
    newPage(ctx),
    number(ctx),
    title(ctx),
    justified(ctx, 'chapterStart.justified', firstParas, 'the first page of each chapter'),
    doubleSpaced(ctx, 'chapterStart.spacing', firstParas, 'the first page of each chapter'),
    noPageNumber(ctx),
    hanging(ctx),
    justified(ctx, 'body.justified', restParas, 'the chapters'),
    doubleSpaced(ctx, 'body.spacing', restParas, 'the chapters'),
    bodyNumbers(ctx, 'body.pageNumbers', s.chapters[0].start, bodyEnd, 'chapter pages'),
  ]
}
