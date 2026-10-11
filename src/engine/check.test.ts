// The engine end to end on a small Word file made here (the fixture set stays local), plus the
// guards around it: files it cannot read are turned away with a reason, and the comments it writes
// stay valid whatever the file name holds.
import { strFromU8, strToU8, unzipSync, zipSync, zlibSync } from 'fflate'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { reportDocx } from '../report/docx.ts'
import { reportModel } from '../report/model.ts'
import { check, FileProblem, sniff } from './check.ts'
import { ITEMS } from './checklist.ts'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'
const para = (text: string, pPr = '') =>
  `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

function docx(...paras: string[]): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}" Target="word/document.xml"/></Relationships>`,
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${paras.join('')}<w:sectPr/></w:body></w:document>`,
    ),
  })
}

const thesis = (...body: string[]) =>
  docx(
    para('A STUDY OF COMMUNITY RADIO', '<w:jc w:val="center"/>'),
    para('CHAPTER I', '<w:pageBreakBefore/><w:jc w:val="center"/>'),
    para('INTRODUCTION', '<w:jc w:val="center"/>'),
    ...body,
  )
const opts = { pdfjs: () => Promise.reject(new Error('no PDFs here')) }
const finding = (r: Awaited<ReturnType<typeof check>>, id: string) =>
  r.findings.find((f) => f.id === id)!

describe('check', () => {
  it('answers every checklist item once, in order, with no rule failing', async () => {
    const r = await check('thesis.docx', thesis(para('Body text.')), opts)
    expect(r.kind).toBe('docx')
    expect(r.findings.map((f) => f.id)).toEqual(ITEMS.map((i) => i.id))
    expect(r.findings.filter((f) => f.message.includes('could not run'))).toEqual([])
    expect(finding(r, 'extra.placeholders').status).toBe('ok')
  })

  it('reports template text left in', async () => {
    const r = await check('thesis.docx', thesis(para('Xxxxxxxxxxxxxxxx xxxxxxx.')), opts)
    expect(finding(r, 'extra.placeholders').status).toBe('fix')
  })

  it('reads a chapter title put under its label with a line break', async () => {
    const r = await check(
      'thesis.docx',
      docx(
        para('A STUDY OF COMMUNITY RADIO', '<w:jc w:val="center"/>'),
        '<w:p><w:pPr><w:pageBreakBefore/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Chapter I</w:t><w:br/><w:t>INTRODUCTION</w:t></w:r></w:p>',
        '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Background of the Study</w:t></w:r></w:p>',
        para('Body text.'),
      ),
      opts,
    )
    expect(finding(r, 'chapterStart.title').status).toBe('ok')
  })

  it('does not pass a figure number it cannot place above its figure', async () => {
    const r = await check(
      'thesis.docx',
      thesis(
        '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Figure 1.</w:t></w:r></w:p>',
        '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Sources of Information</w:t></w:r></w:p>',
        para('Body text.'),
      ),
      opts,
    )
    expect(finding(r, 'figures.number').status).toBe('review')
  })

  it('reads undated references and orders one author’s works by year', async () => {
    const double = '<w:spacing w:line="480" w:lineRule="auto"/>'
    const r = await check(
      'thesis.docx',
      thesis(
        para('REFERENCES', '<w:jc w:val="center"/>'),
        para('Community Radio Network. (n.d.). An undated page.', double),
        para('Smith, J. (2020). A later work.', double),
        para('Smith, J. (2018). An earlier work.', double),
      ),
      opts,
    )
    expect(finding(r, 'references.order').details?.join(' ')).toMatch(/earliest year/)
    // Three entries, the undated one included; what is not read is for a second look.
    expect(finding(r, 'references.apa').status).toBe('review')
    expect(finding(r, 'references.apa').message).toMatch(/the 3 references/)
  })

  it('finds a reference listed twice, one author’s works of a year out of order, a personal communication', async () => {
    const double = '<w:spacing w:line="480" w:lineRule="auto"/>'
    const r = await check(
      'thesis.docx',
      thesis(
        para('REFERENCES', '<w:jc w:val="center"/>'),
        para('Cruz, A. (2019). The second title. Press.', double),
        para('Cruz, A. (2019). A first title. Press.', double),
        para('Lim, B. (2020). One work. Press.', double),
        para('Lim, B. (2020). One work. Press.', double),
        para('Reyes, C. (2021, May 3). Personal communication.', double),
      ),
      opts,
    )
    expect(finding(r, 'references.order').details?.join(' ')).toMatch(/go by title/)
    const apa = finding(r, 'references.apa')
    expect(apa.status).toBe('fix')
    expect(apa.details?.join(' ')).toMatch(/Listed twice.*add a, b.*personal communications/)
  })

  it('stays fast on long runs of spaces and tabs', async () => {
    // These once made two patterns backtrack for minutes, freezing the page.
    const t0 = performance.now()
    await check(
      'thesis.docx',
      thesis(para(`a${' '.repeat(20000)}b`), para(`Name${'\t'.repeat(20000)}`), para('Dean')),
      opts,
    )
    expect(performance.now() - t0).toBeLessThan(2000)
  })

  it('turns away files it cannot read, saying why', async () => {
    expect(() => sniff('notes.txt', strToU8('hello'))).toThrow(FileProblem)
    expect(() => sniff('thesis.gdoc', strToU8('{"url":""}'))).toThrow(/link to Google Docs/)
    expect(() => sniff('a.zip', zipSync({ 'a.txt': strToU8('a') }))).toThrow(/not a Word/)
    await expect(check('empty.docx', new Uint8Array(), opts)).rejects.toThrow('empty')
  })
})

describe('PDF reader', () => {
  // Four pages of body text with a small running title above the page number, set higher than
  // the bottom inch, and a ruled table on the last page.
  async function pdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const text =
      'Body text of the chapter, set in twelve point type, with its words across the page.'
    for (let n = 0; n < 4; n++) {
      const page = doc.addPage([612, 792])
      for (let y = 720; y > 200; y -= 27.6)
        if (n < 3 || y < 540 || y > 620) page.drawText(text, { x: 72, y, size: 12, font })
      page.drawText('A Running Title Set Above The Page Number', { x: 72, y: 84, size: 8, font })
      page.drawText(String(n + 1), { x: 530, y: 51, size: 11, font })
    }
    const last = doc.getPage(3)
    for (const y of [610, 550])
      last.drawLine({ start: { x: 72, y }, end: { x: 540, y }, thickness: 0.75 })
    last.drawText('Cell one', { x: 80, y: 575, size: 12, font })
    last.drawText('Cell two', { x: 320, y: 575, size: 12, font })
    return doc.save()
  }

  it('reads a running title above the bottom inch as the footer, and a ruled table as one', async () => {
    const { readPdf } = await import('./pdf.ts')
    const doc = await readPdf(await pdf(), await import('pdfjs-dist/legacy/build/pdf.mjs'))
    expect(doc.pages!.map((p) => p.footer)).toEqual(
      [1, 2, 3, 4].map((n) => `A Running Title Set Above The Page Number\n${n}`),
    )
    expect(doc.paras.filter((p) => /Running Title/.test(p.text))).toEqual([])
    expect(doc.paras.filter((p) => p.inTable).map((p) => p.text)).toEqual(['Cell one\tCell two'])
  })

  it('reports a picture in a chapter with no caption beside it', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const picture = await doc.embedPng(png(40, 30))
    const text =
      'Body text of the chapter, set in twelve point type, with its words across the page.'
    for (let n = 0; n < 2; n++) {
      const page = doc.addPage([612, 792])
      if (n === 0) {
        page.drawText('Chapter I', { x: 280, y: 720, size: 12, font: bold })
        page.drawText('INTRODUCTION', { x: 262, y: 692, size: 12, font: bold })
      }
      for (let y = n ? 720 : 650; y > 400; y -= 27.6)
        page.drawText(text, { x: 72, y, size: 12, font })
      if (n === 1) page.drawImage(picture, { x: 200, y: 150, width: 200, height: 150 })
    }
    const r = await check('thesis.pdf', await doc.save(), {
      pdfjs: () => import('pdfjs-dist/legacy/build/pdf.mjs'),
    })
    expect(finding(r, 'figures.number').status).toBe('fix')
    expect(finding(r, 'figures.number').details).toEqual(['a picture on p. 2'])
  })
})

/** A small grey PNG. */
function png(w: number, h: number): Uint8Array {
  const crc = (b: Uint8Array) => {
    let c = -1
    for (const x of b) {
      c ^= x
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set(strToU8(type), 4)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
    return out
  }
  const head = new Uint8Array(13)
  new DataView(head.buffer).setUint32(0, w)
  new DataView(head.buffer).setUint32(4, h)
  head[8] = 8 // 8-bit grey
  const rows = new Uint8Array(h * (w + 1)).fill(128)
  for (let y = 0; y < h; y++) rows[y * (w + 1)] = 0 // each row: filter "none"
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', zlibSync(rows)),
    chunk('IEND', new Uint8Array()),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0)
  return out
}

describe('Word comments', () => {
  it('stay valid XML whatever the file name holds', async () => {
    const name = 'Thesis <final> & "v2"\u0001\u0008.docx'
    const r = await check(name, thesis(para('Body text.')), opts)
    const xml = strFromU8(unzipSync(reportDocx(reportModel(r)))['word/document.xml'])
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    expect(doc.documentElement.textContent).toContain('Thesis <final> & "v2".docx')
  })
})
