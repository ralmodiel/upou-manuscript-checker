// What the program's reviewers also point out: template text left in, blank pages, coloured text.
import type { Para } from '../model.ts'
import { fix, ok, review, type Ctx, type Finding } from '../report.ts'
import { nextText } from '../structure.ts'
import { list, norm, quote } from '../text.ts'
import { pagesText } from './numbering.ts'

// Template text no other check reports.
const PLACEHOLDERS: [RegExp, string][] = [
  [/^x{6,}/i, 'filler text “Xxxxxxx…”'],
  [/insert figure here/i, '“--- INSERT FIGURE HERE ---”'],
  [/^author'?s name$/i, '“AUTHOR’S NAME”'],
  [/^(column \d+\s*)+$/i, 'the sample table (“Column 1”, “Content”)'],
  [/^(content\s*)+$/i, 'the sample table (“Column 1”, “Content”)'],
  [/(\t|\.{3,}|\s{2,})0{1,2}\s*$/, 'table of contents page numbers “0” or “00”'],
]

function placeholders(ctx: Ctx): Finding {
  const id = 'extra.placeholders'
  const hits = new Map<string, { page?: number; quote: string }>()
  for (const p of ctx.doc.paras) {
    const t = norm(p.text)
    for (const [re, name] of PLACEHOLDERS)
      if (re.test(re.source.includes('\\t') ? p.text : t) && !hits.has(name))
        hits.set(name, { page: p.page, quote: quote(p.text, 40) })
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
    const blank = (doc.pages ?? [])
      .filter((pg) => !pg.paras.length && !pg.images.length)
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
  if (doc.kind === 'pdf') {
    // Charts and links may be coloured on purpose, so a PDF's coloured text is for a second look.
    const hits = (doc.pages ?? []).flatMap((pg) =>
      pg.colored
        .filter(
          (c) =>
            coloured(c.color.replace('#', '').toLowerCase()) &&
            !/https?:\/\/|doi\.org|www\./i.test(c.text),
        )
        .map((c) => ({ page: pg.n, text: c.text, color: c.color })),
    )
    if (!hits.length) return ok(id, 'All text is black.')
    return review(id, 'Change colored text to black (unless it is part of a chart or figure).', {
      details: hits
        .slice(0, 5)
        .map((h) => `${pagesText([h.page])}: “${quote(h.text, 30)}” (${h.color})`),
      where: hits.slice(0, 5).map((h) => ({ page: h.page, quote: quote(h.text, 30) })),
    })
  }
  const hits: { quote: string; color: string }[] = []
  for (const p of doc.paras)
    for (const r of p.runs)
      if (
        r.color &&
        !r.link &&
        r.text.trim() &&
        coloured(r.color) &&
        !/https?:\/\/|doi\.org|www\./i.test(r.text)
      )
        hits.push({ quote: `${quote(r.text, 25)}” in “${quote(p.text, 40)}`, color: r.color })
  if (!hits.length) return ok(id, 'All text is black.')
  return fix(id, 'Change colored text to black.', {
    details: hits
      .slice(0, 5)
      .map((h) => `“${h.quote}” (${/^[0-9a-f]{6}$/.test(h.color) ? '#' + h.color : h.color})`),
  })
}

export function extraRules(ctx: Ctx): Finding[] {
  return [placeholders(ctx), blankPages(ctx), colour(ctx)]
}
