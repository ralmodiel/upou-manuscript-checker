// The engine's entry point: works out what the file is, reads it, finds its parts and runs every
// checklist rule, all inside the browser.
import { unzipSync } from 'fflate'
import { CHECKLIST, ITEMS } from './checklist.ts'
import { readDocx } from './docx.ts'
import type { Doc, Kind } from './model.ts'
import type { PdfJs } from './pdf.ts'
import { review, type Ctx, type Env, type Finding, type Report } from './report.ts'
import { backRules } from './rules/back.ts'
import { chapterRules } from './rules/chapters.ts'
import { extraRules } from './rules/extra.ts'
import { figureRules, findCaptions } from './rules/figures.ts'
import { frontRules, readTitlePage, titleOf } from './rules/front.ts'
import { pdfFolio } from './rules/numbering.ts'
import { prelimRules } from './rules/prelims.ts'
import { FileProblem } from './problem.ts'
import { findStructure } from './structure.ts'

export { FileProblem }

export const MAX_BYTES = 100 * 2 ** 20

export interface Options {
  /** Loads pdf.js (lazily: only PDFs need it). */
  pdfjs: () => Promise<PdfJs>
  env?: Env
  progress?: (step: 'reading' | 'checking', done?: number, total?: number) => void
}

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, k) => b[at + k] === x)

export function sniff(name: string, b: Uint8Array): Kind {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (
    startsWith(b, [0x25, 0x50, 0x44, 0x46]) ||
    new TextDecoder().decode(b.subarray(0, 1024)).includes('%PDF-')
  )
    return 'pdf'
  if (startsWith(b, [0x7b, 0x5c, 0x72, 0x74, 0x66])) return 'rtf'
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    if (ext === 'docx' || ext === 'pdf')
      throw new FileProblem(
        'This file is password-protected. Save a copy without a password and check that.',
      )
    return 'doc'
  }
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) {
    const names: string[] = []
    try {
      unzipSync(b, {
        filter: (f) => {
          names.push(f.name)
          return false
        },
      })
    } catch {
      throw new FileProblem('This file looks damaged: it could not be opened.')
    }
    if (names.some((n) => /^word\/.*\.xml$/.test(n))) return 'docx'
    if (names.includes('content.xml')) return 'odt'
    if (names.some((n) => /^index\.xml|\.pages|^Index\//.test(n)) || ext === 'pages')
      throw new FileProblem(
        'Apple Pages files cannot be read here. In Pages, choose File > Export To > Word (or PDF), then check that file.',
      )
    throw new FileProblem('This is not a Word, PDF, OpenDocument or Rich Text file.')
  }
  if (ext === 'pages')
    throw new FileProblem(
      'Apple Pages files cannot be read here. In Pages, choose File > Export To > Word (or PDF), then check that file.',
    )
  if (ext === 'gdoc')
    throw new FileProblem(
      'A .gdoc file is only a link to Google Docs. Open it in Google Docs, choose File > Download > Microsoft Word (.docx) or PDF, then check that file.',
    )
  throw new FileProblem(
    'This file type is not supported. Check a Word (.docx, .doc), PDF, OpenDocument (.odt) or Rich Text (.rtf) file.',
  )
}

/** Runs one group of rules; if it fails on an odd file, its items say so instead of the whole check failing. */
async function safely(
  ids: string[],
  run: () => Finding[] | Promise<Finding[]>,
): Promise<Finding[]> {
  try {
    return await run()
  } catch (e) {
    console.error(e)
    return ids.map((id) =>
      review(id, 'This check could not run on your file. Check this item yourself.'),
    )
  }
}

const idsOf = (...parts: string[]) =>
  CHECKLIST.filter((p) => parts.includes(p.id)).flatMap((p) => p.items.map((i) => i.id))

export async function check(name: string, bytes: Uint8Array, opts: Options): Promise<Report> {
  const t0 = performance.now()
  if (bytes.length > MAX_BYTES)
    throw new FileProblem(
      'This file is over 100 MB. Check a copy without large pictures, or the PDF version.',
    )
  if (!bytes.length)
    throw new FileProblem('This file is empty. Check that you chose the right file.')
  const kind = sniff(name, bytes)
  opts.progress?.('reading')
  let doc: Doc
  try {
    if (kind === 'docx') doc = readDocx(bytes)
    else if (kind === 'odt') doc = (await import('./odt.ts')).readOdt(bytes)
    else if (kind === 'rtf') doc = (await import('./rtf.ts')).readRtf(bytes)
    else if (kind === 'doc') doc = (await import('./doc.ts')).readDoc(bytes)
    else if (kind === 'pdf') {
      const { readPdf } = await import('./pdf.ts')
      doc = await readPdf(bytes, await opts.pdfjs(), (done, total) =>
        opts.progress?.('reading', done, total),
      )
    } else
      throw new FileProblem(
        'This file type is not supported. Save it as Word (.docx) or PDF, then check that file.',
      )
  } catch (e) {
    // Readers word their own problems for the student; anything else is a file they could not make sense of.
    if (e instanceof FileProblem) throw e
    console.error(e)
    throw new FileProblem(
      'This file could not be read. It may be damaged or in a form this checker does not know. Save it again as Word (.docx) or PDF and check that.',
    )
  }
  opts.progress?.('checking')
  // Let the page show the step before the rules' long run.
  await new Promise((r) => setTimeout(r, 0))
  const s = findStructure(doc)
  const ctx: Ctx = { doc, s, env: opts.env ?? {} }
  let captions: ReturnType<typeof findCaptions> = []
  try {
    captions = findCaptions(ctx)
  } catch (e) {
    console.error(e)
  }
  const found = [
    ...(await safely(idsOf('title', 'permission', 'acceptance'), () => frontRules(ctx))),
    ...(await safely(idsOf('prelims'), () => prelimRules(ctx, captions))),
    ...(await safely(idsOf('chapterStart', 'body'), () => chapterRules(ctx))),
    ...(await safely(idsOf('figures'), () => figureRules(ctx, captions))),
    ...(await safely(idsOf('references', 'appendices'), () => backRules(ctx))),
    ...(await safely(idsOf('extra'), () => extraRules(ctx))),
  ]
  const byId = new Map(found.map((f) => [f.id, f]))
  let title: string | undefined
  try {
    title = titleOf(readTitlePage(ctx)) || undefined
  } catch {
    title = undefined
  }
  return {
    fileName: name,
    kind,
    pages: doc.pages?.length,
    title,
    pageLabels:
      doc.kind === 'pdf' ? doc.pages?.map((pg) => pdfFolio(doc, pg.n)?.number) : undefined,
    findings: ITEMS.map((item) =>
      doc.unreadable
        ? review(
            item.id,
            'No text could be read from this PDF (it may be scanned pages), so this item was not checked. Check it yourself, or check the Word file.',
          )
        : (byId.get(item.id) ??
          review(item.id, 'This check could not run on your file. Check this item yourself.')),
    ),
    notes: doc.notes,
    ms: Math.round(performance.now() - t0),
  }
}
