// The topic plan a student builds on the Topic planner tab, and what follows from it: the
// question, working title and objective put together from their words, the search string, the
// PRISMA 2020 flow numbers and what they say about the topic's size. The page, the Word file and
// the tests all read these; nothing here touches the page or the network.
import { ABSTRACT, MAIN } from './prisma.ts'

export type Kind = 'effect' | 'experience' | 'association' | 'scope'

export interface Element {
  id: string
  letter: string
  name: string
  hint: string
  example: string
  /** Left out of the question when empty (a comparison, a context). */
  optional?: boolean
  /** In the search by default: the population and the main concept, not the comparison. */
  search: boolean
}

const el = (
  id: string,
  letter: string,
  name: string,
  hint: string,
  example: string,
  search: boolean,
  optional = false,
): Element => ({ id, letter, name, hint, example, search, optional })

const POPULATION = (example: string) =>
  el('population', 'P', 'Population', 'Who the studies are about', example, true)

/** The kinds of question and the framework that shapes each (PICO, PICo, PEO, PCC). */
export const KINDS: Record<
  Kind,
  {
    ask: string
    framework: string
    blurb: string
    /** A topic as a student might first say it. */
    sample: string
    review: 'systematic review' | 'scoping review'
    designs: string[]
    elements: Element[]
  }
> = {
  effect: {
    ask: 'Does something work?',
    framework: 'PICO',
    blurb: 'The effect of a program, method or tool on an outcome.',
    sample: 'Games in online classes',
    review: 'systematic review',
    designs: ['Randomised controlled trials', 'Quasi-experimental studies'],
    elements: [
      POPULATION('learners in online distance education'),
      el(
        'intervention',
        'I',
        'Intervention',
        'The program, method or tool',
        'gamified learning activities',
        true,
      ),
      el(
        'comparison',
        'C',
        'Comparison',
        'What it is compared with, if anything',
        'the same activities without game elements',
        false,
        true,
      ),
      el('outcome', 'O', 'Outcome', 'What it changes', 'learner engagement', true),
    ],
  },
  experience: {
    ask: 'What is it like?',
    framework: 'PICo',
    blurb: 'How people experience or see something (qualitative studies).',
    sample: 'First-generation students studying online from home',
    review: 'systematic review',
    designs: ['Qualitative studies', 'Mixed-methods studies'],
    elements: [
      POPULATION('first-generation college students'),
      el(
        'interest',
        'I',
        'Phenomenon of interest',
        'The experience, view or process',
        'studying online from home',
        true,
      ),
      el(
        'context',
        'Co',
        'Context',
        'Where, or in what setting, if it matters',
        'rural communities',
        false,
        true,
      ),
    ],
  },
  association: {
    ask: 'What is linked to what?',
    framework: 'PEO',
    blurb: 'Whether a factor or condition goes with an outcome.',
    sample: 'Phone use and job satisfaction of health workers',
    review: 'systematic review',
    designs: ['Cohort studies', 'Case-control studies', 'Cross-sectional surveys'],
    elements: [
      POPULATION('community health workers'),
      el('exposure', 'E', 'Exposure', 'The factor or condition', 'mobile phone use for work', true),
      el('outcome', 'O', 'Outcome', 'What it may go with', 'job satisfaction', true),
    ],
  },
  scope: {
    ask: 'What is known about it?',
    framework: 'PCC',
    blurb: 'Map the studies on a topic, and find where the gaps are.',
    sample: 'Participatory video with smallholder farmers',
    review: 'scoping review',
    designs: [],
    elements: [
      POPULATION('smallholder farmers'),
      el('concept', 'C', 'Concept', 'The topic to map', 'participatory video', true),
      el(
        'context',
        'Co',
        'Context',
        'Where, or in what setting, if it matters',
        'Southeast Asia',
        false,
        true,
      ),
    ],
  },
}

export const DESIGNS = [
  'Randomised controlled trials',
  'Quasi-experimental studies',
  'Cohort studies',
  'Case-control studies',
  'Cross-sectional surveys',
  'Qualitative studies',
  'Mixed-methods studies',
  'Case studies',
]
/** Chosen alone: it stands for every language, so the others are left out beside it. */
export const ANY_LANGUAGE = 'Any language'
export const LANGUAGES = ['English', 'Filipino', ANY_LANGUAGE]
export const TYPES = [
  'Journal articles (peer-reviewed)',
  'Theses and dissertations',
  'Conference papers',
  'Reports and grey literature',
  'Preprints',
]
export const SCREENERS = [
  'I screen alone',
  'Two of us screen independently',
  'I screen; a second person checks a sample',
]

const q = encodeURIComponent
/** Where to search. Those with an address open the search there; the rest are reached through
 *  a library's subscription. */
export const SOURCES: { id: string; name: string; note: string; url?: (s: string) => string }[] = [
  {
    id: 'upload',
    name: 'UPOU Repository',
    note: 'UPOU theses, dissertations and student papers.',
    url: (s) => `https://repository.upou.edu.ph/search?query=${q(s)}`,
  },
  {
    id: 'ijodel',
    name: 'IJODeL',
    note: 'UPOU’s journal on open and distance e-learning; open access.',
    url: (s) => `https://ijodel.upou.edu.ph/ijodel/search/search?query=${q(s)}`,
  },
  {
    id: 'scholar',
    name: 'Google Scholar',
    note: 'Wide but loose: its results change, so note the date.',
    url: (s) => `https://scholar.google.com/scholar?q=${q(s)}`,
  },
  {
    id: 'eric',
    name: 'ERIC',
    note: 'Education research.',
    url: (s) => `https://eric.ed.gov/?q=${q(s)}`,
  },
  {
    id: 'pubmed',
    name: 'PubMed',
    note: 'Health and life sciences.',
    url: (s) => `https://pubmed.ncbi.nlm.nih.gov/?term=${q(s)}`,
  },
  {
    id: 'europepmc',
    name: 'Europe PMC',
    note: 'Health and life sciences, with preprints.',
    url: (s) => `https://europepmc.org/search?query=${q(s)}`,
  },
  {
    id: 'core',
    name: 'CORE',
    note: 'Open-access papers from repositories.',
    url: (s) => `https://core.ac.uk/search?q=${q(s)}`,
  },
  {
    id: 'base',
    name: 'BASE',
    note: 'Open repositories, theses included.',
    url: (s) => `https://www.base-search.net/Search/Results?lookfor=${q(s)}`,
  },
  { id: 'scopus', name: 'Scopus', note: 'Through your library’s access.' },
  { id: 'wos', name: 'Web of Science', note: 'Through your library’s access.' },
  { id: 'ebsco', name: 'EBSCOhost', note: 'Through your library’s access.' },
]

export interface SourceLog {
  on?: boolean
  date?: string
  found?: string
  filters?: string
}

export interface Plan {
  interest: string
  /** A title of the student's own; empty, and the working title is written from the parts. */
  title: string
  kind: Kind
  /** The question's parts by element id; kept when the kind changes, so shared parts carry over. */
  parts: Partial<Record<string, string>>
  /** Synonyms per element, searched with OR beside the part itself. */
  terms: Partial<Record<string, string[]>>
  /** Elements in or out of the search, where the student changed the default. */
  searched: Partial<Record<string, boolean>>
  rationale: string
  /** Reviews already published on the topic, and whether the topic still stands beside them. */
  reviews: string
  /** Where the review is or will be registered (PRISMA item 24a), or that it is not. */
  registered: string
  from: string
  to: string
  languages: string[]
  designs: string[]
  types: string[]
  include: string
  exclude: string
  sources: Partial<Record<string, SourceLog>>
  others: string
  screener: string
  registers: string
  duplicates: string
  automation: string
  removed: string
  screenedOut: string
  notRetrieved: string
  reasons: { why: string; n: string }[]
  studies: string
  gaps: string
  where: Partial<Record<string, string>>
  abstract: Partial<Record<string, 'yes' | 'no'>>
}

export const REASONS = [
  'Wrong population',
  'Wrong intervention or exposure',
  'Wrong outcome',
  'Wrong study design',
  'Not in the chosen years or languages',
]

export const blank = (): Plan => ({
  interest: '',
  title: '',
  kind: 'effect',
  parts: {},
  terms: {},
  searched: {},
  rationale: '',
  reviews: '',
  registered: '',
  from: '',
  to: '',
  languages: [],
  designs: [],
  types: [],
  include: '',
  exclude: '',
  sources: {},
  others: '',
  screener: '',
  registers: '',
  duplicates: '',
  automation: '',
  removed: '',
  screenedOut: '',
  notRetrieved: '',
  reasons: REASONS.map((why) => ({ why, n: '' })),
  studies: '',
  gaps: '',
  where: {},
  abstract: {},
})

/** A finished example, invented for the tab's "Try an example". */
export const EXAMPLE: Plan = {
  ...blank(),
  interest: 'Games in online classes',
  kind: 'effect',
  parts: {
    population: 'learners in online distance education',
    intervention: 'gamified learning activities',
    comparison: 'the same activities without game elements',
    outcome: 'learner engagement',
  },
  terms: {
    population: ['distance education', 'online learning', 'e-learning'],
    intervention: ['gamification', 'game-based learning', 'serious games'],
    outcome: ['engagement', 'motivation', 'participation'],
  },
  rationale:
    'Online courses lose learners to low engagement. Game elements are widely used, but studies disagree on whether they help.',
  reviews:
    'A 2019 review covered gamification in higher education as a whole; none since has looked at online distance learners.',
  registered: 'Not registered; a protocol will be sent to the adviser first.',
  from: '2015',
  to: '2025',
  languages: ['English'],
  designs: ['Randomised controlled trials', 'Quasi-experimental studies'],
  types: ['Journal articles (peer-reviewed)', 'Theses and dissertations'],
  exclude: 'Studies of face-to-face classes only\nStudies of games played for leisure',
  sources: {
    scholar: { on: true, date: '2025-09-15', found: '412', filters: 'Years 2015–2025' },
    eric: { on: true, date: '2025-09-15', found: '138', filters: 'Peer reviewed only' },
    core: { on: true, date: '2025-09-16', found: '96' },
  },
  others: 'Reference lists of included studies',
  screener: 'I screen; a second person checks a sample',
  duplicates: '121',
  removed: '0',
  screenedOut: '441',
  notRetrieved: '6',
  reasons: [
    { why: 'Wrong population', n: '19' },
    { why: 'Wrong intervention or exposure', n: '11' },
    { why: 'Wrong outcome', n: '8' },
    { why: 'Wrong study design', n: '17' },
    { why: 'Not in the chosen years or languages', n: '0' },
  ],
  gaps: 'Few studies from Southeast Asia; none of learners who study on mobile phones only.',
}

// ---- The question ----

/** The connector a hint invites before a part ("in", "compared with"); the sentences supply it. */
const LEAD: Partial<Record<string, RegExp>> = {
  context: /^(in|within|at)\s+/i,
  comparison: /^(compared (with|to)|versus|vs\.?)\s+/i,
}
/** A part as the sentences use it, the part as typed kept: spaces evened out, a leading connector
 *  and the stop or comma a student may end it with taken off (an abbreviation at its end, like
 *  U.S., loses its last stop too). */
const val = (p: Plan, id: string) =>
  (p.parts[id] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEAD[id] ?? /^/, '')
    .replace(/[\s.?!,;:]+$/, '')
export const elementsOf = (p: Plan) => KINDS[p.kind].elements

/** The question as words and blanks: a blank names the part still to write. */
export type Piece = { text: string } | { blank: string }

export function questionPieces(p: Plan): Piece[] {
  const part = (id: string): Piece => {
    const v = val(p, id)
    return v
      ? { text: v }
      : {
          blank: elementsOf(p)
            .find((e) => e.id === id)!
            .name.toLowerCase(),
        }
  }
  const t = (text: string): Piece => ({ text })
  const opt = (id: string, before: string, after = ''): Piece[] =>
    val(p, id) ? [t(before), part(id), t(after)] : []
  switch (p.kind) {
    case 'effect':
      return [
        t('Among '),
        part('population'),
        t(', what is the effect of '),
        part('intervention'),
        ...opt('comparison', ', compared with ', ','),
        t(' on '),
        part('outcome'),
        t('?'),
      ]
    case 'experience':
      return [
        t('How do '),
        part('population'),
        t(' experience '),
        part('interest'),
        ...opt('context', ' in '),
        t('?'),
      ]
    case 'association':
      return [
        t('Among '),
        part('population'),
        t(', is '),
        part('exposure'),
        t(' associated with '),
        part('outcome'),
        t('?'),
      ]
    case 'scope':
      return [
        t('What is known about '),
        part('concept'),
        t(' among '),
        part('population'),
        ...opt('context', ' in '),
        t('?'),
      ]
  }
}

const words = (pieces: Piece[]) =>
  pieces.map((x) => ('text' in x ? x.text : `[${x.blank}]`)).join('')

export const question = (p: Plan) => words(questionPieces(p))

/** Every part the question needs is written. */
export const questionReady = (p: Plan) => elementsOf(p).every((e) => e.optional || val(p, e.id))

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The student's own title, else a working title that names the review, as PRISMA item 1 asks;
 *  empty until the parts are in. */
export function workingTitle(p: Plan): string {
  if (p.title.trim()) return p.title.trim()
  if (!questionReady(p)) return ''
  const kind =
    KINDS[p.kind].review === 'scoping review' ? 'A Scoping Review' : 'A Systematic Review'
  const pop = val(p, 'population')
  const where = val(p, 'context') ? ` in ${val(p, 'context')}` : ''
  switch (p.kind) {
    case 'effect':
      return `${cap(val(p, 'intervention'))} and ${val(p, 'outcome')} among ${pop}: ${kind}`
    case 'experience':
      return `How ${pop} experience ${val(p, 'interest')}${where}: ${kind} of Qualitative Studies`
    case 'association':
      return `${cap(val(p, 'exposure'))} and ${val(p, 'outcome')} among ${pop}: ${kind}`
    case 'scope':
      return `${cap(val(p, 'concept'))} among ${pop}${where}: ${kind}`
  }
}

/** The objective, as PRISMA item 4 asks: one explicit statement. */
export function objective(p: Plan): string {
  if (!questionReady(p)) return ''
  const pop = val(p, 'population')
  switch (p.kind) {
    case 'effect':
      return `To synthesise the evidence on the effect of ${val(p, 'intervention')}${val(p, 'comparison') ? `, compared with ${val(p, 'comparison')},` : ''} on ${val(p, 'outcome')} among ${pop}.`
    case 'experience':
      return `To synthesise qualitative evidence on how ${pop} experience ${val(p, 'interest')}${val(p, 'context') ? ` in ${val(p, 'context')}` : ''}.`
    case 'association':
      return `To synthesise the evidence on whether ${val(p, 'exposure')} is associated with ${val(p, 'outcome')} among ${pop}.`
    case 'scope':
      return `To map the studies on ${val(p, 'concept')} among ${pop}${val(p, 'context') ? ` in ${val(p, 'context')}` : ''}, and to identify gaps.`
  }
}

// ---- The search ----

export const isSearched = (p: Plan, e: Element) => p.searched[e.id] ?? e.search

/** The part itself, then its synonyms, without repeats. */
export function termsOf(p: Plan, id: string): string[] {
  const seen = new Set<string>()
  return [val(p, id), ...(p.terms[id] ?? [])]
    .map((t) => t.trim())
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
}

/** A term typed with its own OR, AND or parentheses: a clause the student wrote. */
const isClause = (t: string) => /[()]| OR | AND /.test(t)
/** A clause as typed, in its own parentheses when none enclose it. */
const own = (t: string) => (/^\([^()]*\)$/.test(t) ? t : `(${t})`)
/** A phrase in quotes (its own quotes, straight or curly, taken out first); a word or a wildcard
 *  as typed; a clause as typed. */
const phrase = (t: string) => {
  if (isClause(t)) return own(t)
  const plain = t.replace(/["“”]/g, '')
  return /\s/.test(plain) ? `"${plain}"` : plain
}

/** One block per searched part, its terms joined by OR; the blocks joined by AND. */
const blocks = (p: Plan, term: (t: string) => string) =>
  elementsOf(p)
    .filter((e) => isSearched(p, e))
    .map((e) => termsOf(p, e.id).map(term))
    .filter((ts) => ts.length)
    .map((ts) => (ts.length > 1 ? `(${ts.join(' OR ')})` : ts[0]))
    .join(' AND ')

export function searchString(p: Plan): string {
  return blocks(p, phrase)
}

/** The string as one database reads it: PubMed with [tiab] on each term, Scopus and Web of
 *  Science in their field codes, the rest as searchString(). */
export function searchFor(p: Plan, sourceId: string): string {
  if (sourceId === 'pubmed') return blocks(p, (t) => (isClause(t) ? own(t) : `${phrase(t)}[tiab]`))
  const s = searchString(p)
  if (!s) return ''
  return sourceId === 'scopus' ? `TITLE-ABS-KEY(${s})` : sourceId === 'wos' ? `TS=(${s})` : s
}

// ---- The PRISMA 2020 flow ----

/** A count as typed: digits, with commas or spaces between them, or nothing yet. */
export const numeric = (s: string) => /^[\d,\s]*$/.test(s)
/** A count as a number; anything but digits ("1e3", "0x10", "about 400") counts as 0. */
const num = (s = '') => (numeric(s) ? Number(s.replace(/[,\s]/g, '')) : 0)
const given = (s?: string) => (s ?? '').trim() !== ''

const COUNTS = [
  'registers',
  'duplicates',
  'automation',
  'removed',
  'screenedOut',
  'notRetrieved',
  'studies',
] as const

/** The count fields whose text is not a number (the flow reads them as 0): the field's name,
 *  `reason:<row>` or `source:<id>`. */
export function badNumbers(p: Plan): string[] {
  return [
    ...COUNTS.filter((k) => !numeric(p[k])),
    ...p.reasons.flatMap((r, k) => (numeric(r.n) ? [] : [`reason:${k}`])),
    ...Object.entries(p.sources).flatMap(([id, s]) =>
      numeric(s?.found ?? '') ? [] : [`source:${id}`],
    ),
  ]
}

export interface Flow {
  bySource: { name: string; n: number }[]
  databases: number
  registers: number
  identified: number
  removed: number
  screened: number
  excluded: number
  sought: number
  notRetrieved: number
  assessed: number
  reasons: { why: string; n: number }[]
  reports: number
  studies: number
  /** Screening has begun: a number of records excluded is given. */
  screening: boolean
  /** Numbers that cannot all be right (more taken away than there was), each with the field
   *  group it concerns. */
  problems: {
    about: 'removed' | 'screenedOut' | 'notRetrieved' | 'reasons' | 'studies'
    text: string
  }[]
}

export function flow(p: Plan): Flow {
  const bySource = SOURCES.filter((s) => p.sources[s.id]?.on).map((s) => ({
    name: s.name,
    n: num(p.sources[s.id]?.found),
  }))
  const databases = bySource.reduce((a, s) => a + s.n, 0)
  const registers = num(p.registers)
  const identified = databases + registers
  const removed = num(p.duplicates) + num(p.automation) + num(p.removed)
  const problems: Flow['problems'] = []
  const less = (a: number, b: number, about: Flow['problems'][number]['about'], text: string) => {
    if (b > a) problems.push({ about, text })
    return Math.max(0, a - b)
  }
  const screened = less(
    identified,
    removed,
    'removed',
    'More records are removed than were identified.',
  )
  const excluded = num(p.screenedOut)
  const sought = less(
    screened,
    excluded,
    'screenedOut',
    'More records are excluded than were screened.',
  )
  const notRetrieved = num(p.notRetrieved)
  const assessed = less(
    sought,
    notRetrieved,
    'notRetrieved',
    'More reports are missing than were sought.',
  )
  // (a reason without a count is a row still to fill, not a reason with none)
  const reasons = p.reasons
    .filter((r) => given(r.n))
    .map((r) => ({ why: r.why.trim() || 'Other reason', n: num(r.n) }))
  const reports = less(
    assessed,
    reasons.reduce((a, r) => a + r.n, 0),
    'reasons',
    'More reports are excluded than were assessed.',
  )
  const studies = given(p.studies) ? num(p.studies) : reports
  if (studies > reports)
    problems.push({ about: 'studies', text: 'More studies than reports of them.' })
  return {
    bySource,
    databases,
    registers,
    identified,
    removed,
    screened,
    excluded,
    sought,
    notRetrieved,
    assessed,
    reasons,
    reports,
    studies,
    screening: given(p.screenedOut) && numeric(p.screenedOut),
    problems,
  }
}

export type Tone = 'ok' | 'review' | 'fix' | 'na'

/** The work the numbers mean, in whole hours: half a minute a record screened, twenty minutes a
 *  full text read, two hours a study extracted and appraised. */
export function hours(f: Flow) {
  const screening = Math.ceil(f.screened / 120)
  const reading = Math.ceil(f.assessed / 3)
  const extracting = f.studies * 2
  return { screening, reading, extracting, total: screening + reading + extracting }
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What the numbers say about the topic's size, as a rough guide for a one-person review. */
export function verdict(f: Flow): { tone: Tone; head: string; body: string } {
  // Numbers that cannot be right say nothing about the topic: a typo that empties the flow would
  // otherwise draw advice on the topic.
  if (f.problems.length) return { tone: 'fix', head: 'Check the numbers', body: f.problems[0].text }
  if (!f.bySource.length && !f.registers)
    return {
      tone: 'na',
      head: 'Search first',
      body: 'Log how many records each source found (step 3); the size of your topic shows here.',
    }
  if (!f.identified)
    return {
      tone: 'review',
      head: 'Nothing found yet',
      body: 'No source has found a record. Widen the terms, or add sources or years, before you screen.',
    }
  const h = hours(f)
  if (!f.screening) {
    const time = `about ${count(h.screening, 'hour')} at half a minute a record`
    if (f.screened < 20)
      return {
        tone: 'review',
        head: 'Very few records',
        body: `Only ${f.screened} to screen. Add synonyms, sources or years before you screen, or the topic may be too narrow.`,
      }
    if (f.screened > 3000)
      return {
        tone: 'fix',
        head: 'Too many records to screen',
        body: `${f.screened.toLocaleString('en')} records is ${time}. Narrow the population, setting, years or terms first.`,
      }
    return {
      tone: 'ok',
      head: 'Ready to screen',
      body: `${f.screened.toLocaleString('en')} records to read by title and abstract: ${time}.`,
    }
  }
  const n = f.studies
  if (n === 0)
    return {
      tone: 'review',
      head: 'No study meets your criteria yet',
      body: 'Widen the years, study designs or terms, and check the criteria with your adviser. An empty review is a finding, but seldom a good first topic.',
    }
  // The work ahead, part by part, after the size; a part with no hours in it is left out.
  const work = [
    h.screening && `${h.screening} screening`,
    h.reading && `${h.reading} reading ${f.assessed === 1 ? 'the full text' : 'full texts'}`,
    `${h.extracting} extracting and appraising ${count(n, 'study', 'studies')}`,
  ].filter(Boolean)
  const say = (tone: Tone, head: string, body: string) => ({
    tone,
    head,
    body: `${body} About ${count(h.total, 'hour')} in all: ${work.join(', ')}.`,
  })
  if (n < 5)
    return say(
      'review',
      'Very few studies',
      `${count(n, 'study', 'studies')} would make a thin review. Widen the criteria, or keep the topic if the gap itself is the point.`,
    )
  if (n <= 40)
    return say(
      'ok',
      'A workable topic',
      `${n} studies is a body of evidence one person can read closely, extract and synthesise.`,
    )
  if (n <= 80)
    return say(
      'review',
      'A large review for one person',
      `${n} studies will take long to extract. Consider narrowing the population, setting, outcomes or years.`,
    )
  return say(
    'fix',
    'Too many studies for one review',
    `${n} studies. Narrow the population, setting, outcomes or years, or split the topic.`,
  )
}

// ---- Criteria and the checklist ----

const lines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/** What is wrong with the years as typed, in a few words; '' when they read right. */
export function yearNote(p: Plan, thisYear = new Date().getFullYear()): string {
  const bad = (s: string) => s.trim() && (!/^\d{4}$/.test(s.trim()) || Number(s) > thisYear + 1)
  if (bad(p.from) || bad(p.to)) return 'A year is four digits, up to next year.'
  if (p.from.trim() && p.to.trim() && Number(p.from) > Number(p.to))
    return 'The first year comes after the last.'
  return ''
}

export function criteria(p: Plan): { include: string[]; exclude: string[] } {
  const include = elementsOf(p)
    .filter((e) => val(p, e.id))
    .map((e) => `${e.name}: ${val(p, e.id)}`)
  const [from, to] = [p.from.trim(), p.to.trim()]
  if ((from || to) && !yearNote(p))
    include.push(
      `Published ${from && to ? `from ${from} to ${to}` : from ? `from ${from}` : `up to ${to}`}`,
    )
  if (p.languages.includes(ANY_LANGUAGE)) include.push(ANY_LANGUAGE)
  else if (p.languages.length) include.push(`Languages: ${p.languages.join(', ')}`)
  if (p.designs.length) include.push(`Study designs: ${p.designs.join(', ')}`)
  if (p.types.length) include.push(`Publication types: ${p.types.join(', ')}`)
  return { include: [...include, ...lines(p.include)], exclude: lines(p.exclude) }
}

const searchedSources = (p: Plan) => SOURCES.filter((s) => p.sources[s.id]?.on)

/** A date as the date field writes it (2025-09-15) in words, 15 September 2025; anything else as
 *  typed. */
export function dateWords(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return iso
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** What this plan already drafts for a checklist item, in a line or two; '' for the rest. */
export function drafted(p: Plan, id: string): string {
  switch (id) {
    case '1':
      return workingTitle(p)
    case '3':
      return [
        p.rationale.trim(),
        p.reviews.trim() && `Existing reviews: ${p.reviews.trim()}`,
        p.gaps.trim() && `Gaps: ${p.gaps.trim()}`,
      ]
        .filter(Boolean)
        .join(' ')
    case '4':
      return questionReady(p) ? `${objective(p)} Question: ${question(p)}` : ''
    case '5': {
      const c = criteria(p)
      return p.designs.length || p.types.length || p.from || c.exclude.length
        ? c.include.join('; ')
        : ''
    }
    case '6': {
      const named = searchedSources(p).map((s) => {
        const date = p.sources[s.id]?.date
        return `${s.name}${date ? ` (last searched ${dateWords(date)})` : ''}`
      })
      return [...named, p.others.trim()].filter(Boolean).join('; ')
    }
    case '7':
      return searchString(p) && searchedSources(p).length ? searchString(p) : ''
    case '8':
      return p.screener
    case '24a':
      return p.registered.trim()
    case '16a': {
      const f = flow(p)
      return f.screening
        ? `${f.identified} records identified, ${f.screened} screened, ${f.assessed} reports assessed, ${f.studies} studies included.`
        : ''
    }
    default:
      return ''
  }
}

export const STEPS = ['question', 'criteria', 'search', 'screen', 'plan'] as const
export type Step = (typeof STEPS)[number]

/** What a step still asks for, in a few words each; nothing when the step is done. */
export function missing(p: Plan, step: Step): string[] {
  switch (step) {
    case 'question':
      return elementsOf(p)
        .filter((e) => !e.optional && !val(p, e.id))
        .map((e) => `the ${e.name.toLowerCase()}`)
    case 'criteria': {
      const out: string[] = []
      if (!p.from.trim()) out.push('the first year')
      else if (yearNote(p)) out.push('years that read right')
      if (!p.designs.length && !p.types.length) out.push('a study design or publication type')
      return out
    }
    case 'search': {
      const out: string[] = []
      if (!searchString(p)) out.push('the question’s parts (step 1)')
      const used = searchedSources(p)
      if (!used.length) out.push('a source ticked')
      else if (
        !used.some((s) => {
          const { date, found = '' } = p.sources[s.id]!
          return date && given(found) && numeric(found)
        })
      )
        out.push('the date and the count for a source')
      // (the registers field is on this step too)
      if (!numeric(p.registers) || used.some((s) => !numeric(p.sources[s.id]?.found ?? '')))
        out.push('counts in digits')
      return out
    }
    case 'screen': {
      const f = flow(p)
      if (!f.identified) return ['the records each source found (step 3)']
      const out: string[] = []
      if (!f.screening) out.push('the number excluded by title and abstract')
      if (badNumbers(p).some((k) => k !== 'registers' && !k.startsWith('source:')))
        out.push('counts in digits')
      if (f.problems.length) out.push('numbers that add up (see the flow)')
      return out
    }
    case 'plan': {
      const left = MAIN.filter((i) => !(p.where[i.id] ?? '').trim()).length
      return left ? [`where ${left} of the ${MAIN.length} items will be reported`] : []
    }
  }
}

/** A step is done when what it asks for is written. */
export const done = (p: Plan, step: Step) => missing(p, step).length === 0

// ---- Kept on this device ----

const KEY = 'upou-topic-plan'

// A saved plan is read under known keys only, and nothing longer than a student would type: a
// tampered or swollen copy is cut down, never let in whole.
const ELEMENT_IDS = new Set(Object.values(KINDS).flatMap((k) => k.elements.map((e) => e.id)))
const SOURCE_IDS = new Set(SOURCES.map((s) => s.id))
const PRISMA_IDS = new Set([...MAIN, ...ABSTRACT].map((i) => i.id))
const isStr = (x: unknown): x is string => typeof x === 'string'
const cut = (s: string) => s.slice(0, 5_000)
const str = (x: unknown) => (isStr(x) ? cut(x) : undefined)
const strs = (x: unknown) => (Array.isArray(x) ? x.filter(isStr).map(cut).slice(0, 50) : undefined)
const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x)
/** A saved map under its known keys, each value as `take` reads it; left out when it reads none. */
function entries<T>(v: unknown, known: Set<string>, take: (x: unknown) => T | undefined) {
  const out: Partial<Record<string, T>> = {}
  if (isObj(v))
    for (const k of known) {
      const x = take(v[k])
      if (x !== undefined) out[k] = x
    }
  return out
}

/** A plan from whatever was saved: each field is taken only in the shape the page expects, so a
 *  damaged or tampered entry cannot break the tab, and the rest starts blank. */
export function sane(raw: unknown): Plan {
  const b = blank()
  if (!isObj(raw)) return b
  const text = (k: keyof Plan) => str(raw[k]) ?? ''
  const list = (k: keyof Plan) => strs(raw[k]) ?? []
  return {
    ...b,
    interest: text('interest'),
    title: text('title'),
    kind: isStr(raw.kind) && Object.hasOwn(KINDS, raw.kind) ? (raw.kind as Kind) : b.kind,
    parts: entries(raw.parts, ELEMENT_IDS, str),
    terms: entries(raw.terms, ELEMENT_IDS, strs),
    searched: entries(raw.searched, ELEMENT_IDS, (x) => (typeof x === 'boolean' ? x : undefined)),
    rationale: text('rationale'),
    reviews: text('reviews'),
    registered: text('registered'),
    from: text('from'),
    to: text('to'),
    languages: list('languages'),
    designs: list('designs'),
    types: list('types'),
    include: text('include'),
    exclude: text('exclude'),
    sources: entries(raw.sources, SOURCE_IDS, (s) =>
      isObj(s)
        ? { on: s.on === true, date: str(s.date), found: str(s.found), filters: str(s.filters) }
        : undefined,
    ),
    others: text('others'),
    screener: text('screener'),
    registers: text('registers'),
    duplicates: text('duplicates'),
    automation: text('automation'),
    removed: text('removed'),
    screenedOut: text('screenedOut'),
    notRetrieved: text('notRetrieved'),
    reasons: Array.isArray(raw.reasons)
      ? raw.reasons
          .filter(isObj)
          .slice(0, 30)
          .map((r) => ({ why: str(r.why) ?? '', n: str(r.n) ?? '' }))
      : b.reasons,
    studies: text('studies'),
    gaps: text('gaps'),
    where: entries(raw.where, PRISMA_IDS, str),
    abstract: entries(raw.abstract, PRISMA_IDS, (x) => (x === 'yes' || x === 'no' ? x : undefined)),
  }
}

export function load(): { plan: Plan; step: Step } {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (isObj(saved) && saved.plan)
      return {
        plan: sane(saved.plan),
        step: STEPS.includes(saved.step as Step) ? (saved.step as Step) : 'question',
      }
  } catch {
    // Storage blocked or the saved plan unreadable: start fresh.
  }
  return { plan: blank(), step: 'question' }
}

export function store(plan: Plan, step: Step) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ plan, step }))
  } catch {
    // Storage blocked (a private window): the plan lasts while the page is open.
  }
}
