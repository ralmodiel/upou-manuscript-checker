// The formatting comments as a Word document, written as WordprocessingML and zipped with fflate:
// Arial, numbered part headings, dash items with a hanging indent, as the reviewers' emails read.
import { strToU8, zipSync } from 'fflate'
import { stripControls } from '../engine/controls'
import type { ReportModel } from './model'

// XML 1.0 also forbids U+FFFE and U+FFFF (Word then calls the whole file corrupted).
const esc = (s: string) =>
  stripControls(s)
    .replace(/\p{Noncharacter_Code_Point}/gu, '')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

interface RunOpts {
  bold?: boolean
  italic?: boolean
  size?: number
  color?: string
}
const run = (text: string, o: RunOpts = {}) =>
  `<w:r><w:rPr>${o.bold ? '<w:b/>' : ''}${o.italic ? '<w:i/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}${o.size ? `<w:sz w:val="${o.size * 2}"/><w:szCs w:val="${o.size * 2}"/>` : ''}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`

interface ParaOpts {
  before?: number
  after?: number
  indent?: number
  hanging?: number
  keepNext?: boolean
  shade?: string
}
const para = (runs: string, o: ParaOpts = {}) =>
  `<w:p><w:pPr>${o.keepNext ? '<w:keepNext/>' : ''}${o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>` : ''}<w:spacing w:before="${(o.before ?? 0) * 20}" w:after="${(o.after ?? 6) * 20}" w:line="276" w:lineRule="auto"/>${o.indent || o.hanging ? `<w:ind w:left="${(o.indent ?? 0) * 20}" w:hanging="${(o.hanging ?? 0) * 20}"/>` : ''}</w:pPr>${runs}</w:p>`

export function reportDocx(m: ReportModel): Uint8Array {
  const body: string[] = []
  body.push(para(run(m.title, { bold: true, size: 20, color: '7B1113' }), { after: 4 }))
  body.push(para(run(m.file, { bold: true, size: 12 }), { after: 2 }))
  body.push(para(run(m.meta, { size: 10, color: '5C5A5C' }), { after: 2 }))
  body.push(para(run(m.summary, { size: 10, color: '5C5A5C' }), { after: 10 }))
  body.push(para(run(m.notices[0], { italic: true, size: 9.5 }), { after: 12, shade: 'F4E9E4' }))
  body.push(para(run(m.intro), { after: 10 }))
  for (const part of m.parts) {
    body.push(
      para(run(`${part.n}. ${part.name}`, { bold: true, size: 12 }), {
        before: 8,
        after: 4,
        keepNext: true,
      }),
    )
    for (const item of part.items) {
      const where = item.where ? run(`  (${item.where})`, { size: 9.5, color: '5C5A5C' }) : ''
      body.push(
        para(
          run('- ') + (item.check ? run('Check: ', { bold: true }) : '') + run(item.text) + where,
          { indent: 18, hanging: 12, after: 3 },
        ),
      )
      for (const d of item.details)
        body.push(
          para(run(`› ${d}`, { size: 10, color: '373637' }), { indent: 36, hanging: 10, after: 2 }),
        )
    }
  }
  if (m.passed.length) {
    body.push(
      para(run('Already in order', { bold: true, size: 12, color: '00563F' }), {
        before: 14,
        after: 4,
        keepNext: true,
      }),
    )
    for (const p of m.passed)
      body.push(
        para(
          run(`${p.name}: `, { bold: true, size: 10 }) +
            run(p.items.join(' · ') + '.', { size: 10 }),
          { after: 4 },
        ),
      )
  }
  body.push(para('', { after: 6 }))
  for (const c of m.closing) body.push(para(run(c), { after: 6 }))
  body.push(para(run(m.notices[1], { italic: true, size: 9, color: '5C5A5C' }), { before: 10 }))

  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-PH"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'word/document.xml': document,
    'word/styles.xml': styles,
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(`${m.title}: ${m.file}`)}</dc:title><dc:creator>MDC Format Check</dc:creator></cp:coreProperties>`,
  }
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), {
    level: 6,
  })
}
