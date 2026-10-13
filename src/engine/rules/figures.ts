// Figures and tables: the number in bold above, the title in italics right below, APA style.
import type { Box, Para } from '../model.ts'
import { fix, na, ok, review, spread, type Ctx, type Finding } from '../report.ts'
import { bolded, headingText, isTocLine, LIST_HEADING } from '../structure.ts'
import { inShape, textSize } from './body.ts'
import { garbled, list, norm, quote } from '../text.ts'
import { noTextPages, pagesText } from './numbering.ts'

export interface Caption {
  para: Para
  kind: 'figure' | 'table'
  number: string
  /** Title written on the number's own line. */
  inline: string
  title?: Para
  /** Where the figure or table itself stands: after the caption (right), before it, or unknown. */
  object: 'after' | 'before' | 'unknown'
  /** The number written with a space inside it ("Table 1 9"). */
  split?: boolean
}

// "Chart S1:", "Figure 4a", "Figure 6-A" and "Table 3 .1" (a stray space) are labels too; "Figure 5.
// 3D model" is Figure 5, then its title.
const LABEL =
  /^(fig(?:ure)?\.?|table|chart)\s*(\d+(?:\s?[.-]\s?\d+(?![a-z]))*(?:-?[a-z](?![a-z]))?|[A-Z]-?\d+(?:[.-]\d+)*)\s*[.:–—-]?\s*(.*)$/i
/** "Table 1 (continued)": a long table carried over to the next page, not a caption of its own. */
const CONTINUED = /^(figure|table)\s+\S+\s*\(?cont(inued|['’]d|\.)?\)?\.?$/i
/** A PDF paragraph set in a font whose name says nothing: its bold and italics are unknown. */
// (or in a typeface of its own that is never bold anywhere: it may have no bold to show)
let singleWeight = new Set<string>()
const faceUnknown = (p: Para) =>
  p.runs.some(
    (r) => r.text.trim() && (r.unknown || (r.font !== undefined && singleWeight.has(r.font))),
  )
/** Typefaces of the document that are not one of the common ones and have no bold run at all. */
function singleWeights(ctx: Ctx): Set<string> {
  const fonts = new Map<string, boolean>()
  const uses = new Map<string, number>()
  let all = 0
  for (const p of ctx.doc.paras)
    for (const r of p.runs)
      if (r.text.trim() && r.font) {
        fonts.set(r.font, !!fonts.get(r.font) || !!r.bold)
        uses.set(r.font, (uses.get(r.font) ?? 0) + 1)
        all++
      }
  // (a typeface of a few words here and there, not the one the text is set in)
  return new Set(
    [...fonts]
      .filter(
        ([f, bold]) =>
          !bold && !COMMON_FACE.test(f) && ctx.doc.kind === 'pdf' && uses.get(f)! < 0.25 * all,
      )
      .map(([f]) => f),
  )
}
const COMMON_FACE =
  /times|arial|calibri|cambria|helvetica|georgia|garamond|verdana|tahoma|courier|palatino|century|book antiqua|liberation|nimbus|dejavu|noto|open sans|roboto|lato|segoe|trebuchet|aptos|carlito|caladea|symbol|wingdings|cmr|latin modern|computer modern/i
const italic = (p: Para) => {
  if (p.plain || faceUnknown(p)) return true
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
  if (p.plain || faceUnknown(p)) return true
  const label = LABEL.exec(norm(p.text).replace(/^[(](.*)[)]$/, '$1'))
  if (!label) return false
  // (the number's own letters decide: the stop or colon after it may share the title's plain run)
  const head = norm(p.text)
    .slice(0, norm(p.text).length - label[3].length)
    .replace(/[\s.:–—-]+$/, '')
  let seen = ''
  for (const r of p.runs) {
    if (seen.length >= head.length) break
    // (the full stop or colon after the number may be set apart from it, not in bold)
    if (r.text.trim() && !/^[.:–—-]+$/.test(r.text.trim()) && !r.bold) return false
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
    let rowsBefore = false
    if (kind === 'table') {
      const row = (q: Para) => q.text.includes('\t')
      // (below it, a table's cells read one to a line count too)
      if (doc.paras.slice(from, from + 3).some((q) => row(q) || q.inTable)) return 'after'
      // (rows above it, with no running text between: a paragraph of three lines or more ends them)
      for (let k = p.i - 1; k >= Math.max(0, p.i - 3); k--) {
        const q = doc.paras[k]
        if (q.page !== p.page) break
        rowsBefore = row(q)
        if (rowsBefore || (q.lines?.length ?? 0) >= 3) break
      }
    }
    const n = p.page ?? -1
    const page = doc.pages?.[n]
    const line = p.lines?.[0]
    if (!page || !line) return rowsBefore ? 'before' : 'unknown'
    const end = (title ?? p).lines?.findLast((l) => l.page === n) ?? line
    const wide = (b: Box) => b.x1 - b.x0 > 40
    const top = line.y - line.size
    // (a picture whose frame takes the caption in: with its white margins, the caption may stand
    // above or below what shows; not a picture filling the page)
    const over = (b: Box) =>
      wide(b) && b.y0 < line.y - 2 && b.y1 > top && b.y1 - b.y0 < 0.8 * page.height
    // (a picture above with another caption right over it is that caption's figure)
    const taken = (b: Box) =>
      page.paras.some((i) => {
        const q = doc.paras[i]
        const m = LABEL.exec(norm(q.text))
        // (a caption, not a sentence about a figure: "Figure 2 shows…")
        if (i >= p.i || !m || norm(q.text).length > 250 || /^\p{Ll}/u.test(m[3])) return false
        const last = (i + 1 < p.i && !m[3] ? doc.paras[i + 1] : q).lines
          ?.filter((l) => l.page === n)
          .at(-1)
        return !!last && b.y0 - last.y >= -2 && b.y0 - last.y < 5 * line.size
      })
    // How far each picture on the page stands below the caption, or above it.
    const below = page.images.filter((b) => wide(b) && b.y0 >= line.y - 2).map((b) => b.y0 - end.y)
    const above = page.images
      .filter((b) => wide(b) && b.y1 <= top && !taken(b))
      .map((b) => top - b.y1)
    // A picture right by the caption is its figure, whatever else the pages hold.
    const near = (gaps: number[]) => gaps.some((g) => g < 5 * line.size)
    // (a table pasted as a picture right under the caption is its table, not the rows above)
    if (near(below)) return 'after'
    if (rowsBefore) return 'before'
    // (a caption between two pictures, the one below a little further off: either may be its own)
    if (near(above))
      return below.some((g) => g < 12 * line.size) || page.images.some(over) ? 'unknown' : 'before'
    if (page.images.some(over)) return 'unknown'
    // A caption closing its page (footnotes in smaller type aside), and a picture opening the next.
    const next = doc.pages?.[n + 1]
    const nextText = next && doc.paras[next.paras[0]]?.lines?.[0]
    if (
      page.paras
        .filter((i) => i > (title ?? p).i)
        .every((i) => (doc.paras[i].lines?.[0]?.size ?? 0) < line.size - 1) &&
      next?.images.some((b) => wide(b) && (!nextText || b.y1 <= nextText.y))
    )
      return 'after'
    // A number closing its page, its title opening the next with the picture below the title.
    const lead = title && doc.paras[title.i]
    if (
      page.paras.at(-1) === p.i &&
      title &&
      next?.paras[0] === title.i &&
      (lead?.lines?.length ?? 0) <= 3 &&
      next.images.some(
        (b) =>
          wide(b) && b.y0 >= lead!.lines![0].y && b.y0 - lead!.lines!.at(-1)!.y <= 4 * line.size,
      )
    )
      return 'after'
    // A figure drawn in vectors (boxes and arrows) under the caption is its figure too.
    if (
      kind === 'figure' &&
      page.marks.filter(
        (m) =>
          m.kind === 'path' &&
          m.y0 >= end.y - 2 &&
          m.x1 - m.x0 > 20 &&
          m.y1 - m.y0 > 10 &&
          m.x1 - m.x0 < 0.95 * page.width,
      ).length >= 4
    )
      return 'after'
    // A caption opening its page, and a picture closing the page before.
    const prevPage = doc.pages?.[n - 1]
    const prevText = doc.paras[p.i - 1]?.lines?.findLast((l) => l.page === n - 1)
    // (not when a picture of this page stands under it, within two inches)
    if (
      page.paras[0] === p.i &&
      !below.some((g) => g < 12 * line.size) &&
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

const ENTRY = /^(fig(ure)?|table)\.?\s*\d+[A-Za-z]?[.:]?\t/i

export function findCaptions(ctx: Ctx): Caption[] {
  const { doc } = ctx
  singleWeight = singleWeights(ctx)
  const [start, end] = bodyRange(ctx)
  const out: Caption[] = []
  const seen = new Map<string, number>()
  const size = textSize(doc.paras)
  // Pages that list tables and figures (a list put at the end too): their entries are not captions.
  const listed = new Set(
    doc.paras.flatMap((q) =>
      q.page !== undefined && LIST_HEADING.test(headingText(q)) && norm(q.text).length < 45
        ? [q.page]
        : [],
    ),
  )
  const entries = new Map<number, number>()
  for (const q of doc.paras)
    if (q.page !== undefined && ENTRY.test(q.text))
      entries.set(q.page, (entries.get(q.page) ?? 0) + 1)
  for (let k = start; k < end; k++) {
    const p = doc.paras[k]
    const t = norm(p.text)
    // (a label set in brackets under its picture: "(Figure 3)")
    const m = LABEL.exec(t) ?? (/^[(].*[)]$/.test(t) ? LABEL.exec(t.slice(1, -1)) : null)
    if (
      !m ||
      p.inTable ||
      isTocLine(p.text) ||
      // (a caption can run to a paragraph, but then the label is closed by a full stop or a
      // colon: "Table 1 (see next page) presents…" is a sentence)
      t.length > (labelBold(p) ? 1500 : 1000) ||
      (t.length > (labelBold(p) ? 400 : 250) &&
        !/^[A-Za-z.]+\s*[A-Z]?\d[\d.a-z -]*?\s?[.:]\s/i.test(t)) ||
      (p.page !== undefined && listed.has(p.page)) ||
      // (a list's entry, label then tab then title, with others like it on the page: a list not headed as one)
      (p.page !== undefined && ENTRY.test(p.text) && entries.get(p.page)! >= 2) ||
      // (a long paragraph opened like the body's own, with an indent, is running text)
      (t.length > 400 &&
        (p.indent?.firstLine ?? 0) >= 15 &&
        p.align === 'justify' &&
        !labelBold(p)) ||
      // (a bare label in the small type of a table's cell or a diagram is no caption)
      // (unless it is in bold and its title stands right under it: a writer's smaller caption type)
      (!m[3] &&
        !!p.lines?.[0] &&
        p.lines[0].size < size - 1 &&
        !(
          (bolded(p) || faceUnknown(p)) &&
          /^fig/i.test(t) &&
          doc.paras[k + 1]?.page === p.page &&
          !doc.paras[k + 1].inTable &&
          !doc.paras[k + 1].text.includes('\t') &&
          norm(doc.paras[k + 1].text).split(' ').length >= 3
        ) &&
        // (or its title, in the same small type and at the same margin, with a picture below)
        !(
          /^fig/i.test(t) &&
          doc.paras[k + 1]?.page === p.page &&
          !doc.paras[k + 1].inTable &&
          !doc.paras[k + 1].text.includes('\t') &&
          norm(doc.paras[k + 1].text).split(' ').length >= 2 &&
          Math.abs((doc.paras[k + 1].lines?.[0].size ?? 0) - p.lines[0].size) <= 0.6 &&
          Math.abs((doc.paras[k + 1].lines?.[0].x0 ?? 0) - p.lines![0].x0) <= 3 &&
          !!doc.pages?.[p.page ?? -1]?.images.some(
            (b) => b.x1 - b.x0 > 100 && b.y0 >= p.lines![0].y - 2,
          )
        )) ||
      // (a label in a drawn box is a diagram's own, unless the box frames the whole figure: the
      // label in bold, in the text's type, its title right under it at the same margin)
      (!m[3] &&
        inShape(ctx, p) &&
        !(
          bolded(p) &&
          (p.lines?.[0]?.size ?? 0) >= size - 1 &&
          doc.paras[k + 1]?.page === p.page &&
          !doc.paras[k + 1].inTable &&
          !doc.paras[k + 1].text.includes('\t') &&
          norm(doc.paras[k + 1].text).split(' ').length >= 3 &&
          Math.abs((doc.paras[k + 1].lines?.[0]?.x0 ?? -99) - (p.lines?.[0]?.x0 ?? 0)) <= 3
        )) ||
      /^(fig(ure)?\.?|table|chart)\s*\d+[A-Za-z]{2,}/i.test(t)
    )
      continue
    // "Chart 2: Title" right under a bare "Figure 68.": the figure's title, not a caption of its own.
    const bare = k > 0 ? LABEL.exec(norm(doc.paras[k - 1].text)) : null
    if (
      /^chart/i.test(m[1]) &&
      bare &&
      !bare[3] &&
      !/^chart/i.test(bare[1]) &&
      doc.paras[k - 1].page === p.page
    )
      continue
    // ("Table 1 9", its title on the next line: a stray space inside the number, Table 19)
    const split = /^\d+$/.test(m[2]) && /^\d{1,2}$/.test(m[3])
    const number = split ? m[2] + m[3] : m[2].replace(/\s/g, '')
    const rest = split ? '' : m[3]
    // "Table 1 shows that…" and "Table 1, the…" are sentences about the table, not its caption;
    // nor is a continued table's.
    if (
      (rest && /^\p{Ll}/u.test(rest) && !bolded(p)) ||
      // (a sentence in a font read wrongly: its first word, "shows", has capitals inside it)
      // (a caption whose title alone is garbled keeps its label in bold: "Table 8. ReVSRQ…")
      (rest.length > 40 && garbled(rest) && !bolded(p) && !labelBold(p) && !faceUnknown(p)) ||
      /^[,;)]/.test(rest) ||
      // ("Table 3 (see below) presents…", "Figure 2 (next page) shows…": a sentence)
      /^\((see|below|above|next|on p)/i.test(rest) ||
      CONTINUED.test(t) ||
      /^\(?cont(inued|['’]d|\.)?\)?(\s|$)/i.test(rest)
    )
      continue
    const kind: Caption['kind'] = /^table/i.test(m[1]) ? 'table' : 'figure'
    let title: Para | undefined
    if (!rest) {
      for (let j = k + 1; j < Math.min(end, k + 4); j++) {
        const q = doc.paras[j]
        if (q.inTable || q.image) break
        if (norm(q.text)) {
          if (
            // (a long title set in italics is a title still)
            norm(q.text).length <= (italic(q) && !q.plain && !faceUnknown(q) ? 450 : 250) &&
            (!LABEL.test(norm(q.text)) || (/^chart/i.test(norm(q.text)) && !/^chart/i.test(m[1])))
          )
            title = q
          break
        }
      }
    }
    // A long table carried over the pages with its caption repeated on each (APA asks for
    // "(continued)", but it is still one table): same number and title on the page before or this one.
    // ("Table 6 (Continued) List of…" is the same table's caption again)
    const text = (rest || norm(title?.text ?? ''))
      .toLowerCase()
      .replace(/^\(?cont(inued|['’]d|\.)?\)?[\s.:-]*/, '')
    const key = `${kind}${number}`
    const lastPage = seen.get(key)
    seen.set(key, p.page ?? -1)
    const again = out.findLast((c) => c.kind === kind && c.number === number)
    const prior = (again?.inline || norm(again?.title?.text ?? '')).toLowerCase()
    const caption: Caption = {
      para: p,
      kind,
      number,
      inline: rest,
      title,
      object: objectSide(ctx, p, kind, title),
      ...(split ? { split } : {}),
    }
    // (a label left alone at the foot of a page and repeated with its title on the next is one too)
    if (
      lastPage !== undefined &&
      p.page !== undefined &&
      p.page - lastPage <= 1 &&
      (!text || !prior || prior.startsWith(text) || text.startsWith(prior))
    ) {
      // The one with the title stands for both.
      if (again && !prior && text) out[out.indexOf(again)] = caption
      continue
    }
    out.push(caption)
    // Captions standing side by side, on one line of a PDF ("Figure 4. Trees. Figure 5. Roots."):
    // each is a caption.
    if (p.lines && rest)
      for (const x of p.text.matchAll(
        /(?:\.|\t|(?<=[a-z0-9)])\s)\s*(Fig(?:ure)?\.?|Table)\s*(\d+(?:-?[a-z](?![a-z]))?)\s*[.:]\s+(?=\p{Lu})/gu,
      ))
        out.push({
          para: p,
          kind: /^table/i.test(x[1]) ? 'table' : 'figure',
          number: x[2],
          inline: norm(p.text.slice(x.index + x[0].length)),
          object: caption.object,
        })
  }
  return out
}

const name = (c: Caption) => `${c.kind === 'table' ? 'Table' : 'Figure'} ${c.number}`
/** "Table 1, Table 2 and 5 more (on pp. 4, 9)": up to six names, then how many more, and the pages
 *  of all of them. */
const names = (cs: Caption[]) => {
  const first = list(
    cs
      .slice(0, 6)
      .map(name)
      .concat(cs.length > 6 ? [`${cs.length - 6} more`] : []),
  )
  const pages = cs.flatMap((c) => (c.para.page === undefined ? [] : [c.para.page]))
  return cs.length > 6 && pages.length ? `${first} (on ${pagesText(pages)})` : first
}
const at = (c: Caption) => ({ page: c.para.page, quote: quote(c.para.text, 50) })

/** Tables and pictures in the body that no caption sits beside, and (PDF) pages whose pictures
 *  may belong to a figure captioned elsewhere. */
function unlabelled(
  ctx: Ctx,
  caps: Caption[],
): { sure: string[]; maybe: number[]; renamed?: string[] } {
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
  return { sure: out, maybe: [] }
}

/** PDF: pictures an inch or more each way on the chapters' pages with no caption beside them:
 *  none on their page, nor one closing the page before (when the picture opens its page) or
 *  opening the page after (when it closes its page). Logos, symbols and the seal are smaller or
 *  elsewhere; scanned documents in the appendices need no caption. */
function unlabelledPictures(
  ctx: Ctx,
  caps: Caption[],
): { sure: string[]; maybe: number[]; renamed: string[] } {
  const { doc, s } = ctx
  const pages = doc.pages ?? []
  if (!s.chapters.length) return { sure: [], maybe: [], renamed: [] }
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
    caps.some((c) => c.para.page === n && (i === undefined || c.para.i === i || c.title?.i === i))
  const out: number[] = []
  const maybe: number[] = []
  // Pictures under a label of another name below them ("Exhibit 1."): numbered, not as figures.
  const renamed: string[] = []
  // Pages whose pictures go on from a figure captioned on the page before.
  const carried = new Set<number>()
  const size = textSize(doc.paras)
  const unread = noTextPages(doc)
  for (const pg of pages.slice(from, to)) {
    // (a page of picture or drawn letters: its captions cannot be read)
    if (captioned(pg.n) || unread.has(pg.n)) continue
    // (not an icon in the cell of a table: a drawn box around it)
    const cell = (b: Box) =>
      pg.marks.some(
        (m) =>
          m.kind === 'path' &&
          m.x1 - m.x0 < 0.7 * pg.width &&
          m.x0 <= b.x0 + 2 &&
          m.x1 >= b.x1 - 6 &&
          m.y0 <= b.y0 + 2 &&
          m.y1 >= b.y1 - 2 &&
          (m.y1 - m.y0 < 1.6 * (b.y1 - b.y0) ||
            // (or a cell of a ruled table: boxes standing side by side)
            pg.marks.some(
              (n) =>
                n.kind === 'path' &&
                n !== m &&
                (Math.abs(n.x1 - m.x0) <= 1 || Math.abs(n.x0 - m.x1) <= 1) &&
                n.y0 <= m.y1 - 2 &&
                n.y1 >= m.y0 + 2,
            )),
      )
    const formula = [doc.paras[pg.paras[0] - 1], ...pg.paras.map((i) => doc.paras[i])].some(
      (q) => !!q && /\b(formulas?|equations?)\b/i.test(q.text),
    )
    const big = pg.images.filter(
      (b) =>
        Math.min(b.x1 - b.x0, b.y1 - b.y0) >= 72 &&
        b.y1 > 0.12 * pg.height &&
        b.y0 < 0.88 * pg.height &&
        !cell(b) &&
        // (nor an equation set as a picture, a line or two high, under "the formula below")
        !(b.y1 - b.y0 < 100 && formula),
    )
    // A number closing the page before, its title (a few lines) opening this one, the picture
    // below the title.
    const lead = doc.paras[pg.paras[0]]
    const titled =
      !!lead?.lines &&
      lead.lines.length <= 3 &&
      caps.some((c) => c.para.i === pages[pg.n - 1]?.paras.at(-1) && !c.inline && !!c.title)
    const leadEnd = titled ? lead.lines!.at(-1)!.y + 4 * lead.lines![0].size : -Infinity
    const lonely = big.some(
      (b) =>
        !(
          (b.y1 <= (tops.get(pg.n) ?? Infinity) ||
            (b.y0 >= (tops.get(pg.n) ?? Infinity) && b.y0 <= leadEnd)) &&
          captioned(pg.n - 1, pages[pg.n - 1]?.paras.at(-1))
        ) &&
        !(
          b.y0 >= (bottoms.get(pg.n) ?? -Infinity) && captioned(pg.n + 1, pages[pg.n + 1]?.paras[0])
        ),
    )
    if (!lonely) {
      if (big.length) carried.add(pg.n)
      continue
    }
    // Not sure: a page of pictures under at most a short label each, after a captioned figure
    // closing the page before (one figure running over pages), or a picture whose page names a
    // figure or table no caption carries (its number may be drawn in the picture).
    const texts = pg.paras.map((i) => doc.paras[i])
    const before = pages[pg.n - 1]
    const lastPic = before?.images.filter((b) => Math.min(b.x1 - b.x0, b.y1 - b.y0) >= 72).at(-1)
    const runsOn =
      (captioned(pg.n - 1) || maybe.includes(pg.n - 1) || carried.has(pg.n - 1)) &&
      !!lastPic &&
      // (a page of the picture alone, no text, runs on whatever it ends at)
      lastPic.y1 >= (bottoms.get(pg.n - 1) ?? -Infinity) - 60 &&
      // (running text may follow under the figure's last picture)
      texts.every(
        (q) =>
          (q.lines?.[0]?.y ?? 0) > Math.max(...big.map((b) => b.y1)) ||
          ((q.lines?.length ?? 0) <= 2 && norm(q.text).length < 160) ||
          (q.lines?.[0]?.size ?? size) < size - 1,
      )
    const named = texts.some((q) =>
      [...q.text.matchAll(/\b(Figure|Table)\s+(\d+)\b/g)].some(
        (x) => !caps.some((c) => c.kind === x[1].toLowerCase() && c.number === x[2]),
      ),
    )
    // (or a picture under a label of another name, "Graph 4.", "Extract 2": numbered, not as a figure)
    // (above the picture: one under it is a caption below its figure, which is to move)
    const other = texts.some(
      (q) =>
        norm(q.text).length <= 80 &&
        !!q.lines?.length &&
        big.every((b) => q.lines!.at(-1)!.y <= b.y0 + 2) &&
        /\b(graph|plate|map|photo(graph)?|diagram|illustration|exhibit|extract|image|picture|screenshot)\s*\d+\b/i.test(
          norm(q.text),
        ),
    )
    const under = texts.find(
      (q) =>
        norm(q.text).length <= 160 &&
        !!q.lines?.length &&
        big.some((b) => q.lines![0].y >= b.y1 - 2) &&
        /^(graph|plate|map|photo(graph)?|diagram|illustration|exhibit|extract|image|picture|screenshot)\s*\d+\s*[.:]/i.test(
          norm(q.text),
        ),
    )
    if (runsOn || named || other) maybe.push(pg.n)
    else if (under) renamed.push(`“${quote(under.text, 30)}” (${pagesText([pg.n])})`)
    else out.push(pg.n)
  }
  return { sure: out.map((n) => `a picture on ${pagesText([n])}`), maybe, renamed }
}

export function figureRules(ctx: Ctx, caps: Caption[]): Finding[] {
  const { sure: lonely, maybe, renamed = [] } = unlabelled(ctx, caps)
  if (!caps.length) {
    if (lonely.length || renamed.length)
      return [
        fix('figures.number', 'Add a figure/table number (in bold) above each figure and table.', {
          details: [...lonely, ...renamed].slice(0, 5),
        }),
        fix(
          'figures.title',
          'Add a figure/table title (in italics) right below each figure/table number.',
        ),
        review(
          'figures.apa',
          'No figure or table caption could be read here: check the APA style figure and table setup.',
        ),
      ]
    if (maybe.length)
      return [
        review(
          'figures.number',
          `Check the pictures on ${pagesText(maybe.slice(0, 6))}: give each figure a number (in bold) above it, unless the number is inside the picture.`,
          { where: maybe.slice(0, 5).map((page) => ({ page })) },
        ),
        review(
          'figures.title',
          'Check that each figure has a title (in italics) right below its number.',
        ),
        review(
          'figures.apa',
          'No figure or table caption could be read here: check the APA style figure and table setup.',
        ),
      ]
    // A List of Tables or Figures with entries: the captions are there, in pictures or in letters
    // that could not be read.
    const { s, doc } = ctx
    const listed = s.prelims
      .filter((x) => x.key === 'tables' || x.key === 'figures')
      .flatMap((x) => doc.paras.slice(x.heading + 1, x.end))
      .filter((p) => isTocLine(p.text) && /^(table|figure|fig\.)\s*\d/i.test(norm(p.text))).length
    // A table with no number or title: a page of the chapters with a table's rows (cells side by
    // side) and no caption on it.
    const from = s.chapters[0]?.start ?? doc.paras.length
    const to = s.references?.start ?? s.appendices[0]?.start ?? doc.paras.length
    const rows = new Map<number, number>()
    for (const p of doc.paras.slice(from, to))
      if (p.inTable && p.page !== undefined && p.text.includes('\t'))
        rows.set(p.page, (rows.get(p.page) ?? 0) + 1)
    const tablePages = [...rows].filter(([, n]) => n >= 3).map(([pg]) => pg)
    if (listed || tablePages.length) {
      const why = listed
        ? `The list of tables or figures has ${listed} ${listed > 1 ? 'entries' : 'entry'}, but no caption was found in the text (it may be inside a picture)`
        : `${pagesText(tablePages.slice(0, 5))} ${tablePages.length > 1 ? 'have tables' : 'has a table'} with no table number or title found`
      return [
        review(
          'figures.number',
          `${why}: check that each table and figure has its number (in bold) above it.`,
          { where: tablePages.slice(0, 5).map((page) => ({ page })) },
        ),
        review(
          'figures.title',
          `${why}: check that each table and figure has a title (in italics) right below its number.`,
        ),
        review(
          'figures.apa',
          'No figure or table caption could be read here: check the APA style figure and table setup.',
        ),
      ]
    }
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
  if (renamed.length)
    numberIssues.push(
      `Labelled by another name below the picture: ${list(renamed.slice(0, 3))}; number ${renamed.length > 1 ? 'each' : 'it'} as a figure, above it.`,
    )
  // An old .doc is read for its text only, and a PDF may name no font: bold and italics are for
  // the student to check.
  const plain = ctx.doc.kind === 'doc' || caps.some((c) => faceUnknown(c.para))
  const why =
    ctx.doc.kind === 'doc' ? 'an old .doc file does not say' : 'this PDF does not name its fonts'
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
    : unsure.length || maybe.length
      ? review(
          'figures.number',
          [
            unsure.length &&
              `Check that ${names(unsure)} ${unsure.length === 1 ? 'has its' : 'have their'} number above the figure/table: this file does not show where ${unsure.length === 1 ? 'it stands' : 'they stand'}.`,
            maybe.length &&
              `Check that the ${maybe.length === 1 ? 'picture' : 'pictures'} on ${pagesText(maybe.slice(0, 6))} ${maybe.length === 1 ? 'belongs' : 'belong'} to a numbered figure (one running on from the page before, or with its number inside the picture); if not, give ${maybe.length === 1 ? 'it a number' : 'each a number'} above it.`,
          ]
            .filter(Boolean)
            .join(' '),
          { where: spread([...unsure.map(at), ...maybe.map((page) => ({ page }))]) },
        )
      : plain
        ? review(
            'figures.number',
            `All ${caps.length} figure/table numbers are above their figure or table. Check that they are bold (${why}).`,
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
          `Every figure/table title is right below its number. Check that the titles are in italics (${why}).`,
        )
      : ok('figures.title', 'Every figure/table title is in italics, right below its number.')

  // Numbering: 1, 2, 3… for tables and for figures, each in order. A numbering by chapter (2.1,
  // 2.2, then a bare 3 for a chapter with one figure) runs by its first number; a letter after
  // the number (4a, 4b) marks parts of one figure. Anything else, as S1, is the writer's own.
  const order: string[] = []
  const odd: string[] = []
  for (const kind of ['table', 'figure'] as const) {
    const name = kind === 'table' ? 'Table' : 'Figure'
    const found = caps
      .filter((c) => c.kind === kind)
      .flatMap((c) => {
        const m = /^(\d+)(?:[.-](\d+))?(?:-?([a-z]))?$/i.exec(c.number)
        return m ? [{ text: c.number, a: +m[1], b: m[2] === undefined ? undefined : +m[2] }] : []
      })
    const texts = found.map((f) => f.text)
    const dup = texts.filter((t, k) => texts.indexOf(t) !== k)
    if (dup.length) {
      // (numbers starting over in the appendices: an appended document may number its own)
      const back = ctx.s.appendicesHeading ?? ctx.s.appendices[0]?.heading
      const inBack = (t: string) =>
        back !== undefined &&
        caps.filter((c) => c.kind === kind && c.number === t).every((c, k) => !k || c.para.i > back)
      if (dup.every(inBack))
        odd.push(
          `${name} ${dup[0]} is used again in the appendices: number them on from the chapters (or as ${name} A1), unless the appendix is a document of its own.`,
        )
      else order.push(`${name} ${dup[0]} is used twice.`)
      continue
    }
    const list = `${texts.slice(0, 8).join(', ')}`
    if (found.some((f) => f.b !== undefined)) {
      // By chapter: the first numbers never go back, and a chapter's second numbers run 1, 2, 3…
      let bad = false
      for (const [k, f] of found.entries()) {
        const prev = found[k - 1]
        if (prev && f.a < prev.a) bad = true
        if (f.b !== undefined && f.b !== (prev && prev.a === f.a ? (prev.b ?? 0) + 1 : 1))
          bad = true
        if (f.b === undefined && prev && prev.a === f.a) bad = true
      }
      if (bad) odd.push(`${name}s are numbered by chapter, but not in order (${list}).`)
    } else {
      const wholes = found.map((f) => f.a).filter((n, k, all) => k === 0 || n !== all[k - 1])
      // (PDF numbers that only skip, 1, 3, 4, may be a caption not read here: for the student to
      // check; numbers going back are a fault whatever was missed)
      const skips = wholes.some((n, k) => k > 0 && n !== wholes[k - 1] + 1)
      if (skips && ctx.doc.kind === 'pdf' && wholes.every((n, k) => k === 0 || n > wholes[k - 1]))
        odd.push(`${name} numbers skip (${list}): check that none is missing or misnumbered.`)
      else if (skips) order.push(`${name}s are not numbered in order (${list}).`)
    }
  }
  for (const c of caps.filter((x) => x.split))
    order.push(
      `${name(c)} has a space inside its number (“${quote(c.para.text, 12)}”): write it as one number.`,
    )
  // Only the APA item's own findings (numbering out of order or skipping): the number and title
  // items carry theirs, and what is not read here (title case, notes, table lines) is no finding.
  const apa = order.length
    ? fix(
        'figures.apa',
        'Follow the APA style figure and table setup (see the APA pages linked here).',
        { details: [...order, ...odd] },
      )
    : odd.length
      ? review(
          'figures.apa',
          'Check the APA style figure and table setup (see the APA pages linked here).',
          { details: odd },
        )
      : ok(
          'figures.apa',
          number.status === 'ok' && title.status === 'ok'
            ? 'Numbers, titles and numbering follow the APA setup.'
            : 'Numbering follows the APA setup (numbers and titles: see the items above).',
        )
  // Pages with no text layer among the chapters may hold figures and captions that cannot be read.
  const unread = [...noTextPages(ctx.doc)].filter(
    (n) => ctx.s.chapters.length > 0 && n >= (ctx.doc.paras[ctx.s.chapters[0].heading].page ?? 0),
  )
  const soften = (f: Finding): Finding =>
    unread.length && f.status === 'ok'
      ? review(
          f.id,
          `${pagesText(unread.slice(0, 6))}${unread.length > 6 ? ' and others' : ''} ${unread.length === 1 ? 'has' : 'have'} no text layer (a picture or drawn letters), so the figures and tables there could not be read. Check them yourself.`,
        )
      : f
  return [soften(number), soften(title), apa]
}
