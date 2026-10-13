// In-text citations, APA style: in brackets "(Reyes & Cruz, 2019; Lim et al., 2020)", in the
// sentence "Reyes and Cruz (2019)" or "Lim et al.'s (2020)", and with the year in the sentence,
// "In 2019, Reyes found".

export interface Cite {
  /** Surnames as written, in order; one, with `etal`, for "Lim et al.". */
  names: string[]
  etal: boolean
  /** As written: "2019", "2019a", "n.d.", "in press", a reprint "1900/1953". */
  years: string[]
  /** As written, for the message. */
  text: string
  /** Bracketed, "(Reyes, 2019)"; else in the sentence. */
  paren: boolean
  /** In the sentence, after a capitalised word: "United Kingdom (2020)" may name no author. */
  proper?: boolean
}

// Words that open a sentence before the names: "Moreover, Reyes and Cruz (2019)".
const LEAD =
  /^(?:moreover|furthermore|similarly|however|thus|also|additionally|likewise|meanwhile|hence|therefore|conversely|finally|lastly|notably|indeed|accordingly|consequently|nonetheless|nevertheless|specifically|recently|interestingly|first|second|third|then|still|yet|so|but|and|while|although|though|as|for|in|on|by|from|with|according|here|there|this|these|that|those|the)$/i

const PART =
  '(?:(?:[Dd]e [Ll]os|[Dd]e [Ll]a|[Dd]elos|[Dd]ela|[Dd]el|[Dd]e|[Vv]an [Dd]e[rn]|[Vv]an|[Vv]on|[Dd]i|[Dd]a|[Dd]u|[Ll]e|[Ll]a|San|Santa|[Tt]e[rn])\\s+)?'
const NAME = `${PART}\\p{Lu}[\\p{L}'’-]*\\p{L}`
const AUTH = `${NAME}(?:\\s+et\\s+al\\.?|(?:,\\s+${NAME})*,?\\s+(?:and|&)\\s+${NAME})?`
const YR = `(?:1[5-9]|20)\\d\\d[a-z]?(?:\\/\\d{4}[a-z]?)?|n\\.\\s?d\\.(?:-[a-z])?|in press(?:-[a-z])?`
const YRS = `(?:${YR})(?:,\\s*(?:${YR}))*`
// (APA's verbs of reporting: "In 2019, Reyes found", "In 2019, Reyes's study showed")
const VERB =
  '(?:found|reported|noted|argued|stated|showed|observed|suggested|concluded|explained|emphasi[sz]ed|posited|claimed|asserted|described|defined|identified|discovered|revealed|pointed|conducted|examined|investigated|studied|proposed|developed|mentioned|highlighted|wrote|introduced|published|presented|surveyed|analy[sz]ed|compared|recommended|established|demonstrated|indicated|assessed|evaluated|explored|stressed|maintained|contended|theori[sz]ed|coined|used|added|said)'
// The work a secondary source cites is not listed in APA. In the sentence, the source follows:
// "Bagyo (1991), as cited by Tala (2019)", "Ulan (2002) (cited in Cruz, 2018)", "Dagat (1994),
// as mentioned by"; in brackets, it comes last: "(Kidlat 1977, Kulog 1983 in Tala, 1997)".
const SECONDARY =
  '\\s*,?\\s*\\(?\\s*(?:as\\s+)?(?:cited|quoted|mentioned|discussed|reported|referenced|explained)\\s+(?:in|by)\\b'
const SOURCE =
  /\b(?:(?:as\s+)?(?:cited|quoted|mentioned|reported)\s+(?:in|by)|in|through)\s+(?=\p{Lu})/giu

const IN_PAREN = new RegExp(`^\\s*(${AUTH}),?\\s+(${YRS})(?=\\s*(?:,|$))`, 'u')
const NARRATIVE = new RegExp(
  `(?<![\\p{L}'’-])(${AUTH})(?:[’']s?)?\\s*\\((${YRS})(?:,[^()]{0,40})?\\)(?!${SECONDARY})`,
  'gu',
)
const BARE = new RegExp(
  `\\b[Ii]n\\s+((?:1[5-9]|20)\\d\\d),\\s+(${AUTH})(?:(?:[’']s?)\\s+\\p{Ll}+)?\\s+${VERB}\\b`,
  'gu',
)
const PREFIX =
  /^\s*(?:(?:e\.g\.|i\.e\.|see also|see|cf\.|also|for example|for a review, see)[,\s]+)+/i

function cite(auth: string, years: string, text: string, paren: boolean): Cite {
  const etal = /\set\s+al\b/.test(auth)
  const names = auth
    .replace(/\s+et\s+al\.?$/, '')
    .split(/,\s+|,?\s+(?:and|&)\s+/)
    .filter(Boolean)
    .map((n) => n.replace(/[’']s?$/, ''))
  text = text.trim()
  while (names.length > 1 && LEAD.test(names[0]))
    text = text.slice(text.indexOf(names.shift()!)).replace(/^\S+,?\s+/, '')
  return { names, etal, years: years.split(/,\s*/), text, paren }
}

/** The citations in one paragraph; of a secondary source's, only the source's own. */
export function readCites(text: string): Cite[] {
  const out: Cite[] = []
  for (const m of text.matchAll(/\(([^()]{3,300})\)/g))
    for (let part of m[1].split(';')) {
      const last = [...part.matchAll(SOURCE)].at(-1)
      if (last) part = part.slice(last.index + last[0].length)
      part = part.replace(PREFIX, '')
      const c = IN_PAREN.exec(part)
      if (c) out.push(cite(c[1], c[2], c[0], true))
    }
  for (const m of text.matchAll(NARRATIVE)) {
    // (in its brackets: "Hangin (1975, in Ulap, 1980)", "Reyes (1990, cited in Cruz, 2020)")
    if (/\b(?:cited|in)\b|,\s*\p{Lu}\p{Ll}/u.test(m[0].slice(m[0].indexOf('(')))) continue
    const before = text.slice(0, m.index)
    // (the works a source cites: "Ilog (2020) cited Araw (1997)", "Ilog (2018), citing Kidlat
    // (2004) and Kulog (2002)")
    if (/\b(?:citing|cited)\s+(?!in\b|by\b)/.test(before.split(/(?<!\bal)[.;:]\s/).at(-1)!))
      continue
    const c = cite(m[1], m[2], m[0], false)
    const w = /(\p{Lu}[\p{L}'’-]*)\s+$/u.exec(before)?.[1]
    c.proper = !!w && !LEAD.test(w)
    out.push(c)
  }
  for (const m of text.matchAll(BARE)) out.push(cite(m[2], m[1], m[0], false))
  return out
}
