// OpenDocument Text (.odt: LibreOffice, and Google Docs' "OpenDocument" download) into the
// manuscript model. fflate opens the package; the browser's XML parser reads content.xml and
// styles.xml. Pages come from master pages: a paragraph whose style names a master starts a new
// page in that master, with that master's footers and page layout (and so its number format).
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
import { attr, kid, kids, parseXml } from './xml.ts'

const MAX_PART = 64 * 2 ** 20

interface PProps {
  align?: Align
  lineHeight?: string
  atLeast?: string
  left?: number
  indent?: number
  breakBefore?: boolean
  keepNext?: boolean
  pageNumber?: number
}
interface TProps {
  bold?: boolean
  italic?: boolean
  caps?: boolean
  font?: string
  size?: string
  color?: string
  hidden?: boolean
}
interface Style {
  display?: string
  parent?: string
  master?: string
  p: PProps
  t: TProps
}

/** Points from an ODF length: 1in, 2.54cm, 10mm, 12pt, 1pc, 96px. */
export function toPt(v: string | undefined): number | undefined {
  const m = /^(-?[\d.]+)\s*(in|cm|mm|pt|pc|px)?$/.exec(v?.trim() ?? '')
  if (!m) return undefined
  const n = parseFloat(m[1])
  return n * ({ in: 72, cm: 72 / 2.54, mm: 72 / 25.4, pt: 1, pc: 12, px: 0.75 }[m[2] ?? 'pt'] ?? 1)
}

const ALIGN: Record<string, Align> = {
  start: 'left',
  left: 'left',
  end: 'right',
  right: 'right',
  center: 'center',
  justify: 'justify',
}
const FORMATS: Record<string, NumberFormat> = {
  '1': 'decimal',
  i: 'lowerRoman',
  I: 'upperRoman',
  a: 'lowerLetter',
  A: 'upperLetter',
}

function readP(el: Element | undefined): PProps {
  const p: PProps = {}
  if (!el) return p
  const align = attr(el, 'text-align')
  if (align) p.align = ALIGN[align] ?? 'left'
  const lh = attr(el, 'line-height')
  if (lh) p.lineHeight = lh
  const atLeast = attr(el, 'line-height-at-least')
  if (atLeast) p.atLeast = atLeast
  const left = toPt(attr(el, 'margin-left'))
  if (left !== undefined) p.left = left
  const indent = toPt(attr(el, 'text-indent'))
  if (indent !== undefined) p.indent = indent
  const brk = attr(el, 'break-before')
  if (brk) p.breakBefore = brk === 'page'
  const keep = attr(el, 'keep-with-next')
  if (keep) p.keepNext = keep === 'always'
  const pn = attr(el, 'page-number')
  if (pn && /^\d+$/.test(pn)) p.pageNumber = +pn
  return p
}

export function readOdt(data: Uint8Array): Doc {
  let parts: Record<string, Uint8Array>
  try {
    parts = unzipSync(data, { filter: (f) => /\.xml$/i.test(f.name) && f.originalSize <= MAX_PART })
  } catch {
    throw new Error('This file could not be opened as an OpenDocument file.')
  }
  const content = parts['content.xml'] ? parseXml(strFromU8(parts['content.xml'])) : undefined
  if (!content) throw new Error('This is not an OpenDocument text file (no content inside).')
  const stylesDoc = parts['styles.xml'] ? parseXml(strFromU8(parts['styles.xml'])) : undefined

  // Font faces: style names to family names.
  const faces = new Map<string, string>()
  for (const d of [stylesDoc, content])
    for (const f of d
      ? Array.from(d.getElementsByTagName('*')).filter((e) => e.localName === 'font-face')
      : [])
      faces.set(attr(f, 'name') ?? '', (attr(f, 'font-family') ?? '').replace(/^['"]|['"]$/g, ''))

  const readT = (el: Element | undefined): TProps => {
    const t: TProps = {}
    if (!el) return t
    const w = attr(el, 'font-weight')
    if (w) t.bold = w === 'bold' || (/^\d+$/.test(w) && +w >= 600)
    const st = attr(el, 'font-style')
    if (st) t.italic = st === 'italic' || st === 'oblique'
    const tt = attr(el, 'text-transform')
    if (tt) t.caps = tt === 'uppercase'
    const name = attr(el, 'font-name')
    const fam = name
      ? faces.get(name) || name
      : attr(el, 'font-family')?.replace(/^['"]|['"]$/g, '')
    if (fam) t.font = fam
    const size = attr(el, 'font-size')
    if (size) t.size = size
    const color = attr(el, 'color')
    if (color) t.color = /^#000000$/i.test(color) ? '' : color.replace('#', '').toLowerCase()
    if (attr(el, 'display') === 'none') t.hidden = true
    return t
  }

  // Styles by family and name: defaults, common styles, then each part's automatic styles.
  const styles = new Map<string, Style>()
  const defaults = new Map<string, Style>()
  const load = (root: Element | undefined) => {
    for (const s of kids(root)) {
      const family = attr(s, 'family') ?? ''
      const style: Style = {
        display: attr(s, 'display-name') ?? attr(s, 'name'),
        parent: attr(s, 'parent-style-name'),
        master: attr(s, 'master-page-name'),
        p: readP(kid(s, 'paragraph-properties')),
        t: readT(kid(s, 'text-properties')),
      }
      if (s.localName === 'default-style') defaults.set(family, style)
      else if (s.localName === 'style') styles.set(`${family}:${attr(s, 'name')}`, style)
    }
  }
  const part = (d: Document | undefined, name: string) =>
    d ? Array.from(d.documentElement.children).find((e) => e.localName === name) : undefined
  load(part(stylesDoc, 'styles'))
  load(part(stylesDoc, 'automatic-styles'))
  load(part(content, 'automatic-styles'))

  const resolved = new Map<string, Style>()
  const style = (family: string, name: string | undefined, depth = 0): Style => {
    const key = `${family}:${name}`
    const done = resolved.get(key)
    if (done) return done
    const own = name ? styles.get(key) : undefined
    const base: Style =
      own?.parent && depth < 20
        ? style(family, own.parent, depth + 1)
        : (defaults.get(family) ?? { p: {}, t: {} })
    const s: Style = own
      ? {
          display: own.display,
          master: own.master,
          p: { ...base.p, ...own.p },
          t: { ...base.t, ...own.t },
        }
      : base
    resolved.set(key, s)
    return s
  }

  const sizeOf = (t: TProps, inherited: number) => {
    if (!t.size) return inherited
    if (t.size.endsWith('%')) return (inherited * parseFloat(t.size)) / 100
    return toPt(t.size) ?? inherited
  }

  const paras: Para[] = []
  const pictures: Picture[] = []
  const pageStarts: { para: number; master?: string; restart?: number }[] = []
  let tables = 0

  const media = (href: string | undefined) => {
    if (!href || /^[a-z]+:/i.test(href)) return undefined
    const path = href.replace(/^\.\//, '')
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

  const readParagraph = (p: Element, ctx: { table?: number; inBox?: boolean; list?: boolean }) => {
    const st = style('paragraph', attr(p, 'style-name'))
    const baseSize = sizeOf(st.t, 12)
    const para: Para = { i: paras.length, text: '', runs: [] }
    paras.push(para)
    const boxes: Element[] = []

    const emit = (text: string, t: TProps, link: boolean) => {
      if (!text || t.hidden) return
      const run: Run = { text }
      if (t.bold) run.bold = true
      if (t.italic) run.italic = true
      if (t.caps) run.caps = true
      if (t.font) run.font = t.font
      run.size = sizeOf(t, baseSize)
      if (t.color) run.color = t.color
      if (link) run.link = true
      const last = para.runs.at(-1)
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

    const walk = (el: Element, t: TProps, link: boolean) => {
      for (const node of el.childNodes) {
        if (node.nodeType === 3) {
          emit((node.nodeValue ?? '').replace(/\s+/g, ' '), t, link)
          continue
        }
        if (node.nodeType !== 1) continue
        const c = node as Element
        switch (c.localName) {
          case 'span':
            walk(c, { ...t, ...style('text', attr(c, 'style-name')).t }, link)
            break
          case 'a':
            walk(c, t, true)
            break
          case 's':
            emit(' '.repeat(Math.min(200, +(attr(c, 'c') ?? 1) || 1)), t, link)
            break
          case 'tab':
            emit('\t', t, link)
            break
          case 'line-break':
            emit('\n', t, link)
            break
          case 'soft-page-break':
            para.renderedBreak ??= visible() ? 'inside' : 'before'
            break
          case 'page-number':
            emit('{PAGE}', t, link)
            break
          case 'frame': {
            const img = kid(c, 'image')
            const box = kid(c, 'text-box')
            if (img || kid(c, 'object') || kid(c, 'object-ole')) {
              para.image = true
              pictures.push({
                para: para.i,
                width: toPt(attr(c, 'width')),
                height: toPt(attr(c, 'height')),
                bytes: media(attr(img, 'href')),
              })
            }
            if (box) {
              ;(para.shapes ??= []).push({ x: toPt(attr(c, 'x')), text: box.textContent ?? '' })
              boxes.push(box)
            }
            break
          }
          // Drawn shapes (a tick box) keep their text apart, with where they stand.
          case 'custom-shape':
          case 'rect':
          case 'ellipse':
          case 'polygon':
          case 'path':
          case 'g':
            ;(para.shapes ??= []).push({ x: toPt(attr(c, 'x')), text: c.textContent ?? '' })
            break
          case 'note':
          case 'annotation':
          case 'annotation-end':
          case 'bookmark':
          case 'bookmark-start':
          case 'bookmark-end':
          case 'reference-mark':
          case 'reference-mark-start':
          case 'reference-mark-end':
          case 'change':
          case 'change-start':
          case 'change-end':
            break
          default:
            walk(c, t, link)
        }
      }
    }
    walk(p, st.t, false)

    para.text = para.runs
      .map((r) => r.text)
      .join('')
      .replace(/^ +/, '')
    if (para.runs[0]) para.runs[0].text = para.runs[0].text.replace(/^ +/, '')
    if (st.p.align) para.align = st.p.align
    const lh = st.p.lineHeight
    if (lh?.endsWith('%')) para.spacing = parseFloat(lh) / 100
    else if (lh && toPt(lh)) para.spacing = toPt(lh)! / (1.15 * baseSize)
    else if (st.p.atLeast && toPt(st.p.atLeast))
      para.spacing = Math.max(1, toPt(st.p.atLeast)! / (1.15 * baseSize))
    else para.spacing = 1
    if (st.p.left !== undefined || st.p.indent !== undefined)
      para.indent = { left: st.p.left ?? 0, firstLine: st.p.indent ?? 0 }
    if (st.display) para.style = st.display.replace(/_20_/g, ' ')
    if (p.localName === 'h') para.style ??= `Heading ${attr(p, 'outline-level') ?? 1}`
    if (st.p.keepNext) para.keepNext = true
    if (ctx.list) para.list = true
    if (ctx.table !== undefined) {
      para.inTable = true
      para.table = ctx.table
    }
    if (ctx.inBox) para.inBox = true
    // Only automatic styles set on the paragraph itself name a master page.
    const own = styles.get(`paragraph:${attr(p, 'style-name')}`)
    if (!ctx.inBox && ctx.table === undefined && (own?.master || st.p.breakBefore)) {
      para.newPage = true
      if (own?.master)
        pageStarts.push({ para: para.i, master: own.master, restart: st.p.pageNumber })
    }
    for (const box of boxes) block(box, { ...ctx, inBox: true })
  }

  // The writer's last pagination: a soft page break between paragraphs marks the next one.
  let softBreak = false
  const ownTable = (e: Element) => {
    let p = e.parentElement
    while (p && p.localName !== 'table') p = p.parentElement
    return p
  }
  const block = (el: Element, ctx: { table?: number; inBox?: boolean; list?: boolean }) => {
    for (const c of el.children) {
      switch (c.localName) {
        case 'p':
        case 'h':
          readParagraph(c, ctx)
          if (softBreak) paras.at(-1)!.renderedBreak = 'before'
          softBreak = false
          break
        case 'soft-page-break':
          softBreak = true
          break
        case 'list':
        case 'list-item':
        case 'list-header':
          block(c, { ...ctx, list: true })
          break
        case 'table': {
          const t = tables++
          const cells = Array.from(c.getElementsByTagName('*')).filter(
            (e) => e.localName === 'table-cell' && ownTable(e) === c,
          )
          for (const cell of cells) block(cell, { ...ctx, table: t })
          break
        }
        case 'section':
        case 'index-body':
        case 'table-of-content':
        case 'alphabetical-index':
        case 'illustration-index':
        case 'table-index':
          block(c, ctx)
          break
      }
    }
  }
  const body = Array.from(content.getElementsByTagName('*')).find(
    (e) => e.localName === 'text' && e.parentElement?.localName === 'body',
  )
  if (!body) throw new Error('This OpenDocument file has no text body.')
  block(body, {})
  if (!paras.length) paras.push({ i: 0, text: '', runs: [] })
  paras[0].newPage = true

  // Master pages: footers (first, default, even) and the number format of their page layout.
  const masters = new Map<string, Element>()
  const layouts = new Map<string, Element>()
  for (const e of stylesDoc ? Array.from(stylesDoc.getElementsByTagName('*')) : []) {
    if (e.localName === 'master-page') masters.set(attr(e, 'name') ?? '', e)
    if (e.localName === 'page-layout') layouts.set(attr(e, 'name') ?? '', e)
  }
  const firstMaster = masters.has('Standard') ? 'Standard' : [...masters.keys()][0]
  const footerOf = (el: Element | undefined): HeaderFooter | undefined => {
    if (!el) return undefined
    let text = ''
    let format: NumberFormat | undefined
    const walk = (n: Element) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) text += (c.nodeValue ?? '').replace(/\s+/g, ' ')
        else if (c.nodeType === 1) {
          const e = c as Element
          if (e.localName === 'page-number') {
            text += '{PAGE}'
            const f = attr(e, 'num-format')
            if (f && FORMATS[f]) format = FORMATS[f]
          } else if (e.localName === 's') text += ' '
          else if (e.localName === 'tab') text += '\t'
          else if (e.localName === 'p' || e.localName === 'h') {
            if (text && !text.endsWith('\n')) text += '\n'
            walk(e)
          } else walk(e)
        }
      }
    }
    walk(el)
    return format ? { text: text.trim(), format } : { text: text.trim() }
  }
  const sectionFor = (master: string | undefined) => {
    const m = masters.get(master ?? firstMaster ?? '')
    const layout = layouts.get(attr(m, 'page-layout-name') ?? '')
    const fmt = attr(kid(layout, 'page-layout-properties'), 'num-format') ?? '1'
    const next = attr(m, 'next-style-name')
    const nextMaster = next && next !== master ? masters.get(next) : undefined
    const first = kid(m, 'footer-first')
    return {
      format: FORMATS[fmt] ?? 'decimal',
      titlePage: !!first || !!nextMaster,
      footer: {
        default: footerOf(nextMaster ? kid(nextMaster, 'footer') : kid(m, 'footer')),
        first: first ? footerOf(first) : nextMaster ? footerOf(kid(m, 'footer')) : undefined,
        even: footerOf(kid(m, 'footer-left')),
      },
    }
  }
  if (!pageStarts.length || pageStarts[0].para !== 0) pageStarts.unshift({ para: 0 })
  const sections: Section[] = pageStarts.map((ps, k) => {
    const last = (pageStarts[k + 1]?.para ?? paras.length) - 1
    const sec: Section = { first: ps.para, last, newPage: true, ...sectionFor(ps.master) }
    if (ps.restart !== undefined) sec.start = ps.restart
    for (let i = ps.para; i <= last; i++) paras[i].section = k
    return sec
  })

  return { kind: 'odt', paras, sections, pictures, notes: [] }
}
