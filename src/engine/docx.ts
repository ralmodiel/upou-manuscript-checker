// Word (.docx, .docm, .dotx; also what Google Docs, WPS and LibreOffice save as Word) into the
// manuscript model. fflate opens the package; the browser's XML parser reads its parts. Formatting
// is resolved the way Word does: document defaults, then the paragraph style chain, the character
// style chain and the direct formatting.
import { strFromU8, unzipSync } from 'fflate'
import type {
  Align,
  Doc,
  HeaderFooter,
  NumberFormat,
  Para,
  Picture,
  Run,
  Section,
} from './model.ts'
import { all, attr, kid, kids, num, parseXml, toggle } from './xml.ts'

// Largest part read (uncompressed): far above any real document.xml, far below a zip bomb.
const MAX_PART = 64 * 2 ** 20

interface PPr {
  align?: Align
  line?: number
  lineRule?: string
  left?: number
  firstLine?: number
  keepNext?: boolean
  pageBreakBefore?: boolean
  numbered?: boolean
}
interface RPr {
  bold?: boolean
  italic?: boolean
  caps?: boolean
  font?: string
  size?: number
  color?: string
  hidden?: boolean
}
interface Style {
  name?: string
  basedOn?: string
  p: PPr
  r: RPr
}

const ALIGN: Record<string, Align> = {
  both: 'justify',
  distribute: 'justify',
  thaiDistribute: 'justify',
  lowKashida: 'justify',
  mediumKashida: 'justify',
  highKashida: 'justify',
  center: 'center',
  right: 'right',
  end: 'right',
  left: 'left',
  start: 'left',
}

const FORMATS: Record<string, NumberFormat> = {
  decimal: 'decimal',
  lowerRoman: 'lowerRoman',
  upperRoman: 'upperRoman',
  lowerLetter: 'lowerLetter',
  upperLetter: 'upperLetter',
}

// Tick and cross glyphs of the symbol fonts, for permission boxes ticked with Insert > Symbol.
const SYMBOLS: Record<string, string> = {
  FC: '✓',
  FB: '✗',
  FD: '☒',
  FE: '☑',
  A8: '☐',
  '6F': '☐',
  '71': '☐',
  '50': '✓',
  '51': '✗',
  '52': '☑',
  '53': '☒',
  '54': '☒',
  A3: '☐',
}

const hex = (v: string) => v.replace(/^F0/i, '').toUpperCase()

/** '' for black or automatic; otherwise 'rrggbb'. */
function colorOf(el: Element): string {
  const v = (attr(el, 'val') ?? '').toLowerCase()
  if (!/^[0-9a-f]{6}$/.test(v)) {
    const theme = attr(el, 'themeColor') ?? ''
    return /^(text1|dark1|tx1)$/i.test(theme) || !theme ? '' : theme
  }
  return v === '000000' ? '' : v
}

function readPPr(el: Element | undefined): PPr {
  const p: PPr = {}
  if (!el) return p
  const jc = attr(kid(el, 'jc'), 'val')
  if (jc) p.align = ALIGN[jc] ?? 'left'
  const sp = kid(el, 'spacing')
  const line = num(attr(sp, 'line'))
  if (line !== undefined) {
    p.line = line
    p.lineRule = attr(sp, 'lineRule') ?? 'auto'
  }
  const ind = kid(el, 'ind')
  if (ind) {
    const left = num(attr(ind, 'left') ?? attr(ind, 'start'))
    if (left !== undefined) p.left = left / 20
    const hanging = num(attr(ind, 'hanging'))
    const first = num(attr(ind, 'firstLine'))
    if (hanging !== undefined) p.firstLine = -hanging / 20
    else if (first !== undefined) p.firstLine = first / 20
  }
  const keepNext = toggle(kid(el, 'keepNext'))
  if (keepNext !== undefined) p.keepNext = keepNext
  const pageBreakBefore = toggle(kid(el, 'pageBreakBefore'))
  if (pageBreakBefore !== undefined) p.pageBreakBefore = pageBreakBefore
  const numPr = kid(el, 'numPr')
  if (numPr) p.numbered = (attr(kid(numPr, 'numId'), 'val') ?? '0') !== '0'
  return p
}

export function readDocx(data: Uint8Array): Doc {
  let parts: Record<string, Uint8Array>
  try {
    parts = unzipSync(data, {
      filter: (f) => /\.(xml|rels)$/i.test(f.name) && f.originalSize <= MAX_PART,
    })
  } catch {
    throw new Error('This file could not be opened as a Word document.')
  }
  const xml = (path: string) => {
    const bytes = parts[path]
    return bytes ? parseXml(strFromU8(bytes)) : undefined
  }

  // The main part, as the package's relationships name it.
  const pkgRels = relsOf(xml('_rels/.rels'), '')
  const mainPath =
    [...pkgRels.values()].find((r) => r.type.endsWith('/officeDocument'))?.target ??
    'word/document.xml'
  const main = xml(mainPath)
  if (!main) throw new Error('This file is not a Word document (no document part inside).')
  const dir = mainPath.slice(0, mainPath.lastIndexOf('/') + 1)
  const rels = relsOf(xml(`${dir}_rels/${mainPath.slice(dir.length)}.rels`), dir)

  const theme = themeFonts(xml(targetOf(rels, '/theme') ?? `${dir}theme/theme1.xml`))
  const fontOf = (rPr: Element) => {
    const f = kid(rPr, 'rFonts')
    if (!f) return undefined
    const direct = attr(f, 'ascii') ?? attr(f, 'hAnsi')
    if (direct) return direct
    const t = attr(f, 'asciiTheme') ?? attr(f, 'hAnsiTheme') ?? ''
    return t.startsWith('major') ? theme.major : t.startsWith('minor') ? theme.minor : undefined
  }
  const readRPr = (el: Element | undefined): RPr => {
    const r: RPr = {}
    if (!el) return r
    const set = <K extends keyof RPr>(k: K, v: RPr[K] | undefined) => {
      if (v !== undefined) r[k] = v
    }
    set('bold', toggle(kid(el, 'b')))
    set('italic', toggle(kid(el, 'i')))
    set('caps', toggle(kid(el, 'caps')))
    set('hidden', toggle(kid(el, 'vanish')))
    set('font', fontOf(el))
    const sz = num(attr(kid(el, 'sz'), 'val'))
    if (sz !== undefined) r.size = sz / 2
    const color = kid(el, 'color')
    if (color) r.color = colorOf(color)
    return r
  }

  // Styles: own properties, resolved along basedOn on first use.
  const stylesDoc = xml(targetOf(rels, '/styles') ?? `${dir}styles.xml`)
  const raw = new Map<string, Style>()
  let defaultPara: string | undefined
  let defaults: Style = { p: {}, r: {} }
  if (stylesDoc) {
    const dd = all(stylesDoc, 'docDefaults')[0]
    defaults = {
      p: readPPr(kid(kid(dd, 'pPrDefault'), 'pPr')),
      r: readRPr(kid(kid(dd, 'rPrDefault'), 'rPr')),
    }
    for (const s of all(stylesDoc, 'style')) {
      const id = attr(s, 'styleId')
      if (!id) continue
      raw.set(id, {
        name: attr(kid(s, 'name'), 'val'),
        basedOn: attr(kid(s, 'basedOn'), 'val'),
        p: readPPr(kid(s, 'pPr')),
        r: readRPr(kid(s, 'rPr')),
      })
      if (attr(s, 'type') === 'paragraph' && /^(1|true|on)$/.test(attr(s, 'default') ?? ''))
        defaultPara = id
    }
  }
  const resolved = new Map<string, Style>()
  const style = (id: string | undefined, depth = 0): Style | undefined => {
    if (!id) return undefined
    const done = resolved.get(id)
    if (done) return done
    const own = raw.get(id)
    if (!own || depth > 20) return undefined
    const base = style(own.basedOn, depth + 1)
    const s = { name: own.name, p: { ...base?.p, ...own.p }, r: { ...base?.r, ...own.r } }
    resolved.set(id, s)
    return s
  }

  const settings = xml(targetOf(rels, '/settings') ?? `${dir}settings.xml`)
  const evenOdd = !!settings && !!toggle(all(settings, 'evenAndOddHeaders')[0])

  const media = (rid: string | undefined) => {
    const rel = rid ? rels.get(rid) : undefined
    if (!rel || rel.external) return undefined
    const path = rel.target
    return () => {
      try {
        return unzipSync(data, { filter: (f) => f.name === path && f.originalSize <= MAX_PART })[
          path
        ]
      } catch {
        return undefined
      }
    }
  }

  const paras: Para[] = []
  const pictures: Picture[] = []
  const sectionEnds: { para: number; sectPr: Element | undefined }[] = []
  // Open fields, across runs and paragraphs (a table of contents is one field over many).
  const fields: { instr: string; result: boolean; page: boolean }[] = []
  let pendingNewPage = true
  let tables = 0

  const readParagraph = (p: Element, table: number | undefined, inBox: boolean) => {
    const pPr = kid(p, 'pPr')
    const st = style(attr(kid(pPr, 'pStyle'), 'val') ?? defaultPara)
    const pp: PPr = { ...defaults.p, ...st?.p, ...readPPr(pPr) }
    const baseR: RPr = { ...defaults.r, ...st?.r }
    const para: Para = { i: paras.length, text: '', runs: [] }
    paras.push(para)
    const boxes: Element[] = []
    let breakAfter = false
    let textAfterBreak = false

    // Text shows unless it is a field's code or the cached number of a PAGE field.
    const emit = (text: string, r: RPr, link: boolean) => {
      if (!text || r.hidden || fields.some((f) => !f.result || f.page)) return
      append(text, r, link)
    }
    const append = (text: string, r: RPr, link: boolean) => {
      if (breakAfter && text.trim()) textAfterBreak = true
      const last = para.runs.at(-1)
      const run: Run = { text }
      if (r.bold) run.bold = true
      if (r.italic) run.italic = true
      if (r.caps) run.caps = true
      if (r.font) run.font = r.font
      if (r.size) run.size = r.size
      if (r.color) run.color = r.color
      if (link) run.link = true
      if (
        last &&
        last.bold === run.bold &&
        last.italic === run.italic &&
        last.caps === run.caps &&
        last.font === run.font &&
        last.size === run.size &&
        last.color === run.color &&
        last.link === run.link
      )
        last.text += text
      else para.runs.push(run)
    }
    const visible = () => para.runs.some((r) => r.text.trim())

    const field = (type: string | undefined, r: RPr, link: boolean) => {
      if (type === 'begin') {
        fields.push({ instr: '', result: false, page: false })
        return
      }
      const f = fields.at(-1)
      if (!f) return
      const isPage = /^\s*PAGE\b/i.test(f.instr)
      if (type === 'separate') {
        f.result = true
        f.page = isPage
        if (isPage) append('{PAGE}', r, link)
      } else if (type === 'end') {
        fields.pop()
        if (isPage && !f.result) append('{PAGE}', r, link)
      }
    }

    const drawing = (d: Element) => {
      const anchor = kid(d, 'inline') ?? kid(d, 'anchor')
      const ext = kid(anchor, 'extent')
      const width = (num(attr(ext, 'cx')) ?? 0) / 12700 || undefined
      const height = (num(attr(ext, 'cy')) ?? 0) / 12700 || undefined
      const offset = num(kid(kid(anchor, 'positionH'), 'posOffset')?.textContent ?? undefined)
      const blips = all(d, 'blip')
      const isPicture =
        blips.length > 0 || all(d, 'chart').length > 0 || all(d, 'relIds').length > 0
      if (isPicture) {
        para.image = true
        pictures.push({ para: para.i, width, height, bytes: media(attr(blips[0], 'embed')) })
      }
      const box = all(d, 'txbxContent')
      if (box.length || !isPicture) {
        ;(para.shapes ??= []).push({
          x: offset === undefined ? undefined : offset / 12700,
          text: box.map((b) => b.textContent ?? '').join(' '),
        })
        boxes.push(...box)
      }
    }
    const vml = (el: Element) => {
      const img = all(el, 'imagedata')[0]
      if (img) {
        para.image = true
        pictures.push({ para: para.i, bytes: media(attr(img, 'id')) })
      }
      const box = all(el, 'txbxContent')
      if (box.length) {
        ;(para.shapes ??= []).push({ text: box.map((b) => b.textContent ?? '').join(' ') })
        boxes.push(...box)
      }
    }

    const runContent = (c: Element, r: RPr, link: boolean) => {
      switch (c.localName) {
        case 't':
          emit(c.textContent ?? '', r, link)
          break
        case 'tab':
        case 'ptab':
          emit('\t', r, link)
          break
        case 'br':
          if (attr(c, 'type') === 'page') {
            if (!visible()) para.newPage = true
            else breakAfter = true
          } else emit('\n', r, link)
          break
        case 'cr':
          emit('\n', r, link)
          break
        case 'noBreakHyphen':
          emit('-', r, link)
          break
        case 'sym':
          emit(SYMBOLS[hex(attr(c, 'char') ?? '')] ?? '•', r, link)
          break
        case 'lastRenderedPageBreak':
          para.renderedBreak ??= visible() ? 'inside' : 'before'
          break
        case 'fldChar':
          field(attr(c, 'fldCharType'), r, link)
          break
        case 'instrText': {
          const f = fields.at(-1)
          if (f && !f.result) f.instr += c.textContent ?? ''
          break
        }
        case 'drawing':
          drawing(c)
          break
        case 'pict':
        case 'object':
          vml(c)
          break
        case 'AlternateContent': {
          const choice = kid(c, 'Choice') ?? kid(c, 'Fallback')
          for (const x of kids(choice)) runContent(x, r, link)
          break
        }
      }
    }

    const inline = (el: Element, link: boolean) => {
      for (const c of el.children) {
        switch (c.localName) {
          case 'r': {
            const rPr = kid(c, 'rPr')
            const cs = style(attr(kid(rPr, 'rStyle'), 'val'))
            const r: RPr = { ...baseR, ...cs?.r, ...readRPr(rPr) }
            const isLink = link || /hyperlink/i.test(cs?.name ?? '')
            for (const x of c.children) runContent(x, r, isLink)
            break
          }
          case 'hyperlink':
            inline(c, true)
            break
          case 'fldSimple': {
            const instr = attr(c, 'instr') ?? ''
            if (/^\s*PAGE\b/i.test(instr)) emit('{PAGE}', baseR, link)
            else inline(c, link || /HYPERLINK/i.test(instr))
            break
          }
          case 'sdt':
            inline(kid(c, 'sdtContent') ?? c, link)
            break
          case 'ins':
          case 'moveTo':
          case 'smartTag':
          case 'customXml':
          case 'sdtContent':
          case 'dir':
          case 'bdo':
            inline(c, link)
            break
          case 'AlternateContent':
            inline(kid(c, 'Choice') ?? kid(c, 'Fallback') ?? c, link)
            break
          case 'oMath':
          case 'oMathPara':
            emit(
              all(c, 't')
                .map((t) => t.textContent ?? '')
                .join(''),
              baseR,
              link,
            )
            break
        }
      }
    }

    if (pendingNewPage || pp.pageBreakBefore) para.newPage = true
    pendingNewPage = false
    inline(p, false)
    if (breakAfter && !textAfterBreak) pendingNewPage = true

    para.text = para.runs.map((r) => r.text).join('')
    if (pp.align) para.align = pp.align
    if (pp.line !== undefined) {
      const size = dominantSize(para.runs) ?? baseR.size ?? 10
      para.spacing = pp.lineRule === 'auto' ? pp.line / 240 : pp.line / 20 / size
    } else para.spacing = 1
    if (pp.left !== undefined || pp.firstLine !== undefined)
      para.indent = { left: pp.left ?? 0, firstLine: pp.firstLine ?? 0 }
    if (st?.name) para.style = st.name
    if (pp.keepNext) para.keepNext = true
    if (pp.numbered) para.list = true
    if (table !== undefined) {
      para.inTable = true
      para.table = table
    }
    if (inBox) para.inBox = true

    const sectPr = kid(pPr, 'sectPr')
    if (sectPr && !inBox && table === undefined) sectionEnds.push({ para: para.i, sectPr })
    for (const box of boxes) for (const bp of kids(box, 'p')) readParagraph(bp, table, true)
  }

  const block = (el: Element, table: number | undefined) => {
    for (const c of el.children) {
      switch (c.localName) {
        case 'p':
          readParagraph(c, table, false)
          break
        case 'tbl': {
          const t = tables++
          for (const tr of kids(c, 'tr')) for (const tc of kids(tr, 'tc')) block(tc, t)
          break
        }
        case 'sdt':
          block(kid(c, 'sdtContent') ?? c, table)
          break
        case 'customXml':
        case 'ins':
        case 'moveTo':
          block(c, table)
          break
        case 'AlternateContent':
          block(kid(c, 'Choice') ?? kid(c, 'Fallback') ?? c, table)
          break
      }
    }
  }

  const body = all(main, 'body')[0]
  if (!body) throw new Error('This Word document has no body.')
  block(body, undefined)
  sectionEnds.push({ para: paras.length - 1, sectPr: kid(body, 'sectPr') })

  // Sections: each inherits the footers it does not define from the one before.
  const footerCache = new Map<string, HeaderFooter>()
  const footer = (rid: string | undefined) => {
    const target = rid ? rels.get(rid)?.target : undefined
    if (!target) return undefined
    let hf = footerCache.get(target)
    if (!hf) {
      hf = readHeaderFooter(xml(target))
      footerCache.set(target, hf)
    }
    return hf
  }
  const sections: Section[] = []
  let first = 0
  let inherited: Section['footer'] = {}
  for (const { para: last, sectPr } of sectionEnds) {
    if (last < first) continue
    const own: Section['footer'] = {}
    for (const ref of kids(sectPr, 'footerReference')) {
      const type = attr(ref, 'type') ?? 'default'
      if (type === 'default' || type === 'first' || type === 'even')
        own[type] = footer(attr(ref, 'id'))
    }
    inherited = { ...inherited, ...own }
    const pg = kid(sectPr, 'pgNumType')
    const type = attr(kid(sectPr, 'type'), 'val') ?? 'nextPage'
    const sec: Section = {
      first,
      last,
      format: FORMATS[attr(pg, 'fmt') ?? 'decimal'] ?? 'decimal',
      titlePage: !!toggle(kid(sectPr, 'titlePg')),
      footer: inherited,
      newPage: sections.length === 0 || !/^(continuous|nextColumn)$/.test(type),
    }
    const start = num(attr(pg, 'start'))
    if (start !== undefined) sec.start = start
    if (sec.newPage) paras[first].newPage = true
    for (let k = first; k <= last; k++) paras[k].section = sections.length
    sections.push(sec)
    first = last + 1
  }

  return { kind: 'docx', paras, sections, evenOdd, pictures, notes: [] }
}

/** Text of a header or footer, with `{PAGE}` where the page number goes. */
function readHeaderFooter(doc: Document | undefined): HeaderFooter {
  if (!doc) return { text: '' }
  // Read with the body machinery's rules in miniature: field codes hidden, PAGE as a token.
  let text = ''
  let format: NumberFormat | undefined
  const stack: { instr: string; result: boolean }[] = []
  const hidden = () => stack.some((f) => !f.result || /^\s*PAGE\b/i.test(f.instr))
  const page = (instr: string) => {
    text += '{PAGE}'
    const sw = /\\\*\s*(\w+)/.exec(instr)?.[1]
    if (sw === 'roman') format = 'lowerRoman'
    else if (sw && /^roman$/i.test(sw)) format = 'upperRoman'
  }
  const walk = (el: Element) => {
    for (const c of el.children) {
      const name = c.localName
      if (name === 't') {
        if (!hidden()) text += c.textContent ?? ''
      } else if (name === 'tab' || name === 'ptab') {
        if (!hidden()) text += '\t'
      } else if (name === 'fldChar') {
        const type = attr(c, 'fldCharType')
        if (type === 'begin') stack.push({ instr: '', result: false })
        else if (type === 'separate' && stack.length) {
          const f = stack[stack.length - 1]
          if (/^\s*PAGE\b/i.test(f.instr)) page(f.instr)
          f.result = true
        } else if (type === 'end') {
          const f = stack.pop()
          if (f && !f.result && /^\s*PAGE\b/i.test(f.instr)) page(f.instr)
        }
      } else if (name === 'instrText') {
        const f = stack[stack.length - 1]
        if (f && !f.result) f.instr += c.textContent ?? ''
      } else if (name === 'fldSimple') {
        const instr = attr(c, 'instr') ?? ''
        if (/^\s*PAGE\b/i.test(instr)) page(instr)
        else walk(c)
      } else if (name === 'p') {
        if (text && !text.endsWith('\n')) text += '\n'
        walk(c)
      } else if (name === 'del' || name === 'moveFrom' || name === 'Fallback') {
        // Deleted text and the duplicate fallback of a drawing are not shown.
      } else walk(c)
    }
  }
  walk(doc.documentElement)
  return format ? { text: text.trim(), format } : { text: text.trim() }
}

interface Rel {
  type: string
  target: string
  external: boolean
}

function relsOf(doc: Document | undefined, dir: string): Map<string, Rel> {
  const map = new Map<string, Rel>()
  if (!doc) return map
  for (const r of all(doc, 'Relationship')) {
    const id = attr(r, 'Id')
    const target = attr(r, 'Target')
    if (!id || !target) continue
    const external = attr(r, 'TargetMode') === 'External'
    map.set(id, {
      type: attr(r, 'Type') ?? '',
      target: external ? target : resolvePath(dir, target),
      external,
    })
  }
  return map
}

function resolvePath(dir: string, target: string) {
  const parts = (target.startsWith('/') ? target.slice(1) : dir + target).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p && p !== '.') out.push(p)
  }
  return out.join('/')
}

const targetOf = (rels: Map<string, Rel>, typeEnd: string) =>
  [...rels.values()].find((r) => r.type.endsWith(typeEnd))?.target

function themeFonts(doc: Document | undefined) {
  const face = (name: string) => {
    const el = doc ? all(doc, name)[0] : undefined
    return attr(kid(el, 'latin'), 'typeface') || undefined
  }
  return { major: face('majorFont'), minor: face('minorFont') }
}

function dominantSize(runs: Run[]) {
  const by = new Map<number, number>()
  for (const r of runs) if (r.size) by.set(r.size, (by.get(r.size) ?? 0) + r.text.length)
  let best: number | undefined
  let most = 0
  for (const [size, n] of by)
    if (n > most) {
      best = size
      most = n
    }
  return best
}
