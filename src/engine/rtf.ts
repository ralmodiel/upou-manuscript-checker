// Rich Text Format (.rtf: Word, WordPad, Google Docs' "Rich Text" download) into the manuscript
// model. RTF is plain text with control words, read in one pass: groups ({ }) carry character
// state, \pard and \sectd reset paragraph and section properties, destinations such as \footer,
// \fldinst and \shptxt route their text elsewhere.
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
import { FileProblem } from './problem.ts'

interface CharState {
  bold: boolean
  italic: boolean
  caps: boolean
  hidden: boolean
  font: number
  half: number
  color: number
  uc: number
  /** Where text goes: the body, a footer, a field's instruction or result, a shape's text, nowhere. */
  dest:
    | 'body'
    | 'skip'
    | 'fonttbl'
    | 'colortbl'
    | 'footer'
    | 'fldinst'
    | 'fldrslt'
    | 'shptxt'
    | 'pict'
    | 'listtext'
    | 'prop'
  footer?: 'default' | 'first' | 'even'
  link: boolean
}

interface ParaState {
  align?: Align
  sl?: number
  slmult?: boolean
  li?: number
  fi?: number
  pagebb?: boolean
  keepn?: boolean
  intbl?: boolean
}

const SKIP = new Set([
  'info',
  'stylesheet',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'generator',
  'xmlnstbl',
  'themedata',
  'colorschememapping',
  'datastore',
  'latentstyles',
  'fldtype',
  'bkmkstart',
  'bkmkend',
  'footnote',
  'annotation',
  'atnid',
  'atnauthor',
  'atndate',
  'atnref',
  'nonshppict',
  'header',
  'headerf',
  'headerl',
  'headerr',
  'object',
  'objdata',
  'mmathPr',
  'pgdsctbl',
  'revtbl',
  'protusertbl',
  'wgrffmtfilter',
  'docvar',
  'xe',
  'tc',
  'userprops',
  'filetbl',
  'passwordhash',
  'ftnsep',
  'ftnsepc',
  'aftnsep',
  'aftnsepc',
  'pntxta',
  'pntxtb',
  'pnseclvl',
  'background',
  'shprslt',
])
const FORMATS: Record<string, NumberFormat> = {
  pgndec: 'decimal',
  pgnlcrm: 'lowerRoman',
  pgnucrm: 'upperRoman',
  pgnlcltr: 'lowerLetter',
  pgnucltr: 'upperLetter',
}
const SYMBOLS: Record<string, string> = {
  emdash: '—',
  endash: '–',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  bullet: '•',
  emspace: ' ',
  enspace: ' ',
  qmspace: ' ',
}

export function readRtf(data: Uint8Array): Doc {
  // Code page 1252 covers what RTF writers put in \'hh escapes for Western text.
  const src = new TextDecoder('latin1').decode(data)
  if (!src.startsWith('{\\rtf')) throw new FileProblem('This file is not a Rich Text (.rtf) file.')
  const ansi = new TextDecoder('windows-1252')

  const fonts: string[] = []
  const colors: string[] = []
  let fontName = ''
  let rgb = [0, 0, 0]

  const paras: Para[] = []
  const pictures: Picture[] = []
  const sections: Section[] = []
  let para: Para = { i: 0, text: '', runs: [] }
  let pp: ParaState = {}
  let pendingNewPage = true
  let tables = 0
  let inTable = false

  // Section being read, and its footers (a section without its own keeps the one before's).
  let sec: Omit<Section, 'first' | 'last'> = {
    format: 'decimal',
    titlePage: false,
    footer: {},
    newPage: true,
  }
  let secFirst = 0
  let footerText = ''
  let fieldInst = ''
  let shape: { x?: number; text: string } | undefined
  let shapeDepth = 0
  let pageInPara = false
  let pict: { hex: string[]; type?: string; w?: number; h?: number } | undefined

  let st: CharState = {
    bold: false,
    italic: false,
    caps: false,
    hidden: false,
    font: 0,
    half: 24,
    color: 0,
    uc: 1,
    dest: 'body',
    link: false,
  }
  const stack: CharState[] = []
  let skipUnicode = 0

  const runOf = (text: string): Run => {
    const run: Run = { text }
    if (st.bold) run.bold = true
    if (st.italic) run.italic = true
    if (st.caps) run.caps = true
    if (fonts[st.font]) run.font = fonts[st.font]
    run.size = st.half / 2
    if (colors[st.color]) run.color = colors[st.color]
    if (st.link) run.link = true
    return run
  }

  const text = (t: string) => {
    if (!t || st.hidden) return
    switch (st.dest) {
      case 'body':
      case 'listtext':
      case 'fldrslt': {
        if (st.dest === 'fldrslt' && /^\s*PAGE\b/.test(fieldInst)) return
        if (shape) {
          shape.text += t
          return
        }
        const last = para.runs.at(-1)
        const run = runOf(t)
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
          last.text += t
        else para.runs.push(run)
        if (st.dest === 'listtext') para.list = true
        return
      }
      case 'shptxt':
        if (shape) shape.text += t
        return
      case 'footer':
        footerText += t
        return
      case 'fldinst':
        fieldInst += t
        return
      case 'fonttbl':
        fontName += t
        return
    }
  }

  const endPara = () => {
    if (st.dest === 'footer') {
      footerText += '\n'
      return
    }
    if (st.dest === 'shptxt') return
    para.text = para.runs.map((r) => r.text).join('')
    if (pp.align) para.align = pp.align
    const size = para.runs.find((r) => r.text.trim())?.size ?? st.half / 2
    if (pp.sl) para.spacing = pp.slmult ? pp.sl / 240 : Math.abs(pp.sl) / 20 / (1.15 * size)
    else para.spacing = 1
    if (pp.li !== undefined || pp.fi !== undefined)
      para.indent = { left: (pp.li ?? 0) / 20, firstLine: (pp.fi ?? 0) / 20 }
    if (pp.keepn) para.keepNext = true
    // A paragraph holding only a page break hands the new page to the one after it.
    const empty = !para.runs.some((r) => r.text.trim()) && !para.image
    if ((pendingNewPage || pp.pagebb) && !(empty && pageInPara)) {
      para.newPage = true
      pendingNewPage = false
    }
    pageInPara = false
    if (pp.intbl) {
      if (!inTable) tables++
      inTable = true
      para.inTable = true
      para.table = tables - 1
    } else inTable = false
    para.section = sections.length
    paras.push(para)
    para = { i: paras.length, text: '', runs: [] }
  }

  const endSection = () => {
    if (paras.length - 1 >= secFirst)
      sections.push({ ...sec, first: secFirst, last: paras.length - 1 })
    secFirst = paras.length
    sec = { ...sec, footer: { ...sec.footer }, start: undefined, newPage: true }
    pendingNewPage = true
  }

  // Paragraph and section properties count only in the body (a footer or list label repeats them).
  const PARA_WORDS = new Set([
    'pard',
    'ql',
    'qc',
    'qr',
    'qj',
    'qd',
    'sl',
    'slmult',
    'li',
    'fi',
    'pagebb',
    'keepn',
    'intbl',
  ])
  const SECT_WORDS = new Set([
    'sectd',
    'titlepg',
    'pgnrestart',
    'pgnstarts',
    'sbknone',
    ...Object.keys(FORMATS),
  ])
  const word = (w: string, n: number | undefined) => {
    const on = n === undefined || n !== 0
    if ((PARA_WORDS.has(w) || SECT_WORDS.has(w)) && st.dest !== 'body') return
    switch (w) {
      // Destinations
      case 'fonttbl':
        st.dest = 'fonttbl'
        return
      case 'colortbl':
        st.dest = 'colortbl'
        return
      case 'footer':
      case 'footerr':
      case 'footerf':
      case 'footerl':
        st.dest = 'footer'
        st.footer = w === 'footerf' ? 'first' : w === 'footerl' ? 'even' : 'default'
        footerText = ''
        return
      case 'fldinst':
        st.dest = 'fldinst'
        fieldInst = ''
        return
      case 'fldrslt':
        if (st.dest !== 'skip') st.dest = st.dest === 'footer' ? 'footer' : 'fldrslt'
        if (st.dest === 'footer' && /^\s*PAGE\b/.test(fieldInst)) {
          footerText += '{PAGE}'
          st.dest = 'skip'
        } else if (/^\s*PAGE\b/.test(fieldInst) && st.dest === 'fldrslt') text('{PAGE}')
        return
      case 'shp':
        shape = { text: '' }
        shapeDepth = stack.length
        return
      case 'shpleft':
        if (shape && n !== undefined) shape.x = n / 20
        return
      case 'shptxt':
        st.dest = 'shptxt'
        return
      // Shape properties: names and values are not text, but a value may hold the picture.
      case 'sp':
      case 'sn':
      case 'sv':
        st.dest = 'prop'
        return
      case 'pict':
        st.dest = 'pict'
        pict = { hex: [] }
        return
      case 'pngblip':
      case 'jpegblip':
        if (pict) pict.type = w
        return
      case 'picwgoal':
        if (pict && n !== undefined) pict.w = n / 20
        return
      case 'pichgoal':
        if (pict && n !== undefined) pict.h = n / 20
        return
      case 'listtext':
      case 'pntext':
        st.dest = 'listtext'
        return
      // Colour table entries
      case 'red':
        rgb[0] = n ?? 0
        return
      case 'green':
        rgb[1] = n ?? 0
        return
      case 'blue':
        rgb[2] = n ?? 0
        return
      // Characters
      case 'b':
        st.bold = on
        return
      case 'i':
        st.italic = on
        return
      case 'caps':
        st.caps = on
        return
      case 'v':
        st.hidden = on
        return
      case 'f':
        if (st.dest === 'fonttbl') fontName = ''
        st.font = n ?? 0
        return
      case 'fs':
        st.half = n ?? 24
        return
      case 'cf':
        st.color = n ?? 0
        return
      case 'plain':
        Object.assign(st, {
          bold: false,
          italic: false,
          caps: false,
          hidden: false,
          half: 24,
          color: 0,
        })
        return
      case 'uc':
        st.uc = n ?? 1
        return
      case 'u':
        text(String.fromCharCode(n === undefined ? 63 : n < 0 ? n + 65536 : n))
        skipUnicode = st.uc
        return
      case 'tab':
        text('\t')
        return
      case 'line':
        text('\n')
        return
      case 'par':
        endPara()
        return
      case 'cell':
        if (st.dest === 'body') endPara()
        return
      case 'page':
        if (st.dest === 'body') {
          if (para.runs.some((r) => r.text.trim())) endPara()
          pendingNewPage = true
          pageInPara = true
        }
        return
      // Paragraphs
      case 'pard':
        pp = {}
        return
      case 'ql':
        pp.align = 'left'
        return
      case 'qc':
        pp.align = 'center'
        return
      case 'qr':
        pp.align = 'right'
        return
      case 'qj':
      case 'qd':
        pp.align = 'justify'
        return
      case 'sl':
        pp.sl = n
        return
      case 'slmult':
        pp.slmult = on
        return
      case 'li':
        pp.li = n
        return
      case 'fi':
        pp.fi = n
        return
      case 'pagebb':
        pp.pagebb = on
        return
      case 'keepn':
        pp.keepn = on
        return
      case 'intbl':
        pp.intbl = true
        return
      // Sections
      case 'sect':
        if (para.runs.length) endPara()
        endSection()
        return
      case 'sectd':
        sec = { ...sec, format: 'decimal', titlePage: false, start: undefined }
        return
      case 'titlepg':
        sec.titlePage = on
        return
      case 'pgnrestart':
        sec.start ??= 1
        return
      case 'pgnstarts':
        if (n !== undefined) sec.start = n
        return
      case 'sbknone':
        sec.newPage = false
        return
      default:
        if (FORMATS[w]) sec.format = FORMATS[w]
        else if (SYMBOLS[w]) text(SYMBOLS[w])
        else if (SKIP.has(w)) st.dest = 'skip'
    }
  }

  const closeGroup = (was: CharState) => {
    // Leaving a destination: file what it gathered.
    if (was.dest === 'fonttbl' && st.dest === 'fonttbl' && fontName) {
      fonts[was.font] = fontName.replace(/;$/, '').trim()
      fontName = ''
    }
    if (was.dest === 'footer' && st.dest !== 'footer' && was.footer) {
      const hf: HeaderFooter = { text: footerText.replace(/\n+$/, '').trim() }
      sec.footer = { ...sec.footer, [was.footer]: hf }
    }
    if (was.dest === 'pict' && st.dest !== 'pict' && pict) {
      const bytes = pict.type ? hexBytes(pict.hex.join('')) : undefined
      pictures.push({
        para: paras.length,
        width: pict.w,
        height: pict.h,
        bytes: bytes ? () => bytes : undefined,
      })
      para.image = true
      pict = undefined
    }
    // A shape ends with its group; its text (a tick in a box) stays with the paragraph it sits in.
    if (shape && stack.length < shapeDepth) {
      ;(para.shapes ??= []).push(shape)
      shape = undefined
    }
  }

  let k = 0
  const n = src.length
  while (k < n) {
    const c = src[k]
    if (c === '{') {
      stack.push({ ...st })
      k++
      // {\* ...} with an unknown word is skipped whole.
      if (src.startsWith('\\*', k)) {
        const m = /^\\\*\\([a-zA-Z]+)/.exec(src.slice(k, k + 40))
        const known =
          m &&
          [
            'fldinst',
            'shppict',
            'shpinst',
            'listtext',
            'pntext',
            'footer',
            'footerf',
            'footerl',
            'footerr',
            'shptxt',
          ].includes(m[1])
        if (!known) st.dest = 'skip'
        k += 2
      }
      continue
    }
    if (c === '}') {
      const was = st
      st = stack.pop() ?? st
      closeGroup(was)
      k++
      continue
    }
    if (c === '\\') {
      const next = src[k + 1]
      if (/[a-zA-Z]/.test(next ?? '')) {
        let j = k + 1
        while (j < n && /[a-zA-Z]/.test(src[j])) j++
        const w = src.slice(k + 1, j)
        let num: number | undefined
        const m = /^-?\d+/.exec(src.slice(j, j + 12))
        if (m) {
          num = +m[0]
          j += m[0].length
        }
        if (src[j] === ' ') j++
        k = j
        if (st.dest === 'skip') continue
        // Picture data: hex digits up to the group's end, read in one go.
        word(w, num)
        if (st.dest === 'pict') {
          let e = k
          while (e < n && src[e] !== '}' && src[e] !== '\\' && src[e] !== '{') e++
          if (pict?.type) pict.hex.push(src.slice(k, e))
          k = e
        }
        continue
      }
      if (next === "'") {
        const byte = parseInt(src.substr(k + 2, 2), 16)
        k += 4
        if (skipUnicode > 0) {
          skipUnicode--
          continue
        }
        if (st.dest !== 'skip' && !Number.isNaN(byte)) text(ansi.decode(new Uint8Array([byte])))
        continue
      }
      // Control symbols: escaped braces and backslash, no-break space and hyphen.
      k += 2
      if (st.dest === 'skip') continue
      if (next === '\\' || next === '{' || next === '}') text(next)
      else if (next === '~') text('\u00a0')
      else if (next === '_') text('-')
      continue
    }
    if (c === '\r' || c === '\n') {
      k++
      continue
    }
    // Plain text up to the next special character.
    let j = k
    while (
      j < n &&
      src[j] !== '\\' &&
      src[j] !== '{' &&
      src[j] !== '}' &&
      src[j] !== '\r' &&
      src[j] !== '\n'
    )
      j++
    let t = src.slice(k, j)
    k = j
    if (skipUnicode > 0) {
      const drop = Math.min(skipUnicode, t.length)
      t = t.slice(drop)
      skipUnicode -= drop
    }
    if (st.dest === 'colortbl') {
      for (const ch of t)
        if (ch === ';') {
          const hex = rgb.map((v) => v.toString(16).padStart(2, '0')).join('')
          colors.push(hex === '000000' || colors.length === 0 ? '' : hex)
          rgb = [0, 0, 0]
        }
      continue
    }
    if (st.dest === 'pict') {
      if (pict?.type) pict.hex.push(t)
    } else if (st.dest !== 'skip') text(t)
  }
  if (para.runs.some((r) => r.text.trim())) endPara()
  endSection()
  if (!paras.length) throw new FileProblem('This Rich Text file has no text.')
  paras[0].newPage = true
  return { kind: 'rtf', paras, sections, pictures, notes: [] }
}

function hexBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '')
  const out = new Uint8Array(clean.length >> 1)
  for (let k = 0; k < out.length; k++) out[k] = parseInt(clean.substr(k * 2, 2), 16)
  return out
}
