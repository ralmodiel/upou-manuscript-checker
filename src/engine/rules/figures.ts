// Figures and tables: the number in bold above, the title in italics right below, APA style.
import type { Para } from '../model.ts'
import { fix, na, ok, review, worst, type Ctx, type Finding } from '../report.ts'
import { bolded, TOC_ENTRY } from '../structure.ts'
import { list, norm, quote } from '../text.ts'

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

const LABEL = /^(figure|table)\s+(\d+(?:[.-]\d+)*|[A-Z]-?\d+)\s*[.:–—-]?\s*(.*)$/i
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
  const start = s.chapters[0]?.start ?? s.prelims.at(-1)?.end ?? s.title.end
  return [start, doc.paras.length]
}

function objectSide(ctx: Ctx, p: Para, kind: Caption['kind'], title?: Para): Caption['object'] {
  const { doc } = ctx
  const is = (q: Para | undefined) => !!q && (kind === 'table' ? !!q.inTable : !!q.image)
  if (doc.kind === 'pdf') {
    if (kind === 'table') return 'unknown'
    const page = doc.pages?.[p.page ?? -1]
    const line = p.lines?.[0]
    if (!page || !line) return 'unknown'
    const below = page.images.some((b) => b.y0 >= line.y - 2 && b.x1 - b.x0 > 40)
    const above = page.images.some((b) => b.y1 <= line.y - line.size && b.x1 - b.x0 > 40)
    // A caption closing a page: the figure may open the next one.
    const last = page.paras.at(-1) === (title ?? p).i
    const nextTop = last && (doc.pages?.[(p.page ?? 0) + 1]?.images.length ?? 0) > 0
    return below || nextTop ? 'after' : above ? 'before' : 'unknown'
  }
  const from = (title ?? p).i + 1
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
    if (!m || p.inTable || TOC_ENTRY.test(p.text) || t.length > 250) continue
    const rest = m[3]
    // "Table 1 shows that…" is a sentence about the table, not its caption.
    if (rest && /^\p{Ll}/u.test(rest) && !bolded(p)) continue
    const kind = m[1].toLowerCase() as Caption['kind']
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
const at = (c: Caption) => ({ page: c.para.page, quote: quote(c.para.text, 50) })

/** Tables and pictures in the body that no caption sits beside (Word). */
function unlabelled(ctx: Ctx, caps: Caption[]): string[] {
  const { doc } = ctx
  if (doc.kind === 'pdf') return []
  const [start, end] = bodyRange(ctx)
  const out: string[] = []
  const near = (i: number) =>
    caps.some((c) => Math.abs(c.para.i - i) <= 4 || (c.title && Math.abs(c.title.i - i) <= 3))
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
        review('figures.apa', 'Follow the APA style figure and table setup.'),
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
      `Below the ${below.length === 1 ? 'figure/table' : 'figures/tables'}: ${list(below.slice(0, 6).map(name))}.`,
    )
  if (notBold.length) numberIssues.push(`Not in bold: ${list(notBold.slice(0, 6).map(name))}.`)
  if (lonely.length) numberIssues.push(`No number at all: ${list(lonely.slice(0, 3))}.`)
  const number = numberIssues.length
    ? fix(
        'figures.number',
        'Transfer the figure/table number (in bold letters) above the figure/table.',
        {
          details: numberIssues,
          where: [...below, ...notBold].slice(0, 5).map(at),
        },
      )
    : ok(
        'figures.number',
        `All ${caps.length} figure/table numbers are bold and above their figure or table.`,
      )

  const sameLine = caps.filter((c) => c.inline)
  const noTitle = caps.filter((c) => !c.inline && !c.title)
  const notItalic = caps.filter((c) => c.title && !italic(c.title))
  const titleIssues: string[] = []
  if (sameLine.length)
    titleIssues.push(
      `Title on the same line as the number: ${list(sameLine.slice(0, 6).map(name))}.`,
    )
  if (notItalic.length)
    titleIssues.push(`Title not in italics: ${list(notItalic.slice(0, 6).map(name))}.`)
  if (noTitle.length)
    titleIssues.push(`No title below the number: ${list(noTitle.slice(0, 6).map(name))}.`)
  const title = titleIssues.length
    ? fix(
        'figures.title',
        'Place the figure/table title (in italics) right below the figure/table number.',
        {
          details: titleIssues,
          where: [...sameLine, ...notItalic, ...noTitle].slice(0, 5).map(at),
        },
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
  const apa =
    apaStatus === 'ok'
      ? ok('figures.apa', 'Numbers, titles and numbering follow the APA setup.')
      : {
          ...(apaStatus === 'fix' && order.length ? fix : review)(
            'figures.apa',
            'Follow the APA style figure and table setup (see the APA pages linked here).',
          ),
          details: order.length ? order : undefined,
        }
  return [number, title, apa]
}
