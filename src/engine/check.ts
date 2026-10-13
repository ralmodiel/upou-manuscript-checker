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
import { garbled } from './text.ts'
import { prelimRules } from './rules/prelims.ts'
import { FileProblem } from './problem.ts'
import { findStructure } from './structure.ts'
import { guard, scanPage } from './guard.ts'

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

/** Items that read the page's geometry or footers, not its words: kept when the text is unreadable. */
const GEOMETRY =
  /^(title\.signature|title\.pageNumber|chapterStart\.(noPageNumber|newPage|spacing)|body\.hanging|[a-z]+\.spacing)$/
const STOP =
  /^(the|of|and|to|in|is|for|that|with|as|on|by|are|this|be|or|was|were|an|it|from|which)$/i

/** Why most of a PDF's words cannot be trusted: a font that re-encodes its letters on many pages
 *  (shifted letters, hardly a common word), or most pages being pictures. */
function unreadWhy(doc: Doc): 'garbled' | 'scanned' | undefined {
  if (doc.kind !== 'pdf' || !doc.pages) return undefined
  let text = 0
  let bad = 0
  let scans = 0
  for (const pg of doc.pages) {
    const t = pg.paras.map((i) => doc.paras[i].text).join(' ')
    const ws = t.split(/\s+/).filter(Boolean)
    if (scanPage(doc, pg)) scans++
    if (ws.length < 30) continue
    text++
    // ponytail: needs 30 words a page and under 6% common words; a page of code or a table of codes can look so.
    if (garbled(t) && ws.filter((w) => STOP.test(w)).length < 0.06 * ws.length) bad++
  }
  if (text >= 5 && bad >= 0.35 * text) return 'garbled'
  if (scans >= 0.6 * doc.pages.length) return 'scanned'
  return undefined
}

const PART = /^(title|permission|acceptance)\./
// Reviews that put an unread chapter down to the author's labelling.
const CHAPTERLESS = /^No chapter label|^Chapter I was not found/

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
  // (a PDF with hardly any text overall may still have front pages read through a text layer:
  // those are checked, the rest is for review)
  const why = doc.unreadable ? 'scanned' : unreadWhy(doc)
  const s = findStructure(doc)
  const ctx: Ctx = { doc, s, env: opts.env ?? {} }
  let captions: ReturnType<typeof findCaptions> = []
  try {
    captions = findCaptions(ctx)
  } catch (e) {
    console.error(e)
  }
  // (one misreading may make many findings: those the pages contradict go to review)
  const found = guard(ctx, [
    ...(await safely(idsOf('title', 'permission', 'acceptance'), () => frontRules(ctx))),
    ...(await safely(idsOf('prelims'), () => prelimRules(ctx, captions))),
    ...(await safely(idsOf('chapterStart', 'body'), () => chapterRules(ctx, captions))),
    ...(await safely(idsOf('figures'), () => figureRules(ctx, captions))),
    ...(await safely(idsOf('references', 'appendices'), () => backRules(ctx))),
    ...(await safely(idsOf('extra'), () => extraRules(ctx))),
  ])
  const byId = new Map(found.map((f) => [f.id, f]))
  let title: string | undefined
  try {
    title = titleOf(readTitlePage(ctx)) || undefined
  } catch {
    title = undefined
  }
  // Most of the words cannot be trusted (re-encoded font, or pages that are pictures): what these
  // items "found missing or different" is the reader's failing, not the student's.
  if (why && !doc.unreadable)
    doc.notes.push(
      why === 'garbled'
        ? 'The letters in this PDF are stored in a re-encoded font, so its words could not be read reliably. Items that depend on the words are for you to check; a PDF saved from Word or Google Docs reads better.'
        : 'Most pages of this PDF are pictures (scanned), so their words could not be read. Items that depend on those pages are for you to check.',
    )
  const SCANNED =
    'Most pages of this PDF are scanned pictures, so this item could not be judged. Check it yourself.'
  // A front page read through its text layer (not a bare picture) is judged as any other.
  const readPage = (id: string) => {
    const r = id.startsWith('title.')
      ? s.title
      : id.startsWith('permission.')
        ? s.permission
        : id.startsWith('acceptance.')
          ? s.acceptance
          : undefined
    const pg = r && doc.pages?.[doc.paras[r.start]?.page ?? -1]
    return !!pg && pg.paras.length > 0 && !scanPage(doc, pg)
  }
  const anyText = doc.paras.some((p) => /\p{L}{2}/u.test(p.text))
  const part = (id: string) =>
    id.startsWith('title.')
      ? 'Title Page'
      : id.startsWith('permission.')
        ? 'University Permission Page'
        : 'Acceptance Page'
  const unread = (f: Finding): Finding => {
    if (why !== 'scanned') return unreadFix(f)
    // (nothing found on scanned pages is no sign there is nothing: figures, appendices, prelims)
    if (!PART.test(f.id) && (doc.unreadable || f.status === 'na')) return review(f.id, SCANNED)
    if (PART.test(f.id) && doc.unreadable && !readPage(f.id))
      return review(
        f.id,
        `The ${part(f.id)} could not be found among the pages that could be read (most pages of this PDF are scanned pictures), so this item was not checked. Check it yourself.`,
      )
    // (in a scan read through its text layer, what seems missing may only be misread, and a pass
    // may rest on a line the layer left out)
    if (PART.test(f.id) && doc.unreadable && f.status !== 'review')
      return review(
        f.id,
        `The ${part(f.id)} is a scan read through its machine-read text layer, so its words may be misread or missed. Check this item yourself.`,
        { where: f.where },
      )
    const g = unreadFix(f)
    return g.status === 'review' && CHAPTERLESS.test(g.message ?? '')
      ? review(
          f.id,
          'The chapter pages are scanned pictures whose words could not be read, so this item was not checked. Check it yourself.',
        )
      : g
  }
  const unreadFix = (f: Finding): Finding =>
    why &&
    // (template text left in cannot be searched for in letters that are scrambled: not "ok" either)
    (f.status === 'fix' ||
      (why === 'garbled' && f.status === 'ok' && f.id === 'extra.placeholders')) &&
    !GEOMETRY.test(f.id) &&
    (why === 'garbled' ||
      /^(prelims\.present|chapterStart\.number|figures|references|appendices)/.test(f.id))
      ? review(
          f.id,
          why === 'garbled'
            ? 'The words of this PDF could not be read reliably (its font re-encodes the letters), so this item was not judged. Check it yourself.'
            : 'Most pages of this PDF are scanned pictures, so this item could not be judged. Check it yourself.',
        )
      : f
  return {
    fileName: name,
    kind,
    pages: doc.pages?.length,
    title,
    pageLabels:
      doc.kind === 'pdf' ? doc.pages?.map((pg) => pdfFolio(doc, pg.n)?.number) : undefined,
    findings: ITEMS.map((item) =>
      doc.unreadable && !anyText
        ? review(
            item.id,
            'No text could be read from this PDF (it may be scanned pages), so this item was not checked. Check it yourself, or check the Word file.',
          )
        : unread(
            byId.get(item.id) ??
              review(item.id, 'This check could not run on your file. Check this item yourself.'),
          ),
    ),
    notes: doc.notes,
    ms: Math.round(performance.now() - t0),
  }
}
