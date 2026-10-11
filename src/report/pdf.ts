// The formatting comments as a PDF, laid out with pdf-lib in the standard Helvetica faces (no font
// files to ship): A4, numbered parts, dash items with a hanging indent, a footer on every page.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB } from 'pdf-lib'
import type { ReportModel } from './model'

// Characters the standard fonts can encode (WinAnsi). The rest fall back: line breaks start a new
// line, other spaces become a space, dashes a hyphen, accented letters the plain letter (also when
// macOS spells "ñ" as "n" plus a tilde), invisible marks nothing; what is left (Chinese, emoji) "?".
const WIN_ANSI = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
const encodable = (c: string) => {
  const code = c.charCodeAt(0)
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI.has(c)
}
const safe = (s: string) =>
  [
    ...s
      .replace(/\r\n?|[\p{Zl}\p{Zp}]/gu, '\n')
      .replace(/[\t\p{Zs}]/gu, ' ')
      .normalize('NFC'),
  ]
    .map((c) => {
      if (c === '\n') return c
      if (/[\p{Cc}\p{Cf}\p{M}]/u.test(c)) return ''
      if (encodable(c)) return c
      if (/[\p{Pd}−]/u.test(c)) return '-'
      // Arrows (tables often use them) and symbol-font bullets have plain stand-ins.
      if (/[←-⇿➔-➿]/u.test(c)) return c === '←' ? '<-' : '->'
      if (/[\p{Co}■-◿]/u.test(c)) return '•'
      const plain = c.normalize('NFKD').replace(/\p{M}/gu, '')
      return plain && [...plain].every(encodable) ? plain : '?'
    })
    .join('')

/** The text in lines that fit `width`, as the PDF prints them. */
export function lines(text: string, font: PDFFont, size: number, width: number) {
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width
  const out: string[] = []
  for (const para of safe(text).split('\n')) {
    let line = ''
    for (const word of para.split(/ +/)) {
      const next = line ? `${line} ${word}` : word
      if (fits(next) || !line) line = next
      else {
        out.push(line)
        line = word
      }
      // A word wider than the line (a link, a file name joined with underscores) breaks anywhere.
      while (!fits(line)) {
        let k = 1
        while (fits(line.slice(0, k + 1))) k++
        out.push(line.slice(0, k))
        line = line.slice(k)
      }
    }
    out.push(line)
  }
  return out
}

const MAROON = rgb(0.482, 0.067, 0.075)
const FOREST = rgb(0, 0.337, 0.247)
const INK = rgb(0.216, 0.212, 0.216)
const MUTED = rgb(0.36, 0.353, 0.36)

export async function reportPdf(m: ReportModel): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${m.title}: ${m.file}`)
  pdf.setAuthor('MDC Format Check')
  pdf.setCreator('MDC Format Check')
  pdf.setProducer('MDC Format Check (pdf-lib)')
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique)

  const W = 595.28
  const H = 841.89
  const M = 56
  let page = pdf.addPage([W, H])
  let y = H - M

  /** Writes a block of text; `lead` is drawn before the first line (a dash), `indent` holds the rest.
   *  `keep` lines must fit on the page or the block starts a new one (a heading counts its followers). */
  const write = (
    text: string,
    o: {
      font?: PDFFont
      size?: number
      color?: RGB
      indent?: number
      hang?: number
      lead?: string
      before?: number
      after?: number
      keep?: number
    } = {},
  ) => {
    const font = o.font ?? regular
    const size = o.size ?? 10.5
    const lineH = size * 1.4
    const indent = o.indent ?? 0
    const hang = o.hang ?? 0
    const ls = lines(text, font, size, W - 2 * M - indent - hang)
    y -= o.before ?? 0
    if (y - lineH * (o.keep ?? Math.min(ls.length, 2)) < M + 24) {
      page = pdf.addPage([W, H])
      y = H - M
    }
    ls.forEach((l, k) => {
      if (y - lineH < M + 24) {
        page = pdf.addPage([W, H])
        y = H - M
      }
      y -= lineH
      if (k === 0 && o.lead)
        page.drawText(safe(o.lead), { x: M + indent, y, size, font, color: o.color ?? INK })
      page.drawText(l, { x: M + indent + hang, y, size, font, color: o.color ?? INK })
    })
    y -= o.after ?? 4
  }

  write(m.title, { font: bold, size: 20, color: MAROON, after: 6 })
  write(m.file, { font: bold, size: 12, after: 2 })
  write(m.meta, { size: 9.5, color: MUTED, after: 1 })
  write(m.summary, { size: 9.5, color: MUTED, after: 10 })
  write(m.notices[0], { font: italic, size: 9.5, color: MAROON, after: 12 })
  write(m.intro, { after: 8 })
  for (const part of m.parts) {
    write(`${part.n}. ${part.name}`, { font: bold, size: 12, before: 6, after: 3, keep: 3 })
    for (const item of part.items) {
      const text = `${item.check ? 'Check: ' : ''}${item.text}${item.where ? `  (${item.where})` : ''}`
      write(text, { lead: '-', indent: 6, hang: 10, after: 2 })
      for (const d of item.details)
        write(d, { lead: '›', size: 9.5, color: INK, indent: 18, hang: 10, after: 1 })
    }
  }
  if (m.passed.length) {
    write('Already in order', {
      font: bold,
      size: 12,
      color: FOREST,
      before: 12,
      after: 3,
      keep: 3,
    })
    for (const p of m.passed) write(`${p.name}: ${p.items.join(' · ')}.`, { size: 9.5, after: 3 })
  }
  y -= 6
  for (const c of m.closing) write(c, { after: 4 })
  write(m.notices[1], { font: italic, size: 8.5, color: MUTED, before: 8 })

  const pages = pdf.getPages()
  pages.forEach((p, k) => {
    const label = safe(
      `MDC Format Check · unofficial proof of concept (alpha) · page ${k + 1} of ${pages.length}`,
    )
    p.drawText(label, { x: M, y: M - 18, size: 8, font: regular, color: MUTED })
  })
  return pdf.save()
}
