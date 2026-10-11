// The comments files: valid whatever the manuscript or its name holds, PDF lines that stay inside
// the page, the same places the results page shows, and file names any file system takes.
import { strFromU8, unzipSync } from 'fflate'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { reportDocx } from './docx'
import { detailText, placesOf, reportName, whereText, type ReportModel } from './model'
import { lines, reportPdf } from './pdf'

// macOS spells "ñ" as "n" plus a combining tilde; U+0001 and U+FFFF are not allowed in XML.
const tilde = String.fromCharCode(0x303)
const odd = `Pen${tilde}a 中文 📚 ${String.fromCharCode(1, 0xffff)} ${'x_'.repeat(150)}`
const model = (text: string): ReportModel => ({
  title: 'Formatting comments',
  file: text,
  meta: text,
  summary: text,
  intro: text,
  parts: [
    { n: 1, name: 'Title Page', items: [{ check: true, text, details: [text], where: text }] },
  ],
  passed: [{ name: 'Acceptance Page', items: [text] }],
  closing: [text],
  notices: [text, text],
})

describe('comments files', () => {
  it('stay valid whatever the text holds', async () => {
    const xml = strFromU8(unzipSync(reportDocx(model(odd)))['word/document.xml'])
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    expect((await reportPdf(model(odd))).length).toBeGreaterThan(1000)
  })

  it('keep PDF lines inside the page, accents included', async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica)
    const ls = lines(`Pen${tilde}a ${'x_'.repeat(150)}`, font, 10, 300)
    expect(ls[0]).toBe('Peña')
    expect(ls.length).toBeGreaterThan(3)
    for (const l of ls) expect(font.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(300)
  })

  it('list the five places the results page shows', () => {
    const where = [{}, ...[1, 2, 3, 4, 5, 6].map((page) => ({ page }))]
    expect(whereText(placesOf({ where }))).toBe('p. 2; p. 3; p. 4; p. 5; p. 6')
    // Pages the details already name are not listed again.
    expect(whereText(placesOf({ where, details: ['p. 2: one line…', 'Chapter I (P. 4)'] }))).toBe(
      'p. 3; p. 5; p. 6; p. 7',
    )
  })

  it('give the number printed on a page beside its count', () => {
    const labels = [undefined, 'ii', '3', '1', 'v', 'v']
    expect(whereText([{ page: 0 }, { page: 1 }, { page: 2 }, { page: 3 }], labels)).toBe(
      'p. 1; p. 2 · printed ii; p. 3; p. 4 · printed 1',
    )
    expect(detailText('p. 4: one line…', labels)).toBe('p. 4 (printed 1): one line…')
    expect(detailText('p. 3, References: …', labels)).toBe('p. 3, References: …')
    expect(detailText('A long title on pp. 4–9', labels)).toBe('A long title on pp. 4–9')
    // Not where the detail says it, nor where other pages print the same number.
    expect(detailText('p. 2: shows ii; it should be iii', labels)).toBe(
      'p. 2: shows ii; it should be iii',
    )
    expect(detailText('p. 5: shows v; it should be iv', labels)).toBe(
      'p. 5: shows v; it should be iv',
    )
  })

  it('keep a place whose quote the details leave out', () => {
    const where = [{ page: 54, quote: 'The variables for…' }, { page: 60 }]
    expect(whereText(placesOf({ where, details: ['1 of 217 is not justified (p. 55).'] }))).toBe(
      'p. 55 “The variables for…”; p. 61',
    )
  })

  it('get file names any file system takes', () => {
    expect(reportName('thesis.docx', 'pdf')).toBe('thesis – formatting comments.pdf')
    expect(reportName('.docx', 'docx')).toBe('manuscript – formatting comments.docx')
    expect(reportName('thesis.docx.pdf', 'docx')).toBe('thesis – formatting comments.docx')
    const long = reportName(`${'论文'.repeat(42)}.docx`, 'docx')
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(255)
    // A right-to-left override could make "…cod.exe" read as "…exe.doc"; separators make paths.
    const rlo = String.fromCharCode(0x202e)
    expect(reportName(`a${rlo}b/c\\d${String.fromCharCode(1)}.pdf`, 'docx')).toBe(
      'abcd – formatting comments.docx',
    )
  })
})
