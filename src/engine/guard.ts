// One misreading can make many findings at once: a footer read wrongly on every page makes every
// page-number item say the same thing, a sentence taken for a chapter heading makes several
// chapter items fault it. Before the findings go out, such a cascade is checked against the pages
// themselves; where they show positive signs of a misreading, its claims are only for review.
import type { Para } from './model.ts'
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

/** The findings, with the claims of a likely misreading turned to review. */
export function guard(ctx: Ctx, found: Finding[]): Finding[] {
  let footer: ReturnType<typeof footerDoubts>
  let anchored: Map<string, string>
  try {
    footer = footerDoubts(ctx)
    anchored = anchorDoubts(ctx, found)
  } catch (e) {
    console.error(e)
    return found
  }
  return found.map((f) => {
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
