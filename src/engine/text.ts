// Text helpers shared by the rules: normalising, case, Roman numerals, dates, short quotes.
import type { Para } from './model.ts'

/** Characters a font's glyph numbers leave in a PDF's text where it has no map to letters:
 *  control characters, letters of Latin Extended-B, rare combining marks, private-use signs. */
const UNMAPPED = /[\u0180-\u024f\ue000-\uf8ff\ufffd]/gu
export const unmapped = (s: string) =>
  (s.match(UNMAPPED) ?? []).length +
  [...s].filter((c) => {
    const k = c.charCodeAt(0)
    // (controls, and combining marks no language writes: not the common accents)
    return (
      (k < 32 && !'\t\n\r'.includes(c)) || (k >= 0x310 && k <= 0x36f && k !== 0x327 && k !== 0x328)
    )
  }).length

/** A word a font printed with wrong glyphs: glyph numbers for letters, a symbol stuck to a letter
 *  ("KHUHb\\" for "hereby"), capitals inside it twice or in a run ("SeUPiVViRQ", "aOORZ").
 *  Not one capital inside a word, as names and degrees have ("YouTube", "PhD", "DepEd"). */
export const oddWord = (w: string) =>
  unmapped(w) > 0 ||
  /\p{L}[\\^|~]|[\\^|~]\p{L}/u.test(w) ||
  (w.match(/\p{Ll}\p{Lu}/gu) ?? []).length >= 2 ||
  /\p{Ll}\p{Lu}{3}/u.test(w)

/** A PDF's text with what a font's glyph numbers stand for put back where that is sure: the
 *  ellipsis of a Calibri font (U+0359), a font's digits read as Coptic
 *  letters ("Ϯ0ϭϳ" for 2017). */
export const mend = (s: string) =>
  s.replace(/\u0359/g, '…').replace(/[\d\u03ec-\u03f5]{2,}/gu, (m) =>
    // (with a digit read right among them: a run of such letters alone may be words)
    /\d/.test(m) ? m.replace(/[\u03ec-\u03f5]/gu, (c) => String(c.charCodeAt(0) - 0x3ec)) : m,
  )

/** A page number's first digit or letter read with the ellipsis, apart from the rest ("…1 4"
 *  for "…14", "…i ii" for "…iii"): put back together. */
export const rejoin = (t: string) =>
  t.replace(/(…|\.{2,})(\d|[ivx]) (\d{1,2}|[ivx]{1,4})$/, (m, e: string, a: string, b: string) =>
    /\d/.test(a) === /\d/.test(b) && (/\d/.test(a) || fromRoman(a + b) !== undefined)
      ? `${e}${a}${b}`
      : m,
  )

/** Curly quotes and dashes made plain, spaces collapsed. */
export const norm = (s: string) =>
  s
    .normalize('NFKC')
    // (a font read in its glyph order: "’s" printed as "¶V")
    .replace(/(?<=\p{L})¶V(?=\s|$)/gu, "'s")
    .replace(/(?<=\p{L})¶(?=s\b)/gu, "'")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()

/** The paragraph as it shows: all-caps runs in upper case. */
export const shown = (p: Para) =>
  p.runs.map((r) => (r.caps ? r.text.toUpperCase() : r.text)).join('')

export const hasLetters = (s: string) => /\p{L}/u.test(s)

/** Every letter in upper case (digits and punctuation aside). */
export const isUpper = (s: string) => hasLetters(s) && s === s.toUpperCase()

/** Words with lowercase letters (for "not in upper case" details). */
export const lowerWords = (s: string) => s.split(/\s+/).filter((w) => /\p{Ll}/u.test(w))

const ROMAN: [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
]

export function roman(n: number): string {
  let out = ''
  for (const [v, s] of ROMAN)
    while (n >= v) {
      out += s
      n -= v
    }
  return out
}

/** The number a well-formed Roman numeral stands for (either case), else undefined. */
export function fromRoman(s: string): number | undefined {
  const t = s.toLowerCase()
  if (!/^[ivxlcdm]+$/.test(t)) return undefined
  let n = 0
  let rest = t
  for (const [v, sym] of ROMAN)
    while (rest.startsWith(sym)) {
      n += v
      rest = rest.slice(sym.length)
    }
  return rest === '' && roman(n) === t ? n : undefined
}

const MONTH =
  '(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\\.?'
/** A written date: 15 October 2026, October 15, 2026 (or 15,2026), 15/10/2026, 2026-10-15. */
export const DATE = new RegExp(
  `(?<![A-Za-z0-9])(\\d{1,2}\\s+${MONTH}(\\s*,\\s*|\\s+)\\d{4}|${MONTH}\\s+\\d{1,2}(\\s*,\\s*|\\s+)\\d{4}|${MONTH}\\s+\\d{4}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2})(?![A-Za-z0-9])`,
  'i',
)

/** First words of a paragraph, for "find it in your file" locations. */
export function quote(s: string, max = 70): string {
  const t = norm(s.replace(/\{PAGE\}/g, '#'))
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 15)) + '…'
}

/** Levenshtein distance, for "nearly the same" names and titles. */
export function distance(a: string, b: string): number {
  if (a === b) return 0
  const row = Array.from({ length: b.length + 1 }, (_, k) => k)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]
}

/** Text read through a font that was re-encoded (a repository's copy of a PDF): letters shifted,
 *  so capitals stand inside words ("MarYet", "StXdent"). Needs several such words, and a
 *  quarter of the words, so a name like "YouTube" or "McDonald" does not count. */
export function garbled(s: string): boolean {
  // Control characters where spaces and letters should be (a font's glyph numbers read as text).
  let control = 0
  for (const c of s) {
    const k = c.charCodeAt(0)
    if (k < 32 && k !== 9 && k !== 10 && k !== 13) control++
  }
  if (control >= 2) return true
  // Glyph numbers in place of letters (a font with no map to Unicode).
  const u = unmapped(s)
  if (u >= 3 && u >= 0.1 * (s.match(/\p{L}/gu) ?? []).length) return true
  // Backslashes and carets stuck to letters (a shifted font's "y" and "w"): not how text is written.
  if ((s.match(/\p{L}[\\^|~]|[\\^|~]\p{L}/gu) ?? []).length >= 2) return true
  const words = s.split(/\s+/).filter((w) => w.replace(/[^\p{L}]/gu, '').length >= 3)
  const odd = words.filter((w) => /\p{Ll}\p{Lu}/u.test(w.replace(/^(Mc|Mac)/, '')))
  if (odd.length >= 3 && odd.length >= 0.25 * words.length) return true
  // Two words with capitals standing twice inside them ("FemiQiVm"), a few words in all.
  if (odd.filter((w) => (w.match(/\p{Ll}(?=\p{Lu})/gu) ?? []).length >= 2).length >= 2) return true
  // Letters shifted along the alphabet's code (a font's glyph numbers read as characters) leave
  // hardly a vowel in a stretch of text; words of every language have them.
  const letters = s.match(/\p{L}/gu) ?? []
  const vowels = letters.filter((c) => /[aeiouyáéíóúàèìòùâêîôûäëïöüãõ]/i.test(c)).length
  return letters.length >= 14 && vowels < 0.15 * letters.length
}

/** Two titles the text layer reads differently through its own failings, not the writer's: letters
 *  spaced out or runs of text out of order (the same letters, another arrangement), or a glyph
 *  misread as a digit inside a word ("ANALYS1S"). */
export function readsOddly(a: string, b: string): boolean {
  const letters = (s: string) => s.toLowerCase().replace(/[^\p{L}]/gu, '')
  const [la, lb] = [letters(a), letters(b)]
  if (la.length >= 8 && [...la].sort().join('') === [...lb].sort().join('')) {
    // The same letters in the same order, the spaces elsewhere: a word or two joined or split is
    // the writer's ("health care", "healthcare"); several words broken into pieces is spacing.
    if (la === lb) {
      const words = (s: string) =>
        s
          .toLowerCase()
          .split(/[^\p{L}]+/u)
          .filter(Boolean)
      const [wa, wb] = [words(a), words(b)]
      return wb.length - wa.length >= 2 || wb.some((w) => w.length === 1 && !wa.includes(w))
    }
    // The same letters in another order: two letters swapped is a typing slip ("SCEURITY"); a
    // longer stretch out of place is runs of text read in the wrong order.
    let i = 0
    while (la[i] === lb[i]) i++
    let j = 0
    while (la[la.length - 1 - j] === lb[lb.length - 1 - j]) j++
    return la.length - i - j > 3
  }
  const { onlyA, onlyB } = wordDiff(a, b)
  return [...onlyA, ...onlyB].some((w) => /\p{L}\d|\d\p{L}/u.test(w))
}

/** A title for comparing two copies: case, a hyphen broken at a line end ("SOCIO-" "CULTURAL")
 *  and the punctuation or quotes around the title count for nothing. */
export const titleForm = (s: string) =>
  norm(s)
    .toLowerCase()
    .replace(/\s*-\s+/g, '-')
    .replace(/^[\s"'.,;:!?…]+|[\s"'.,;:!?…]+$/g, '')

/** Words only: two titles equal here differ in punctuation or hyphens alone. */
export const titleLoose = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Words that differ between two versions of a title (case and punctuation aside; words of two
 *  letters or fewer left out, as they say little). */
export function wordDiff(a: string, b: string): { onlyA: string[]; onlyB: string[] } {
  const words = (s: string) =>
    norm(s)
      .toLowerCase()
      .replace(/\s*-\s+/g, '-')
      .split(' ')
      .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
      .filter((w) => w.length > 2)
  const wa = words(a)
  const wb = words(b)
  return {
    onlyA: wa.filter((w) => !wb.includes(w)),
    onlyB: wb.filter((w) => !wa.includes(w)),
  }
}

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

export const list = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`
