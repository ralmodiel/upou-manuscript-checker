// What the program's reviewers also point out: template text left in, blank pages, coloured text.
import type { Para } from '../model.ts'
import { fix, ok, review, type Ctx, type Finding } from '../report.ts'
import { nextText } from '../structure.ts'
import { list, norm, quote } from '../text.ts'
import { noTextPages, pagesText } from './numbering.ts'

// Template text no other check reports.
const PLACEHOLDERS: [RegExp, string][] = [
  [/^x{6,}/i, 'filler text “Xxxxxxx…”'],
  [/insert figure here/i, '“--- INSERT FIGURE HERE ---”'],
  [/^author'?s name$/i, '“AUTHOR’S NAME”'],
  [/^(column \d+\s*)+$/i, 'the sample table (“Column 1”, “Content”)'],
  // The degree's name left as the word "Course" (or "Program").
  [
    /for the degree,?\s*(course|program)\.?$/i,
    '“Course” or “Program” in place of the degree on the Acceptance Page',
  ],
]
// Capitals as the template has them; a table's heading or cell is not one.
const LONE: [RegExp, string][] = [
  [/^NAME$/, '“NAME” in place of a name'],
  [/(^|,\s*)DATE$/, '“DATE” in place of the date'],
]
const SAMPLE_TABLE = 'the sample table (“Column 1”, “Content”)'
const TOC_ZEROS = 'table of contents page numbers “0” or “00”'

function placeholders(ctx: Ctx): Finding {
  const id = 'extra.placeholders'
  const hits = new Map<string, { page?: number; quote: string }>()
  const hit = (name: string, p: Para) => {
    if (!hits.has(name)) hits.set(name, { page: p.page, quote: quote(p.text, 40) })
  }
  const lists = ctx.s.prelims.filter(
    (x) => x.key === 'toc' || x.key === 'tables' || x.key === 'figures',
  )
  const columns = ctx.doc.paras.filter((p) => /^(column \d+\s*)+$/i.test(norm(p.text)))
  for (const p of ctx.doc.paras) {
    const t = norm(p.text)
    for (const [re, name] of PLACEHOLDERS) if (re.test(t)) hit(name, p)
    if (!p.inTable && !p.text.includes('\t'))
      for (const [re, name] of LONE) if (re.test(t)) hit(name, p)
    // "Content" is a cell of the sample table, beside its "Column 1": a table of the student's
    // own may have one too.
    if (
      /^(content\s*)+$/i.test(t) &&
      columns.some((c) => (p.table !== undefined ? c.table === p.table : c.page === p.page))
    )
      hit(SAMPLE_TABLE, p)
    // Zeros after the entries of a contents page; a data row may end in them too.
    if (
      /(\t|\.{3,}|\s{2,})0{1,2}\s*$/.test(p.text) &&
      lists.some((x) => p.i > x.heading && p.i < x.end)
    )
      hit(TOC_ZEROS, p)
  }
  // The date under the Dean's name (the title page's date has a check of its own).
  const acc = ctx.s.acceptance
  const day =
    acc &&
    ctx.doc.paras.slice(acc.start, acc.end).find((p) => /^day\s+month\s+year$/i.test(norm(p.text)))
  if (day)
    hits.set('“Day Month Year” (the date) on the Acceptance Page', {
      page: day.page,
      quote: quote(day.text, 40),
    })
  if (!hits.size) return ok(id, 'No template placeholder text left.')
  return fix(id, 'Replace the template’s placeholder text with your own.', {
    details: [...hits.keys()].map((k) => `Still there: ${k}`),
    where: [...hits.values()].slice(0, 5),
  })
}

function blankPages(ctx: Ctx): Finding {
  const id = 'extra.blankPages'
  const { doc } = ctx
  if (doc.kind === 'pdf') {
    // A page holding only the end of a paragraph begun on the page before is not blank.
    const inked = new Set(doc.paras.flatMap((p) => (p.lines ?? []).map((l) => l.page)))
    const drawn = noTextPages(doc)
    const blank = (doc.pages ?? [])
      .filter((pg) => !inked.has(pg.n) && !pg.images.length && !drawn.has(pg.n))
      .map((pg) => pg.n)
    if (!blank.length) return ok(id, 'No blank pages.')
    return fix(
      id,
      // The places list up to five pages; the message names them all only when there are more.
      `Remove the blank ${blank.length === 1 ? 'page' : 'pages'}${blank.length > 5 ? ` (${pagesText(blank)})` : ''}.`,
      { where: blank.slice(0, 5).map((page) => ({ page })) },
    )
  }
  // Word: two page starts with nothing between them.
  const empty = (p: Para) => !norm(p.text) && !p.image && !p.shapes && !p.inTable && !p.inBox
  const starts = doc.paras.filter((p) => p.newPage).map((p) => p.i)
  const blank: string[] = []
  for (let k = 0; k + 1 < starts.length; k++) {
    const between = doc.paras.slice(starts[k], starts[k + 1])
    if (between.every(empty)) {
      const next = doc.paras[starts[k + 1]]
      blank.push(`before “${quote(next.text, 40)}”`)
    }
  }
  if (blank.length)
    return fix(
      id,
      `Remove the blank ${blank.length === 1 ? 'page' : 'pages'} (${list(blank.slice(0, 4))}).`,
    )
  // Empty lines before a page break spill onto a page of their own when the page above is nearly
  // full (the template's blank page). A Word file does not record where its pages break.
  const padded: string[] = []
  for (const i of [...starts, doc.paras.length]) {
    let n = 0
    while (i - n > 0 && empty(doc.paras[i - n - 1])) n++
    if (n < 5) continue
    const next = nextText(doc.paras, i)
    padded.push(next === undefined ? 'the end' : `“${quote(doc.paras[next].text, 30)}”`)
  }
  if (padded.length)
    return review(
      id,
      `Empty lines before ${list(padded.slice(0, 4))} can spill onto a blank page. Check the PDF version, and start new pages with a page break (Ctrl+Enter) instead of empty lines.`,
    )
  return ok(id, 'No blank pages from page breaks.')
}

/** Clearly coloured (not black, dark grey or a link): red quotes, pink bars, light-grey text. */
const coloured = (hex: string) => {
  if (!/^[0-9a-f]{6}$/.test(hex)) return true
  const [r, g, b] = [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16))
  return Math.max(r, g, b) - Math.min(r, g, b) > 50 || Math.min(r, g, b) > 0x90
}

function colour(ctx: Ctx): Finding {
  const id = 'extra.color'
  const { doc } = ctx
  if (doc.kind === 'doc')
    return review(id, 'Make sure all text is black (an old .doc file does not say).')
  const URL = /https?:\/\/|doi\.org|www\./i
  // Links keep their colour: say so when some were left aside.
  const black = (links: boolean) => ok(id, `All text is black${links ? ' (links aside)' : ''}.`)
  if (doc.kind === 'pdf') {
    // Charts and links may be coloured on purpose, so a PDF's coloured text is for a second look.
    const pages = doc.pages ?? []
    const shown = pages.flatMap((pg) =>
      pg.colored
        .filter((c) => coloured(c.color.replace('#', '').toLowerCase()))
        .map((c) => ({ page: pg.n, text: c.text, color: c.color })),
    )
    const hits = shown.filter((h) => !URL.test(h.text))
    if (!hits.length) return black(hits.length < shown.length || pages.some((pg) => pg.linked))
    return review(id, 'Change colored text to black (unless it is part of a chart or figure).', {
      details: hits
        .slice(0, 5)
        .map((h) => `${pagesText([h.page])}: “${quote(h.text, 30)}” (${h.color})`),
      where: hits.slice(0, 5).map((h) => ({ page: h.page, quote: quote(h.text, 30) })),
    })
  }
  const hits: { quote: string; color: string }[] = []
  let links = false
  for (const p of doc.paras)
    for (const r of p.runs) {
      if (!r.color || !r.text.trim() || !coloured(r.color)) continue
      if (r.link || URL.test(r.text)) links = true
      else hits.push({ quote: `${quote(r.text, 25)}” in “${quote(p.text, 40)}`, color: r.color })
    }
  if (!hits.length) return black(links)
  return fix(id, 'Change colored text to black.', {
    details: hits
      .slice(0, 5)
      .map((h) => `“${h.quote}” (${/^[0-9a-f]{6}$/.test(h.color) ? '#' + h.color : h.color})`),
  })
}

export function extraRules(ctx: Ctx): Finding[] {
  return [placeholders(ctx), blankPages(ctx), colour(ctx)]
}
