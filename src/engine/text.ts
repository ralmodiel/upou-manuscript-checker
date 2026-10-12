// Text helpers shared by the rules: normalising, case, Roman numerals, dates, short quotes.
import type { Para } from './model.ts'

/** Curly quotes and dashes made plain, spaces collapsed. */
export const norm = (s: string) =>
  s
    .normalize('NFKC')
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

/** A title for comparing two copies: case, a hyphen broken at a line end ("SOCIO-" "CULTURAL")
 *  and the punctuation or quotes around the title count for nothing. */
export const titleForm = (s: string) =>
  norm(s)
    .toLowerCase()
    .replace(/\s*-\s+/g, '-')
    .replace(/^[\s"'.,;:!?…]+|[\s"'.,;:!?…]+$/g, '')

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
