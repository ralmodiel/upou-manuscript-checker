// Word 97-2003 (.doc) into the manuscript model. SheetJS's cfb opens the compound file; the text
// comes from the piece table, sections and their page numbering from the section table, and
// footers from the header story. Character and paragraph formatting live in binary property runs
// that are not read here, so paragraphs are marked `plain` and formatting items ask for a .docx or PDF.
import * as CFB from 'cfb'
import { stripControls } from './controls.ts'
import type { Doc, HeaderFooter, NumberFormat, Para, Picture, Section } from './model.ts'

const NFC: Record<number, NumberFormat> = {
  0: 'decimal',
  1: 'upperRoman',
  2: 'lowerRoman',
  3: 'upperLetter',
  4: 'lowerLetter',
}

export function readDoc(data: Uint8Array): Doc {
  let cfb: CFB.CFB$Container
  try {
    cfb = CFB.read(data, { type: 'array' })
  } catch {
    throw new Error('This file could not be opened as a Word 97-2003 (.doc) document.')
  }
  const stream = (name: string) => {
    const e = CFB.find(cfb, name)
    return e?.content ? Uint8Array.from(e.content as ArrayLike<number>) : undefined
  }
  const wd = stream('WordDocument')
  if (!wd) {
    if (CFB.find(cfb, 'EncryptedPackage'))
      throw new Error(
        'This file is password-protected. Save a copy without a password and check that.',
      )
    throw new Error('This is not a Word document.')
  }
  const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength)
  if (dv.getUint16(0, true) !== 0xa5ec) throw new Error('This is not a Word 97-2003 document.')
  const flags = dv.getUint16(0x0a, true)
  if (flags & 0x0100)
    throw new Error(
      'This file is password-protected. Save a copy without a password and check that.',
    )
  const table = stream(flags & 0x0200 ? '1Table' : '0Table')
  if (!table) throw new Error('This Word document is damaged (no table stream).')
  const tv = new DataView(table.buffer, table.byteOffset, table.byteLength)

  const ccpText = dv.getInt32(0x4c, true)
  const ccpFtn = dv.getInt32(0x50, true)
  const ccpHdd = dv.getInt32(0x54, true)
  const fc = (k: number) => dv.getUint32(0x9a + k * 8, true)
  const lcb = (k: number) => dv.getUint32(0x9a + k * 8 + 4, true)

  // Piece table: which bytes hold which characters (8-bit Windows-1252 or UTF-16).
  const pieces: { cp0: number; cp1: number; fc: number; narrow: boolean }[] = []
  let at = fc(33)
  const end = at + lcb(33)
  while (at < end) {
    const clxt = table[at]
    if (clxt === 1) at += 3 + tv.getInt16(at + 1, true)
    else if (clxt === 2) {
      const size = tv.getUint32(at + 1, true)
      const n = (size - 4) / 12
      const base = at + 5
      for (let k = 0; k < n; k++) {
        const raw = tv.getUint32(base + (n + 1) * 4 + k * 8 + 2, true)
        const narrow = (raw & 0x40000000) !== 0
        pieces.push({
          cp0: tv.getUint32(base + k * 4, true),
          cp1: tv.getUint32(base + (k + 1) * 4, true),
          fc: narrow ? (raw & 0x3fffffff) / 2 : raw & 0x3fffffff,
          narrow,
        })
      }
      break
    } else break
  }
  const ansi = new TextDecoder('windows-1252')
  const utf16 = new TextDecoder('utf-16le')
  const text = (cp0: number, cp1: number) => {
    let out = ''
    for (const p of pieces) {
      const a = Math.max(cp0, p.cp0)
      const b = Math.min(cp1, p.cp1)
      if (a >= b) continue
      const from = p.fc + (a - p.cp0) * (p.narrow ? 1 : 2)
      const bytes = wd.subarray(from, from + (b - a) * (p.narrow ? 1 : 2))
      out += p.narrow ? ansi.decode(bytes) : utf16.decode(bytes)
    }
    return out
  }

  /** Visible characters: field codes hidden, a PAGE field as {PAGE}. */
  const visible = (s: string) => {
    let out = ''
    const fields: { code: string; result: boolean }[] = []
    for (const ch of s) {
      const c = ch.charCodeAt(0)
      if (c === 0x13) fields.push({ code: '', result: false })
      else if (c === 0x14) {
        const f = fields.at(-1)
        if (f) {
          f.result = true
          if (/^\s*PAGE\b/.test(f.code)) out += '{PAGE}'
        }
      } else if (c === 0x15) {
        const f = fields.pop()
        if (f && !f.result && /^\s*PAGE\b/.test(f.code)) out += '{PAGE}'
      } else if (fields.some((f) => !f.result)) fields.at(-1)!.code += ch
      else if (fields.some((f) => /^\s*PAGE\b/.test(f.code))) continue
      else out += ch
    }
    return out
  }

  // Paragraphs of the main story.
  const paras: Para[] = []
  const pictures: Picture[] = []
  const main = visible(text(0, ccpText))
  let cur = ''
  let newPage = true
  let image = false
  let cellRun = false
  let tables = 0
  const push = (cell: boolean) => {
    const t = stripControls(cur, '\t\n')
    const para: Para = { i: paras.length, text: t, runs: t ? [{ text: t }] : [], plain: true }
    if (newPage) para.newPage = true
    if (image) {
      para.image = true
      pictures.push({ para: para.i })
    }
    if (cell) {
      if (!cellRun) tables++
      para.inTable = true
      para.table = tables - 1
    }
    cellRun = cell
    paras.push(para)
    cur = ''
    newPage = false
    image = false
  }
  for (const ch of main) {
    const c = ch.charCodeAt(0)
    if (c === 0x0d) push(false)
    else if (c === 0x07) push(true)
    else if (c === 0x0c) {
      if (cur.trim()) push(false)
      newPage = true
    } else if (c === 0x0b) cur += '\n'
    else if (c === 0x01 || c === 0x08) image = true
    else if (c === 0x1e) cur += '-'
    else if (c >= 0x20 || c === 0x09) cur += ch
  }
  if (cur.trim()) push(false)

  // Sections: their extent from the section table, their numbering from each section's properties.
  const plc = table.subarray(fc(6), fc(6) + lcb(6))
  const pv = new DataView(plc.buffer, plc.byteOffset, plc.byteLength)
  const nSed = plc.length >= 16 ? (plc.length - 4) / 16 : 0
  const cps: number[] = []
  for (let k = 0; k <= nSed; k++) cps.push(pv.getUint32(k * 4, true))
  // Character positions to paragraph indices: count paragraph marks before each position.
  const marks: number[] = []
  {
    let i = 0
    for (const ch of text(0, ccpText)) {
      const c = ch.charCodeAt(0)
      if (c === 0x0d || c === 0x07) marks.push(i)
      i++
    }
  }
  const paraAt = (cp: number) => {
    let lo = 0
    while (lo < marks.length && marks[lo] < cp) lo++
    return Math.min(lo, paras.length - 1)
  }

  // Footers per section from the header story: six stories each (even/odd/first headers and footers).
  const hdd = table.subarray(fc(11), fc(11) + lcb(11))
  const hv = new DataView(hdd.buffer, hdd.byteOffset, hdd.byteLength)
  const hcp: number[] = []
  for (let k = 0; k + 4 <= hdd.length; k += 4) hcp.push(hv.getUint32(k, true))
  const hStart = ccpText + ccpFtn
  const story = (k: number): HeaderFooter | undefined => {
    if (k + 1 >= hcp.length || hcp[k + 1] <= hcp[k] || hcp[k + 1] > ccpHdd) return undefined
    return {
      text: visible(text(hStart + hcp[k], hStart + hcp[k + 1]))
        .replaceAll('\r', '\n')
        .replaceAll('\u0007', '\n')
        .split('\n')
        .map((l) => stripControls(l, '\t'))
        .join('\n')
        .trim(),
    }
  }

  const sections: Section[] = []
  let inherited: Section['footer'] = {}
  for (let s = 0; s < nSed; s++) {
    const fcSepx = pv.getUint32((nSed + 1) * 4 + s * 12 + 2, true)
    let titlePage = false
    let format: NumberFormat = 'decimal'
    let start: number | undefined
    let breakNew = true
    let restart = false
    if (fcSepx !== 0xffffffff && fcSepx + 2 <= wd.length) {
      const cb = dv.getInt16(fcSepx, true)
      let k = fcSepx + 2
      const stop = fcSepx + 2 + cb
      while (k + 2 <= stop) {
        const sprm = dv.getUint16(k, true)
        k += 2
        const size = [1, 1, 2, 4, 2, 2, 0, 3][sprm >> 13] || 1 + wd[k]
        const op1 = wd[k]
        if (sprm === 0x300a) titlePage = op1 !== 0
        else if (sprm === 0x300e) format = NFC[op1] ?? 'decimal'
        else if (sprm === 0x3011) restart = op1 !== 0
        else if (sprm === 0x501c) start = dv.getInt16(k, true)
        else if (sprm === 0x3009) breakNew = op1 !== 0 && op1 !== 1
        k += size
      }
    }
    const own: Section['footer'] = {}
    const even = story(6 + s * 6 + 2)
    const odd = story(6 + s * 6 + 3)
    const first = story(6 + s * 6 + 5)
    if (odd) own.default = odd
    if (even) own.even = even
    if (first) own.first = first
    inherited = { ...inherited, ...own }
    const firstPara = s === 0 ? 0 : paraAt(cps[s])
    const lastPara = s === nSed - 1 ? paras.length - 1 : paraAt(cps[s + 1]) - 1
    const sec: Section = {
      first: firstPara,
      last: Math.max(firstPara, lastPara),
      format,
      titlePage,
      footer: inherited,
      newPage: s === 0 || breakNew,
    }
    if (restart) sec.start = start ?? 1
    if (sec.newPage && paras[firstPara]) paras[firstPara].newPage = true
    for (let i = sec.first; i <= sec.last && i < paras.length; i++) paras[i].section = s
    sections.push(sec)
  }

  return {
    kind: 'doc',
    paras,
    sections: sections.length ? sections : undefined,
    pictures,
    notes: [
      'This is an old Word file (.doc): its text, sections and page numbers were checked, but not its fonts, bold or italic text, alignment or line spacing. Save it as a Word Document (.docx), or as PDF, and check that file for the full review.',
    ],
  }
}
