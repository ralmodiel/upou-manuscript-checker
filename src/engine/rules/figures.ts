// Figures and tables: the number in bold above, the title in italics right below, APA style.
import type { Box, Para } from '../model.ts'
import { fix, na, ok, review, spread, worst, type Ctx, type Finding } from '../report.ts'
import { bolded, isTocLine } from '../structure.ts'
import { list, norm, quote } from '../text.ts'
import { more, pagesText } from './numbering.ts'

export interface Caption {
  para: Para
  kind: 'figure' | 'table'
  number: string
  /** Title written on the number's own line. */
  inline: string
  title?: Para
  /** Where the figure or table itself stands: after the caption (right), before it, or unknown. */
  object: 'after' | 'before' | 'unknown'
}

const LABEL = /^(fig(?:ure)?\.?|table)\s*(\d+(?:[.-]\d+)*|[A-Z]-?\d+)\s*[.:–—-]?\s*(.*)$/i
/** "Table 1 (continued)": a long table carried over to the next page, not a caption of its own. */
const CONTINUED = /^(figure|table)\s+\S+\s*\(?cont(inued|['’]d|\.)?\)?\.?$/i
const italic = (p: Para) => {
  if (p.plain) return true
  let all = 0
  let it = 0
  for (const r of p.runs) {
    const n = r.text.replace(/\s/g, '').length
    all += n
    if (r.italic) it += n
  }
  return all > 0 && it / all >= 0.6
}
/** The label part ("Table 1.") in bold. */
const labelBold = (p: Para) => {
  if (p.plain) return true
  const label = LABEL.exec(norm(p.text))
  if (!label) return false
  const head = norm(p.text).slice(0, norm(p.text).length - label[3].length)
  let seen = ''
  for (const r of p.runs) {
    if (seen.length >= head.trim().length) break
    if (r.text.trim() && !r.bold) return false
    seen += r.text
  }
  return true
}

/** Where body content lives: the chapters and appendices (or all after the front matter). */
function bodyRange(ctx: Ctx): [number, number] {
  const { s, doc } = ctx
  // Without chapter labels the last preliminary page runs on into the body: start after its heading.
  const last = s.prelims.at(-1)
  const start = s.chapters[0]?.start ?? (last ? last.heading + 1 : s.title.end)
  return [start, doc.paras.length]
}

function objectSide(ctx: Ctx, p: Para, kind: Caption['kind'], title?: Para): Caption['object'] {
  const { doc } = ctx
  const is = (q: Para | undefined) => !!q && (kind === 'table' ? !!q.inTable : !!q.image)
  const from = (title ?? p).i + 1
  if (doc.kind === 'pdf') {
    // A table's rows read as lines with wide gaps between the cells (tabs); a table pasted as a
    // picture is found like a figure.
    if (kind === 'table') {
      const row = (q: Para) => q.text.includes('\t')
      if (doc.paras.slice(from, from + 3).some(row)) return 'after'
      if (doc.paras.slice(Math.max(0, p.i - 3), p.i).some((q) => q.page === p.page && row(q)))
        return 'before'
    }
    const n = p.page ?? -1
    const page = doc.pages?.[n]
    const line = p.lines?.[0]
    if (!page || !line) return 'unknown'
    const end = (title ?? p).lines?.findLast((l) => l.page === n) ?? line
    const wide = (b: Box) => b.x1 - b.x0 > 40
    // How far each picture on the page stands below the caption, or above it.
    const below = page.images.filter((b) => wide(b) && b.y0 >= line.y - 2).map((b) => b.y0 - end.y)
    const above = page.images
      .filter((b) => wide(b) && b.y1 <= line.y - line.size)
      .map((b) => line.y - line.size - b.y1)
    // A picture right by the caption is its figure, whatever else the pages hold.
    const near = (gaps: number[]) => gaps.some((g) => g < 5 * line.size)
    if (near(below)) return 'after'
    if (near(above)) return 'before'
    // A caption closing its page, and a picture opening the next one.
    const next = doc.pages?.[n + 1]
    const nextText = next && doc.paras[next.paras[0]]?.lines?.[0]
    if (
      page.paras.at(-1) === (title ?? p).i &&
      next?.images.some((b) => wide(b) && (!nextText || b.y1 <= nextText.y))
    )
      return 'after'
    // A caption opening its page, and a picture closing the page before.
    const prevPage = doc.pages?.[n - 1]
    const prevText = doc.paras[p.i - 1]?.lines?.findLast((l) => l.page === n - 1)
    if (
      page.paras[0] === p.i &&
      doc.paras[p.i - 1]?.lines?.at(-1)?.page !== n &&
      prevPage?.images.some((b) => wide(b) && (!prevText || b.y0 >= prevText.y - 2))
    )
      return 'before'
    return below.length ? 'after' : above.length ? 'before' : 'unknown'
  }
  for (let k = from; k < Math.min(doc.paras.length, from + 4); k++) {
    if (is(doc.paras[k])) return 'after'
    if (norm(doc.paras[k].text) && !doc.paras[k].inTable && !doc.paras[k].image) break
  }
  for (let k = p.i - 1; k >= Math.max(0, p.i - 3); k--) {
    if (is(doc.paras[k])) return 'before'
    if (norm(doc.paras[k].text) && !doc.paras[k].inTable) break
  }
  return 'unknown'
}

export function findCaptions(ctx: Ctx): Caption[] {
  const { doc } = ctx
  const [start, end] = bodyRange(ctx)
  const out: Caption[] = []
  for (let k = start; k < end; k++) {
    const p = doc.paras[k]
    const t = norm(p.text)
    const m = LABEL.exec(t)
    if (!m || p.inTable || isTocLine(p.text) || t.length > (labelBold(p) ? 400 : 250)) continue
    const rest = m[3]
    // "Table 1 shows that…" and "Table 1, the…" are sentences about the table, not its caption;
    // nor is a continued table's.
    if ((rest && /^\p{Ll}/u.test(rest) && !bolded(p)) || /^[,;)]/.test(rest) || CONTINUED.test(t))
      continue
    const kind: Caption['kind'] = /^fig/i.test(m[1]) ? 'figure' : 'table'
    let title: Para | undefined
    if (!rest) {
      for (let j = k + 1; j < Math.min(end, k + 4); j++) {
        const q = doc.paras[j]
        if (q.inTable || q.image) break
        if (norm(q.text)) {
          if (norm(q.text).length <= 250 && !LABEL.test(norm(q.text))) title = q
          break
        }
      }
    }
    out.push({
      para: p,
      kind,
      number: m[2],
      inline: rest,
      title,
      object: objectSide(ctx, p, kind, title),
    })
  }
  return out
}

const name = (c: Caption) => `${c.kind === 'table' ? 'Table' : 'Figure'} ${c.number}`
/** "Table 1, Table 2 and 5 more": up to six names, then how many more. */
const names = (cs: Caption[]) =>
  list(
    cs
      .slice(0, 6)
      .map(name)
      .concat(
        cs.length > 6
          ? [
              more(
                cs.length - 6,
                cs.slice(6).map((c) => c.para.page),
              ).replace(/^…and /, ''),
            ]
          : [],
      ),
  )
const at = (c: Caption) => ({ page: c.para.page, quote: quote(c.para.text, 50) })

/** Tables and pictures in the body that no caption sits beside (Word). */
function unlabelled(ctx: Ctx, caps: Caption[]): string[] {
  const { doc } = ctx
  if (doc.kind === 'pdf') return unlabelledPictures(ctx, caps)
  const [start, end] = bodyRange(ctx)
  const out: string[] = []
  const near = (i: number) =>
    caps.some((c) => Math.abs(c.para.i - i) <= 4 || (c.title && Math.abs(c.title.i - i) <= 3)) ||
    doc.paras.slice(Math.max(0, i - 4), i).some((q) => CONTINUED.test(norm(q.text)))
  const seen = new Set<number>()
  for (let k = start; k < end; k++) {
    const p = doc.paras[k]
    if (p.inTable && p.table !== undefined && !seen.has(p.table)) {
      seen.add(p.table)
      if (!near(k)) out.push(`a table starting “${quote(p.text, 40) || '…'}”`)
    } else if (p.image && !p.inTable && !near(k))
      out.push(`a picture near “${quote(doc.paras[k + 1]?.text ?? '', 40)}”`)
  }
  return out
}

/** PDF: pictures an inch or more each way on the chapters' pages with no caption beside them:
 *  none on their page, nor one closing the page before (when the picture opens its page) or
 *  opening the page after (when it closes its page). Logos, symbols and the seal are smaller or
 *  elsewhere; scanned documents in the appendices need no caption. */
function unlabelledPictures(ctx: Ctx, caps: Caption[]): string[] {
  const { doc, s } = ctx
  const pages = doc.pages ?? []
  if (!s.chapters.length) return []
  const from = doc.paras[s.chapters[0].heading].page ?? 0
  const end = s.references?.heading ?? s.appendicesHeading ?? s.appendices[0]?.heading
  const to = end === undefined ? pages.length : (doc.paras[end].page ?? pages.length)
  // Each page's text from its first line to its last.
  const tops = new Map<number, number>()
  const bottoms = new Map<number, number>()
  for (const p of doc.paras)
    for (const l of p.lines ?? []) {
      tops.set(l.page, Math.min(tops.get(l.page) ?? l.y, l.y))
      bottoms.set(l.page, Math.max(bottoms.get(l.page) ?? l.y, l.y))
    }
  const captioned = (n: number, i?: number) =>
    caps.some((c) => c.para.page === n && (i === undefined || c.para.i === i))
  const out: number[] = []
  for (const pg of pages.slice(from, to)) {
    if (captioned(pg.n)) continue
    const big = pg.images.filter(
      (b) =>
        Math.min(b.x1 - b.x0, b.y1 - b.y0) >= 72 &&
        b.y1 > 0.12 * pg.height &&
        b.y0 < 0.88 * pg.height,
    )
    const lonely = big.some(
      (b) =>
        !(
          b.y1 <= (tops.get(pg.n) ?? Infinity) && captioned(pg.n - 1, pages[pg.n - 1]?.paras.at(-1))
        ) &&
        !(
          b.y0 >= (bottoms.get(pg.n) ?? -Infinity) && captioned(pg.n + 1, pages[pg.n + 1]?.paras[0])
        ),
    )
    if (lonely) out.push(pg.n)
  }
  return out.map((n) => `a picture on ${pagesText([n])}`)
}

export function figureRules(ctx: Ctx, caps: Caption[]): Finding[] {
  const lonely = unlabelled(ctx, caps)
  if (!caps.length) {
    if (lonely.length)
      return [
        fix('figures.number', 'Add a figure/table number (in bold) above each figure and table.', {
          details: lonely.slice(0, 5),
        }),
        fix(
          'figures.title',
          'Add a figure/table title (in italics) right below each figure/table number.',
        ),
        review('figures.apa', 'Check the APA style figure and table setup.'),
      ]
    return [
      na('figures.number', 'No figures or tables found.'),
      na('figures.title', 'No figures or tables found.'),
      na('figures.apa', 'No figures or tables found.'),
    ]
  }

  const notBold = caps.filter((c) => !labelBold(c.para))
  const below = caps.filter((c) => c.object === 'before')
  const numberIssues: string[] = []
  if (below.length)
    numberIssues.push(
      `Below the ${below.length === 1 ? 'figure/table' : 'figures/tables'}: ${names(below)}.`,
    )
  if (notBold.length) numberIssues.push(`Not in bold: ${names(notBold)}.`)
  if (lonely.length) numberIssues.push(`No number at all: ${list(lonely.slice(0, 3))}.`)
  // An old .doc is read for its text only: bold and italics are for the student to check.
  const plain = ctx.doc.kind === 'doc'
  // A table or chart the file does not place (a PDF's drawn chart, Word shapes): not "above".
  const unsure = caps.filter((c) => c.object === 'unknown')
  const number = numberIssues.length
    ? fix(
        'figures.number',
        'Transfer the figure/table number (in bold letters) above the figure/table.',
        {
          details: numberIssues,
          where: spread([...below, ...notBold].map(at)),
        },
      )
    : unsure.length
      ? review(
          'figures.number',
          `Check that ${names(unsure)} ${unsure.length === 1 ? 'has its' : 'have their'} number above the figure/table: this file does not show where ${unsure.length === 1 ? 'it stands' : 'they stand'}.`,
          { where: spread(unsure.map(at)) },
        )
      : plain
        ? review(
            'figures.number',
            `All ${caps.length} figure/table numbers are above their figure or table. Check that they are bold (an old .doc file does not say).`,
          )
        : ok(
            'figures.number',
            `All ${caps.length} figure/table numbers are bold and above their figure or table.`,
          )

  const sameLine = caps.filter((c) => c.inline)
  const noTitle = caps.filter((c) => !c.inline && !c.title)
  const notItalic = caps.filter((c) => c.title && !italic(c.title))
  const titleIssues: string[] = []
  if (sameLine.length) titleIssues.push(`Title on the same line as the number: ${names(sameLine)}.`)
  if (notItalic.length) titleIssues.push(`Title not in italics: ${names(notItalic)}.`)
  if (noTitle.length) titleIssues.push(`No title below the number: ${names(noTitle)}.`)
  const title = titleIssues.length
    ? fix(
        'figures.title',
        'Place the figure/table title (in italics) right below the figure/table number.',
        {
          details: titleIssues,
          where: spread([...sameLine, ...notItalic, ...noTitle].map(at)),
        },
      )
    : plain
      ? review(
          'figures.title',
          'Every figure/table title is right below its number. Check that the titles are in italics (an old .doc file does not say).',
        )
      : ok('figures.title', 'Every figure/table title is in italics, right below its number.')

  // Numbering: 1, 2, 3… for tables and for figures, each in order.
  const order: string[] = []
  for (const kind of ['table', 'figure'] as const) {
    const nums = caps.filter((c) => c.kind === kind && /^\d+$/.test(c.number)).map((c) => +c.number)
    const dup = nums.filter((n, k) => nums.indexOf(n) !== k)
    if (dup.length) order.push(`${kind === 'table' ? 'Table' : 'Figure'} ${dup[0]} is used twice.`)
    else if (nums.some((n, k) => k > 0 && n !== nums[k - 1] + 1))
      order.push(
        `${kind === 'table' ? 'Tables' : 'Figures'} are not numbered in order (${nums.slice(0, 8).join(', ')}).`,
      )
  }
  const apaStatus = worst([number.status, title.status, order.length ? 'fix' : 'ok'])
  // The rest of the APA setup (title case, notes, table lines) is not read, and reviewers ask for it.
  const apa =
    apaStatus === 'ok'
      ? review(
          'figures.apa',
          'Check the rest of the APA setup (titles in title case, notes, table lines) against the APA pages linked here: numbers, titles and numbering follow it.',
        )
      : {
          ...(apaStatus === 'fix' && order.length
            ? fix(
                'figures.apa',
                'Follow the APA style figure and table setup (see the APA pages linked here).',
              )
            : review(
                'figures.apa',
                'Check the APA style figure and table setup (see the APA pages linked here).',
              )),
          details: order.length ? order : undefined,
        }
  return [number, title, apa]
}
