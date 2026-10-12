// The formatting comments as a document, shaped like the program reviewers' emails: numbered parts
// with dash items (each with the pages or text to look at), then what is already in order, the
// closing reminder, and the notices. The Word and PDF writers both render this.
import { CHECKLIST } from '../engine/checklist'
import { stripControls } from '../engine/controls'
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
  /** How pages are counted, when printed page numbers are given too. */
  pagesNote?: string
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

const pagesIn = (details: string[]) =>
  new Set(details.flatMap((d) => [...d.matchAll(/\bpp?\.\s*(\d+)/gi)].map((m) => Number(m[1]))))

/** The places shown for a finding, on the results page and in the comments: the first five with a
 *  page or a quote, leaving out pages its details already name ("p. 7: …"), so no list is given
 *  twice; a place's quote stays when the detail naming its page quotes nothing. */
export function placesOf(f: Pick<Finding, 'where' | 'details'>): Where[] {
  const named = pagesIn(f.details ?? [])
  const quoted = pagesIn((f.details ?? []).filter((d) => d.includes('“')))
  return (f.where ?? [])
    .filter((w) => w.page !== undefined || w.quote)
    .filter(
      (w) => w.page === undefined || !named.has(w.page + 1) || (w.quote && !quoted.has(w.page + 1)),
    )
    .slice(0, 5)
}

/** The number printed on a PDF page when it is not the page's own count and no other page prints
 *  it ("i" on every preliminary page points to no one page): "48" on p. 60. */
export function printedOf(page: number, labels?: Report['pageLabels']) {
  const label = labels?.[page]
  return label &&
    label !== String(page + 1) &&
    labels!.indexOf(label) === labels!.lastIndexOf(label)
    ? label
    : undefined
}

/** A detail's leading page ("p. 14: …") with its printed number too, unless the detail gives it
 *  ("p. 8: shows vii; it should be viii"). */
export const detailText = (detail: string, labels?: Report['pageLabels']) =>
  detail.replace(/^p\.\s(\d+)(?=[:,])/, (lead, n: string) => {
    const printed = printedOf(Number(n) - 1, labels)
    // Not when the detail shows it already: "shows vii", or a footer quoted "“… Acceptance i”".
    const shown = detail.includes(`shows ${printed}`) || detail.includes(` ${printed}”`)
    return printed && !shown ? `${lead} (printed ${printed})` : lead
  })

export const PAGES_NOTE =
  'Pages (p.) are counted from the first page of the PDF, as a PDF viewer counts them; “printed” is the number shown on the page itself.'

/** Whether a report's printed page numbers differ from its page count anywhere. */
export const hasPrinted = (r: Report) =>
  !!r.pageLabels?.some((_, page) => printedOf(page, r.pageLabels))

/** Places as text, as the results page shows them: “p. 7 “…”; p. 9 · printed ii”. */
export const whereText = (where: Where[], labels?: Report['pageLabels']) =>
  where
    .map((w, k) => {
      const printed = w.page !== undefined ? printedOf(w.page, labels) : undefined
      // Places on the page just named go by their quotes alone.
      const page =
        w.page !== undefined && !samePage(where, k)
          ? `p. ${w.page + 1}${printed ? ` · printed ${printed}` : ''}`
          : ''
      return [page, w.quote ? `“${w.quote}”` : ''].filter(Boolean).join(' ')
    })
    .join('; ')

/** Whether a place has a quote and the same page as the place before it. */
export const samePage = (where: Where[], k: number) =>
  k > 0 && !!where[k].quote && where[k].page !== undefined && where[k].page === where[k - 1].page

export function reportModel(r: Report, today = new Date()): ReportModel {
  const date = today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const byId = new Map<string, Finding>(r.findings.map((f) => [f.id, f]))
  const core = CHECKLIST.filter((p) => !p.extra).flatMap((p) => p.items.map((i) => byId.get(i.id)!))
  const n = (s: Finding['status']) => core.filter((f) => f.status === s).length
  const applicable = core.length - n('na')
  const extra = CHECKLIST.filter((p) => p.extra)
    .flatMap((p) => p.items)
    .filter((i) => byId.get(i.id)?.status === 'fix').length

  const parts: ReportModel['parts'] = []
  for (const part of CHECKLIST) {
    const items = part.items
      .map((i) => ({ i, f: byId.get(i.id)! }))
      .filter(({ f }) => f.status === 'fix' || f.status === 'review')
      .map(({ i, f }) => {
        const where = whereText(placesOf(f), r.pageLabels)
        return {
          // "Check:" before a message that already says "Check …" would only repeat it.
          check: f.status === 'review' && !/^check\b/i.test(f.message),
          text: f.message,
          // The pages a message calls "linked here", as the results page links them.
          details: [
            ...(f.details ?? []).map((d) => detailText(d, r.pageLabels)),
            ...(i.links ?? []).map((l) => `${l.label}: ${l.href}`),
          ],
          // The engine writes "p. N" with a no-break space; places are written with a plain one.
          where: f.message.replace(/ /g, ' ').includes(where) ? '' : where,
        }
      })
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
    meta: `${KIND[r.kind]}${r.pages ? ` · ${r.pages} pages` : ''} · checked ${date} against the UPOU format checklist`,
    summary: `${n('fix')} to correct · ${n('review')} to review · ${n('ok')} of ${applicable} checks passed${extra ? ` · ${extra} more to correct outside the checklist` : ''}`,
    intro: parts.length
      ? 'Please revise the manuscript to reflect the following:'
      : 'No corrections were found. Please still look over the manuscript before sending it, since an automated check can miss things.',
    pagesNote: parts.length && hasPrinted(r) ? PAGES_NOTE : undefined,
    parts,
    passed,
    closing: [
      'Please make sure to update the Table of Contents accordingly.',
      ...(parts.some((p) => p.items.some((i) => i.check))
        ? [
            'Items marked “Check:” could not be confirmed from the file; please look at them yourself.',
          ]
        : []),
      ...r.notes,
    ],
    notices: [
      VERIFY,
      `${NOTICE} ${PRIVATE_SHORT} This report was generated on the same device by UPOU Format Check.`,
    ],
  }
}

/** "thesis.docx" → "thesis – formatting comments.ext", short enough for any file system (255 bytes). */
export function reportName(fileName: string, ext: string) {
  // The manuscript's own name, minus what could mislead in a saved file's name: control and
  // text-direction characters, and path separators.
  // "thesis.docx.pdf" (a Word file saved as PDF) loses both extensions.
  const known = /(\.(pdf|docx?|docm|dotx|odt|ott|rtf))+$/i
  const bare = known.test(fileName) ? fileName.replace(known, '') : fileName.replace(/\.[^.]+$/, '')
  let stem = stripControls(bare, '').replace(/[\\/\u202a-\u202e\u2066-\u2069]/g, '')
  while (new TextEncoder().encode(stem).length > 200) stem = [...stem].slice(0, -1).join('')
  return `${stem.trim() || 'manuscript'} – formatting comments.${ext}`
}
