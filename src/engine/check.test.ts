// The engine end to end on a small Word file made here (the fixture set stays local), plus the
// guards around it: files it cannot read are turned away with a reason, and the comments it writes
// stay valid whatever the file name holds.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
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

  it('turns away files it cannot read, saying why', async () => {
    expect(() => sniff('notes.txt', strToU8('hello'))).toThrow(FileProblem)
    expect(() => sniff('thesis.gdoc', strToU8('{"url":""}'))).toThrow(/link to Google Docs/)
    expect(() => sniff('a.zip', zipSync({ 'a.txt': strToU8('a') }))).toThrow(/not a Word/)
    await expect(check('empty.docx', new Uint8Array(), opts)).rejects.toThrow('empty')
  })
})

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
