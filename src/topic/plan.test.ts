// The Topic planner's sums and sentences: the question from its parts, the search string, the
// PRISMA flow numbers and the verdict on the topic's size, and the plan as a Word file.
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { planDocx } from './docx.ts'
import { MAIN } from './prisma.ts'
import {
  badNumbers,
  blank,
  criteria,
  dateWords,
  done,
  drafted,
  EXAMPLE,
  flow,
  hours,
  KINDS,
  missing,
  numeric,
  objective,
  question,
  questionPieces,
  sane,
  searchFor,
  searchString,
  SOURCES,
  verdict,
  workingTitle,
  yearNote,
  type Kind,
  type Plan,
} from './plan.ts'

const plan = (patch: Partial<Plan>): Plan => ({ ...blank(), ...patch })

describe('topic plan', () => {
  it('builds the question from its parts, with blanks for the parts not yet written', () => {
    const p = plan({ parts: { population: 'nurses', outcome: 'burnout' } })
    expect(questionPieces(p)).toContainEqual({ blank: 'intervention' })
    expect(question(p)).toBe('Among nurses, what is the effect of [intervention] on burnout?')
    expect(workingTitle(p)).toBe('')
    const full = plan({
      parts: { population: 'nurses', intervention: 'peer support', outcome: 'burnout' },
    })
    expect(question(full)).toBe('Among nurses, what is the effect of peer support on burnout?')
    expect(workingTitle(full)).toBe('Peer support and burnout among nurses: A Systematic Review')
    // The parts carry over to another kind of question; a scoping question names its review so.
    const scope = { ...full, kind: 'scope' as const, parts: { ...full.parts, concept: 'radio' } }
    expect(workingTitle(scope)).toBe('Radio among nurses: A Scoping Review')
  })

  it('reads right from messy parts: end stops and extra spaces gone, a proper noun kept', () => {
    const messy = plan({
      parts: {
        population: ' Filipino  nurses. ',
        intervention: 'peer support.',
        comparison: 'compared with usual care ,',
        outcome: 'burnout!',
        interest: 'night shifts:',
        context: 'In rural hospitals.',
        exposure: 'long shifts.',
        concept: 'peer support.',
      },
    })
    for (const kind of Object.keys(KINDS) as Kind[]) {
      const p = { ...messy, kind }
      for (const s of [question(p), workingTitle(p), objective(p)]) {
        expect(s).not.toMatch(/[.,;:?!]{2}|\s[.,;:?!]|\s{2}|\bin in\b|compared with compared/)
        expect(s).toContain('Filipino nurses')
      }
      expect(question(p)).toMatch(/\?$/)
      expect(objective(p)).toMatch(/\.$/)
    }
    expect(question({ ...messy, kind: 'effect' })).toBe(
      'Among Filipino nurses, what is the effect of peer support, compared with usual care, on burnout?',
    )
    expect(workingTitle({ ...messy, kind: 'association' })).toBe(
      'Long shifts and burnout among Filipino nurses: A Systematic Review',
    )
    expect(objective({ ...messy, kind: 'experience' })).toBe(
      'To synthesise qualitative evidence on how Filipino nurses experience night shifts in rural hospitals.',
    )
    expect(dateWords('2025-09-15')).toBe('15 September 2025')
    expect(dateWords('2025-13-01')).toBe('2025-13-01')
    expect(dateWords('soon')).toBe('soon')
  })

  it('joins synonyms with OR and the parts with AND, quoting phrases, leaving the comparison out', () => {
    const p = plan({
      parts: { population: 'nurses', intervention: 'peer support', comparison: 'usual care' },
      terms: { population: ['Nurses', 'midwives'], intervention: ['buddy system'] },
    })
    expect(searchString(p)).toBe('(nurses OR midwives) AND ("peer support" OR "buddy system")')
    expect(searchString({ ...p, searched: { comparison: true, population: false } })).toBe(
      '("peer support" OR "buddy system") AND "usual care"',
    )
  })

  it('writes the string as each database reads it, keeping a typed clause as typed', () => {
    const s = searchString(EXAMPLE)
    expect(searchFor(EXAMPLE, 'pubmed')).toBe(
      '("learners in online distance education"[tiab] OR "distance education"[tiab] OR "online learning"[tiab] OR e-learning[tiab]) AND ("gamified learning activities"[tiab] OR gamification[tiab] OR "game-based learning"[tiab] OR "serious games"[tiab]) AND ("learner engagement"[tiab] OR engagement[tiab] OR motivation[tiab] OR participation[tiab])',
    )
    expect(searchFor(EXAMPLE, 'scopus')).toBe(`TITLE-ABS-KEY(${s})`)
    expect(searchFor(EXAMPLE, 'wos')).toBe(`TS=(${s})`)
    expect(searchFor(EXAMPLE, 'eric')).toBe(s)
    expect(searchFor(EXAMPLE, 'upload')).toBe(s)
    expect(searchFor(blank(), 'scopus')).toBe('')
    const own = plan({
      parts: { population: 'student “nurses”' },
      terms: { population: ['peer "support"', 'nurse* OR midwi*', '(student nurses)'] },
    })
    expect(searchString(own)).toBe(
      '("student nurses" OR "peer support" OR (nurse* OR midwi*) OR (student nurses))',
    )
    expect(searchFor(own, 'pubmed')).toBe(
      '("student nurses"[tiab] OR "peer support"[tiab] OR (nurse* OR midwi*) OR (student nurses))',
    )
    // The UPOU sources come first and open the plain string.
    expect(SOURCES.slice(0, 2).map((x) => x.id)).toEqual(['upload', 'ijodel'])
    expect(SOURCES[0].url!('a b')).toBe('https://repository.upou.edu.ph/search?query=a%20b')
  })

  it('carries the numbers down the PRISMA flow and judges the topic by them', () => {
    const f = flow(EXAMPLE)
    expect(f).toMatchObject({ identified: 646, screened: 525, sought: 84, assessed: 78 })
    expect(f.studies).toBe(23)
    expect(verdict(f).tone).toBe('ok')
    expect(done(EXAMPLE, 'screen')).toBe(true)
    // Before screening, the guide is the reading ahead; too many records, narrow first.
    const big = plan({ sources: { eric: { on: true, found: '5,200' } } })
    expect(verdict(flow(big))).toMatchObject({ tone: 'fix', head: 'Too many records to screen' })
    // Numbers that cannot be right are named, not shown as negatives.
    const wrong = flow(plan({ sources: { eric: { on: true, found: '10' } }, duplicates: '12' }))
    expect(wrong.screened).toBe(0)
    expect(wrong.problems).toEqual([
      { about: 'removed', text: 'More records are removed than were identified.' },
    ])
    expect(verdict(wrong)).toEqual({
      tone: 'fix',
      head: 'Check the numbers',
      body: 'More records are removed than were identified.',
    })
    const more = flow(
      plan({ sources: { eric: { on: true, found: '10' } }, screenedOut: '5', studies: '7' }),
    )
    expect(more.studies).toBe(7)
    expect(more.problems).toEqual([
      { about: 'studies', text: 'More studies than reports of them.' },
    ])
    // A reason row without a count is still to fill; one with a count and no words is "Other".
    expect(flow(EXAMPLE).reasons).toHaveLength(5)
    expect(
      flow(
        plan({
          reasons: [
            { why: 'Wrong population', n: '' },
            { why: '', n: '3' },
          ],
        }),
      ).reasons,
    ).toEqual([{ why: 'Other reason', n: 3 }])
    // No source logged: search first. A source logged that found nothing: a different matter.
    expect(verdict(flow(plan({}))).tone).toBe('na')
    expect(verdict(flow(plan({ sources: { eric: { on: true, found: '0' } } })))).toMatchObject({
      tone: 'review',
      head: 'Nothing found yet',
    })
  })

  it('counts the hours of work once screening has begun', () => {
    const f = flow(EXAMPLE)
    expect(hours(f)).toEqual({ screening: 5, reading: 26, extracting: 46, total: 77 })
    expect(verdict(f).body).toMatch(
      / About 77 hours in all: 5 screening, 26 reading full texts, 46 extracting and appraising 23 studies\.$/,
    )
    const before = plan({ sources: { eric: { on: true, found: '400' } } })
    expect(verdict(flow(before)).body).toBe(
      '400 records to read by title and abstract: about 4 hours at half a minute a record.',
    )
    const one = flow({ ...before, sources: { eric: { on: true, found: '30' } }, screenedOut: '29' })
    expect(verdict(one).body).toMatch(
      /^1 study would make a thin review.* About 4 hours in all: 1 screening, 1 reading the full text, 2 extracting and appraising 1 study\.$/,
    )
  })

  it('writes the criteria: "Any language" alone, the years trimmed and only when they read right', () => {
    expect(criteria(plan({ languages: ['English', 'Any language'] })).include).toEqual([
      'Any language',
    ])
    expect(criteria(plan({ languages: ['English'] })).include).toEqual(['Languages: English'])
    expect(criteria(plan({ from: ' 2015 ', to: '2025' })).include).toEqual([
      'Published from 2015 to 2025',
    ])
    expect(criteria(plan({ from: '20x5' })).include).toEqual([])
  })

  it('names the counts not typed in digits, at their field and in the step hint', () => {
    expect(numeric('1, 200')).toBe(true)
    expect(numeric('')).toBe(true)
    expect(numeric('1.2k')).toBe(false)
    const p = plan({
      parts: { population: 'nurses', intervention: 'peer support', outcome: 'burnout' },
      sources: { eric: { on: true, date: '2025-09-15', found: 'about 400' } },
      screenedOut: '1.2k',
      reasons: [{ why: 'Wrong population', n: 'a few' }],
    })
    expect(badNumbers(p)).toEqual(['screenedOut', 'reason:0', 'source:eric'])
    expect(flow(p).identified).toBe(0)
    expect(missing(p, 'search')).toEqual([
      'the date and the count for a source',
      'counts in digits',
    ])
    const q = { ...p, sources: { eric: { on: true, date: '2025-09-15', found: '400' } } }
    expect(missing(q, 'search')).toEqual([])
    // A count that is not a number has not begun the screening either.
    expect(flow(q).screening).toBe(false)
    expect(missing(q, 'screen')).toEqual([
      'the number excluded by title and abstract',
      'counts in digits',
    ])
    // Only digits count: not a float, an exponent or hex that Number() would take.
    const odd = plan({ sources: { eric: { on: true, found: '1e3' } }, registers: '0x10' })
    expect(flow(odd).identified).toBe(0)
  })

  it('drafts the checklist items the plan already answers', () => {
    expect(drafted(EXAMPLE, '1')).toMatch(/: A Systematic Review$/)
    expect(drafted(EXAMPLE, '6')).toMatch(/Google Scholar \(last searched 15 September 2025\)/)
    expect(drafted(EXAMPLE, '16a')).toBe(
      '646 records identified, 525 screened, 78 reports assessed, 23 studies included.',
    )
    expect(drafted(EXAMPLE, '11')).toBe('')
    // A publication type alone is enough for step 2, so it drafts item 5 too.
    expect(drafted(plan({ types: ['Preprints'] }), '5')).toBe('Publication types: Preprints')
  })

  it('says what each step still asks for, and reads the years', () => {
    expect(missing(blank(), 'question')).toEqual([
      'the population',
      'the intervention',
      'the outcome',
    ])
    expect(missing(EXAMPLE, 'question')).toEqual([])
    expect(missing(EXAMPLE, 'plan')).toEqual(['where 42 of the 42 items will be reported'])
    expect(yearNote(plan({ from: '2015', to: '2025' }), 2026)).toBe('')
    expect(yearNote(plan({ from: '2030' }), 2026)).toBe('A year is four digits, up to next year.')
    expect(yearNote(plan({ from: '20x5' }), 2026)).toBe('A year is four digits, up to next year.')
    expect(yearNote(plan({ from: '2020', to: '2015' }), 2026)).toBe(
      'The first year comes after the last.',
    )
    expect(done(plan({ from: '2020', to: '2015', designs: ['Case studies'] }), 'criteria')).toBe(
      false,
    )
  })

  it('takes a saved plan only in the shape the page expects', () => {
    const p = sane({
      interest: 5,
      kind: 'nope',
      parts: { population: 'nurses', outcome: 3 },
      languages: 'English',
      designs: ['Case studies', 7],
      reasons: [{ why: 1 }, 'x'],
      sources: { eric: { on: 'yes', found: '10' } },
      abstract: { A1: 'maybe', A2: 'yes' },
      where: null,
    })
    expect(p).toMatchObject({
      interest: '',
      kind: 'effect',
      parts: { population: 'nurses' },
      languages: [],
      designs: ['Case studies'],
      reasons: [{ why: '', n: '' }],
      sources: { eric: { on: false, found: '10' } },
      abstract: { A2: 'yes' },
      where: {},
    })
    expect(sane('garbage')).toEqual(blank())
  })

  it('keeps only the known keys of a saved plan and cuts what is too long', () => {
    // (parsed, not written as a literal: that is how a saved copy carries an own __proto__ key)
    const raw = JSON.parse(
      `{"__proto__": {"polluted": true}, "kind": "constructor", "interest": ${JSON.stringify('x'.repeat(100_000))}, "parts": {"__proto__": {"polluted": true}, "constructor": "x", "junk": "y", "population": "nurses"}, "terms": {"population": ${JSON.stringify(Array(80).fill('n'))}, "junk": ["a"]}, "sources": {"__proto__": {"on": true}, "eric": {"on": true, "found": "1"}, "ijodel": {"on": true}}, "where": {"1": "p. 1", "junk": "x"}, "abstract": {"A1": "yes", "constructor": "yes"}, "reasons": ${JSON.stringify(Array(40).fill({ why: 'w', n: '1' }))}}`,
    )
    const p = sane(raw)
    expect(p.kind).toBe('effect')
    expect(p.interest).toHaveLength(5_000)
    expect(Object.keys(p.parts)).toEqual(['population'])
    expect(Object.getPrototypeOf(p.parts)).toBe(Object.prototype)
    expect(Object.keys(p.terms)).toEqual(['population'])
    expect(p.terms.population).toHaveLength(50)
    expect(Object.keys(p.sources).sort()).toEqual(['eric', 'ijodel'])
    expect(Object.keys(p.where)).toEqual(['1'])
    expect(Object.keys(p.abstract)).toEqual(['A1'])
    expect(p.reasons).toHaveLength(30)
  })

  it('writes the plan as a Word file with the whole checklist', () => {
    const files = unzipSync(planDocx(EXAMPLE))
    const xml = strFromU8(files['word/document.xml'])
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    expect(xml).toContain('Gamified learning activities and learner engagement')
    expect(xml).toContain('Location where item is reported')
    expect(xml).toContain('Identify the report as a systematic review.')
    expect(xml).toContain('METHODS: Eligibility criteria')
    // A line break typed in a field is a break in Word, not a newline it would ignore.
    const broken = planDocx({ ...EXAMPLE, rationale: 'First.\nSecond.' })
    const two = strFromU8(unzipSync(broken)['word/document.xml'])
    expect(two).toContain('First.</w:t></w:r><w:r><w:br/></w:r><w:r>')
    expect(two).not.toContain('First.\nSecond.')
  })

  it('keeps the Word file well formed whatever is typed in any field', () => {
    const bad = `<b>&"']]>\u0007\u202E\n${'x'.repeat(10_000)}😀`
    const each = <T>(keys: string[], v: T) => Object.fromEntries(keys.map((k) => [k, v]))
    const ids = Object.values(KINDS).flatMap((k) => k.elements.map((e) => e.id))
    const p = blank()
    for (const k of Object.keys(p) as (keyof Plan)[])
      if (k !== 'kind' && typeof p[k] === 'string') (p as Record<keyof Plan, unknown>)[k] = bad
    Object.assign(p, {
      languages: [bad],
      designs: [bad],
      types: [bad],
      parts: each(ids, bad),
      terms: each(ids, [bad]),
      sources: each(
        SOURCES.map((s) => s.id),
        { on: true, date: bad, found: bad, filters: bad },
      ),
      reasons: [{ why: bad, n: bad }],
      where: each(
        MAIN.map((i) => i.id),
        bad,
      ),
    } satisfies Partial<Plan>)
    const files = unzipSync(planDocx(p))
    for (const name of Object.keys(files).filter((n) => /\.(xml|rels)$/.test(n))) {
      const xml = strFromU8(files[name])
      const open: string[] = []
      for (const m of xml.matchAll(/<(\/?)([\w:.-]+)[^<>]*?(\/?)>/g)) {
        if (m[3]) continue
        if (m[1]) expect(open.pop()).toBe(m[2])
        else open.push(m[2])
      }
      expect(open).toEqual([])
      const text = xml.replace(/<[^<>]*>/g, '')
      expect(text).not.toMatch(/</)
      expect(text).not.toMatch(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/)
      for (const m of xml.matchAll(/<w:tc>(.*?)<\/w:tc>/gs)) expect(m[1]).toContain('<w:p>')
      const controls = [...xml.matchAll(/\p{Cc}/gu)].map((m) => m[0])
      expect(controls.filter((c) => !'\t\n\r'.includes(c))).toEqual([])
    }
  })
})
