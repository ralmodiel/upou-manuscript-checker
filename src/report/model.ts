// The formatting comments as a document, shaped like MDC Program Support's emails: numbered parts
// with dash items (each with the pages or text to look at), then what is already in order, the
// closing reminder, and the notices. The Word and PDF writers both render this.
import { CHECKLIST } from '../engine/checklist'
import type { Finding, Report, Where } from '../engine/report'
import { NOTICE, PRIVATE_SHORT, VERIFY } from '../notice'

export interface ReportItem {
  check: boolean
  text: string
  details: string[]
  where: string
}
export interface ReportModel {
  title: string
  file: string
  meta: string
  summary: string
  intro: string
  parts: { n: number; name: string; items: ReportItem[] }[]
  passed: { name: string; items: string[] }[]
  closing: string[]
  notices: string[]
}

const KIND: Record<Report['kind'], string> = {
  docx: 'Word document',
  doc: 'Word 97-2003 document',
  pdf: 'PDF',
  odt: 'OpenDocument text',
  rtf: 'Rich Text document',
}

export const whereText = (where: Where[] | undefined) =>
  (where ?? [])
    .slice(0, 4)
    .map((w) =>
      [w.page !== undefined ? `p. ${w.page + 1}` : '', w.quote ? `“${w.quote}”` : '']
        .filter(Boolean)
        .join(' '),
    )
    .filter(Boolean)
    .join('; ')

export function reportModel(r: Report, today = new Date()): ReportModel {
  const date = today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const byId = new Map<string, Finding>(r.findings.map((f) => [f.id, f]))
  const core = CHECKLIST.filter((p) => !p.extra).flatMap((p) => p.items.map((i) => byId.get(i.id)!))
  const n = (s: Finding['status']) => core.filter((f) => f.status === s).length
  const applicable = core.length - n('na')

  const parts: ReportModel['parts'] = []
  for (const part of CHECKLIST) {
    const items = part.items
      .map((i) => byId.get(i.id)!)
      .filter((f) => f.status === 'fix' || f.status === 'review')
      .map((f) => ({
        check: f.status === 'review',
        text: f.message,
        details: f.details ?? [],
        where: whereText(f.where),
      }))
    if (items.length) parts.push({ n: parts.length + 1, name: part.name, items })
  }
  const passed = CHECKLIST.filter((p) => !p.extra)
    .map((p) => ({
      name: p.name,
      items: p.items.filter((i) => byId.get(i.id)?.status === 'ok').map((i) => i.text),
    }))
    .filter((p) => p.items.length)

  return {
    title: 'Formatting comments',
    file: r.fileName,
    meta: `${KIND[r.kind]}${r.pages ? ` · ${r.pages} pages` : ''} · checked ${date} against the MDC Format Checklist`,
    summary: `${n('fix')} to correct · ${n('review')} to review · ${n('ok')} of ${applicable} checks passed`,
    intro: parts.length
      ? 'Please revise the manuscript to reflect the following:'
      : 'No corrections were found. Please still look over the manuscript before sending it, since an automated check can miss things.',
    parts,
    passed,
    closing: [
      'Please make sure to update the Table of Contents accordingly.',
      'Items marked “Check:” could not be confirmed from the file; please look at them yourself.',
      ...r.notes,
    ],
    notices: [
      VERIFY,
      `${NOTICE} ${PRIVATE_SHORT} This report was generated on the same computer by MDC Format Check.`,
    ],
  }
}

/** "thesis.docx" → "thesis – formatting comments.ext" */
export const reportName = (fileName: string, ext: string) =>
  `${fileName.replace(/\.[^.]+$/, '')} – formatting comments.${ext}`
