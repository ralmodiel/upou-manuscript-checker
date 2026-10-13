// One misreading can make many findings at once: a footer read wrongly on every page makes every
// page-number item say the same thing, a sentence taken for a chapter heading makes several
// chapter items fault it. Before the findings go out, such a cascade is checked against the pages
// themselves; where they show positive signs of a misreading, its claims are only for review.
import type { Doc, Page, Para } from './model.ts'
import { review, type Ctx, type Finding } from './report.ts'
import { pdfFolio } from './rules/numbering.ts'
import { bolded } from './structure.ts'
import { norm } from './text.ts'

const FOLIO_ITEMS =
  /^((title|permission|acceptance)\.pageNumber|(prelims|body|references|appendices)\.pageNumbers)$/
// What a footer shows that the reading missed: an ellipsis anywhere on it, or a number standing
// alone on it that changes from page to page (not at the end, where the reading looks for it).
const ELLIPSIS_LIKE = /…|\.{2,}|(\.\s){2}\.|«|⋯|‥/
const NUMBER_LIKE = /(?:^|[\s"'”’…|.])(\d{1,3}|[ivxlc]{2,7})(?=[\s.,;:"'”’|]|$)/gi

export const MISREAD = 'This may be a misreading:'

/** Footer claims that the footers themselves contradict: "no ellipsis" while most footers
 *  so read have one elsewhere on the line, "no page number" while most have a number on it. */
function footerDoubts(ctx: Ctx): { claim: RegExp; why: string }[] {
  const { doc } = ctx
  if (doc.kind !== 'pdf' || !doc.pages) return []
  const folios = doc.pages.map((pg) => pdfFolio(doc, pg.n)).filter((f) => !!f)
  const out: { claim: RegExp; why: string }[] = []
  const noEllipsis = folios.filter((f) => f.number !== undefined && !f.ellipsis)
  const seen = noEllipsis.filter((f) => ELLIPSIS_LIKE.test(f.raw))
  if (seen.length >= 3 && seen.length * 2 >= noEllipsis.length)
    out.push({
      claim: /no ellipsis/i,
      why: 'most footers read as having no ellipsis do show one (…) on the line, so the checker may have misread them.',
    })
  // (numbers that change from page to page: page numbers, not a numeral of the title)
  const noNumber = folios.filter((f) => f.number === undefined && !f.unreadNumber && !f.overlap)
  const values = new Set(
    noNumber.flatMap((f) => [...f.raw.matchAll(NUMBER_LIKE)].map((m) => m[1].toLowerCase())),
  )
  if (values.size >= 3 && values.size * 2 >= noNumber.length)
    out.push({
      claim: /no page number/i,
      why: 'most footers read as having no page number do show a number on the line, so the checker may have misread them.',
    })
  return out
}

/** The paragraph a finding quotes. */
function anchorPara(ctx: Ctx, page: number, q: string): Para | undefined {
  const head = norm(q.replace(/…$/, ''))
  return ctx.doc.paras.find((p) => p.page === page && norm(p.text).startsWith(head))
}

/** Running text, not a heading: plain type, and several lines of a sentence's worth of words, or
 *  a line that breaks off at a comma mid-sentence. */
const prose = (p: Para) => {
  const t = norm(p.text)
  const words = t.split(' ').length
  return (
    !bolded(p) &&
    (((p.lines?.length ?? 1) >= 2 && words >= 25 && p.align !== 'center') ||
      (words >= 6 && /[,;]$/.test(t)))
  )
}

/** Findings of several items that all rest on one quoted line (each names that line alone), when
 *  that line reads as running text or is a chapter the contents do not list. */
function anchorDoubts(ctx: Ctx, found: Finding[]): Map<string, string> {
  const { s } = ctx
  const groups = new Map<string, Finding[]>()
  for (const f of found) {
    if (f.status !== 'fix' || !f.where?.length) continue
    const keys = new Set(f.where.map((w) => `${w.page}|${w.quote ?? ''}`))
    const [w] = f.where
    if (keys.size !== 1 || w.page === undefined || !w.quote) continue
    const k = [...keys][0]
    groups.set(k, [...(groups.get(k) ?? []), f])
  }
  const out = new Map<string, string>()
  for (const [, fs] of groups) {
    if (fs.length < 3) continue
    const w = fs[0].where![0]
    const p = anchorPara(ctx, w.page!, w.quote!)
    if (!p) continue
    const chapter = s.chapters.some((c) => c.heading === p.i)
    const unlisted = chapter && !!s.listedChapters && s.chapters.length > s.listedChapters
    if (!prose(p) && !unlisted) continue
    const why = prose(p)
      ? `${fs.length} items rest on one line, “${w.quote}”, which reads as running text rather than a heading.`
      : `${fs.length} items rest on one line, “${w.quote}”, a chapter the table of contents does not list.`
    for (const f of fs) out.set(f.id, why)
  }
  return out
}

// Items judged from where the letters stand and how they are set, not from the words alone.
const LAYOUT =
  /^((prelims|chapterStart|body)\.(justified|spacing)|body\.hanging|chapterStart\.(number|title|newPage)|figures\.\w+)$/
const PART = /^(title|permission|acceptance)\./
// Front-page items judged from the page's words.
const WORDED =
  /^(title\.(sequence|title|adviser|date)|permission\.(title|statement)|acceptance\.(title|names|convention))$/
const GARBLED =
  'Part of the text on this page is in a font that prints wrong letters, so its words could not all be read. Check this item yourself.'

/** Passes on a front page whose words are partly unreadable (a font with wrong glyphs): what was
 *  found may be read, what was missed may be in the unreadable words. */
function garbleDoubts(ctx: Ctx, found: Finding[]): Map<string, string> {
  const { doc, s } = ctx
  const out = new Map<string, string>()
  if (doc.kind !== 'pdf' || !doc.pages) return out
  for (const f of found) {
    if (f.status !== 'ok' || !WORDED.test(f.id)) continue
    const r = f.id.startsWith('title.')
      ? s.title
      : f.id.startsWith('permission.')
        ? s.permission
        : s.acceptance
    const page = r ? doc.paras[r.start]?.page : undefined
    if (page !== undefined && doc.pages[page]?.unreliable) out.set(f.id, GARBLED)
  }
  return out
}
const area = (b: Page['images'][number]) => (b.x1 - b.x0) * (b.y1 - b.y0)

/** Findings that rest on scanned pages read through their machine-read text layer (PDF): what
 *  that layer says of fonts, sizes, alignment, spacing and pictures is the scan's guess, and its
 *  words may be misread too. A finding whose pages are all such pages is for review; with no page
 *  named, so is one of a manuscript mostly scanned (its own part's page decides for the front
 *  pages), and a pass on the layout of such a manuscript. */
function scanDoubts(ctx: Ctx, found: Finding[]): Map<string, string> {
  const { doc, s } = ctx
  const out = new Map<string, string>()
  const pages = doc.pages ?? []
  // A pass judged on the pages that could be read says nothing of the pages that are pictures:
  // where these are a material share (a fifth) of the pages a whole-manuscript item covers, its
  // pass is for review. Pages from the appendices on count only for the items that cover them.
  const unread = new Set(pages.filter((pg) => pg.ocr || scanPage(doc, pg)).map((pg) => pg.n))
  const appx = s.appendicesHeading ?? s.appendices[0]?.heading
  const appxPage = appx === undefined ? undefined : doc.paras[appx]?.page
  const material = (all: boolean) => {
    const scope = all || appxPage === undefined ? pages : pages.filter((pg) => pg.n < appxPage)
    const n = scope.filter((pg) => unread.has(pg.n)).length
    return n >= 2 && n >= 0.2 * scope.length
  }
  const share = { all: material(true), own: material(false) }
  for (const f of found)
    if (
      f.status === 'ok' &&
      !PART.test(f.id) &&
      (/^(extra|appendices)\./.test(f.id) ? share.all : share.own)
    )
      out.set(f.id, PARTLY)
  const ocr = new Set(pages.filter((pg) => pg.ocr).map((pg) => pg.n))
  const mostly = ocr.size * 2 >= pages.length
  // (before Chapter I, or anywhere when no chapter was found, a page whose text stands over a
  // picture of the whole page is a scan too)
  const ch = s.chapters[0]
  const front = ch ? (doc.paras[ch.heading]?.page ?? 0) : pages.length
  for (const pg of pages.slice(0, front))
    if (pg.paras.length && pg.images.some((b) => area(b) >= 0.8 * pg.width * pg.height))
      ocr.add(pg.n)
  if (!ocr.size) return out
  // (in a manuscript mostly so, a page whose text stands over a picture of the whole page is a
  // scan too, its layer merely left visible)
  if (mostly)
    for (const pg of doc.pages!)
      if (pg.images.some((b) => area(b) >= 0.8 * pg.width * pg.height)) ocr.add(pg.n)
  const partPage = (id: string) => {
    const r = id.startsWith('title.')
      ? s.title
      : id.startsWith('permission.')
        ? s.permission
        : s.acceptance
    return r ? doc.paras[r.start]?.page : undefined
  }
  // (a pass on a front page so read is the scan's guess too)
  for (const f of found) {
    if (
      f.status !== 'fix' &&
      !(f.status === 'ok' && ((mostly && LAYOUT.test(f.id)) || PART.test(f.id)))
    )
      continue
    const pages = (f.where ?? []).map((w) => w.page).filter((p) => p !== undefined)
    const doubt = pages.length
      ? pages.every((p) => ocr.has(p))
      : PART.test(f.id)
        ? ocr.has(partPage(f.id) ?? -1)
        : mostly
    if (doubt && !out.has(f.id)) out.set(f.id, SCANNED)
  }
  return out
}

/** A page that is a picture with hardly any text over it: a scanned page, its words unread. */
export function scanPage(doc: Doc, pg: Page): boolean {
  const t = pg.paras.map((i) => doc.paras[i].text).join(' ')
  const area = pg.images.reduce((a, b) => a + (b.x1 - b.x0) * (b.y1 - b.y0), 0)
  return (
    t.length < 150 &&
    t.split(/\s+/).filter(Boolean).length < 30 &&
    area >= 0.4 * pg.width * pg.height
  )
}

const SCANNED =
  'The pages this item rests on are scanned pictures with a machine-read text layer, so their fonts, spacing, alignment and even words may be misread. Check this item yourself.'
const PARTLY =
  'Some pages of this PDF are scanned pictures whose words could not be read, so this item was checked only on the other pages. Check it yourself on the scanned pages.'

/** The findings, with the claims of a likely misreading turned to review. */
export function guard(ctx: Ctx, found: Finding[]): Finding[] {
  let footer: ReturnType<typeof footerDoubts>
  let anchored: Map<string, string>
  let scanned: Map<string, string>
  try {
    footer = footerDoubts(ctx)
    anchored = anchorDoubts(ctx, found)
    scanned = scanDoubts(ctx, found)
    for (const [id, why] of garbleDoubts(ctx, found)) if (!scanned.has(id)) scanned.set(id, why)
  } catch (e) {
    console.error(e)
    return found
  }
  return found.map((f) => {
    const scan = scanned.get(f.id)
    if (scan) return review(f.id, scan, { where: f.where })
    if (f.status !== 'fix') return f
    let why = anchored.get(f.id)
    // (a footer item is downgraded only when every claim it makes is a doubted one)
    if (!why && FOLIO_ITEMS.test(f.id) && f.details?.length) {
      const d = footer.find((x) => f.details!.every((t) => x.claim.test(t)))
      why = d?.why
    }
    return why
      ? review(f.id, `${MISREAD} ${why} Check this item yourself.`, {
          details: f.details,
          where: f.where,
        })
      : f
  })
}
