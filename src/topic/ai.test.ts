// The topic planner's suggestions: what the prompts ask for, and how the model's answers are read.
import { describe, expect, it } from 'vitest'
import {
  loadModel,
  partsPrompt,
  readList,
  readParts,
  readTitles,
  termsPrompt,
  titlesPrompt,
} from './ai.ts'

const PICO = [
  { id: 'population', name: 'Population', hint: 'Who', example: 'nurses in rural clinics' },
  { id: 'intervention', name: 'Intervention', hint: 'What', example: 'peer support groups' },
  { id: 'comparison', name: 'Comparison', hint: 'Against', example: 'usual care', optional: true },
  { id: 'outcome', name: 'Outcome', hint: 'Changes', example: 'burnout' },
]
describe('topic planner suggestions', () => {
  it('reads a list from the model’s JSON, or its lines, without repeats, the words to avoid, or the part itself reworded', () => {
    expect(
      readList(
        'Here you go: ["Online learning", "e-learning", "online learning", "distance education"] done',
        ['Distance education'],
      ),
    ).toEqual(['Online learning', 'e-learning'])
    expect(readList('- gamification\n2. game-based learning\n• "serious games",\n```')).toEqual([
      'gamification',
      'game-based learning',
      'serious games',
    ])
    // The part's own words in another order or form are no other term; a part of them is.
    const within = 'gamified learning activities'
    const text =
      '["GAMIFIED LEARNING ACTIVITY", "activities, gamified learning", "serious games", "the"]'
    expect(readList(text, [], 8, within)).toEqual(['serious games'])
    expect(readList('["online learning"]', [], 8, 'learners in online distance education')).toEqual(
      ['online learning'],
    )
    expect(readList('["small farmers"]', [], 8, 'smallholder farmers')).toEqual(['small farmers'])
    // Objects or nested lists in the answer: their strings, one by one.
    expect(
      readList(
        '[{"term": "distance", "synonyms": ["distance learning", "online education"]}]',
        [],
        8,
        'learners in online distance education',
      ),
    ).toEqual(['distance', 'distance learning', 'online education'])
    expect(readList('')).toEqual([])
    // Python's quotes, a trailing comma, a plain comma list: read all the same.
    expect(readList("['serious games', 'game-based learning']")).toEqual([
      'serious games',
      'game-based learning',
    ])
    expect(readList('["serious games", "game-based learning",]')).toEqual([
      'serious games',
      'game-based learning',
    ])
    expect(readList('serious games, game-based learning, gamification')).toEqual([
      'serious games',
      'game-based learning',
      'gamification',
    ])
    // An acronym is a word of its own.
    expect(readList('["VR", "virtual reality"]', [], 8, 'immersive learning')).toEqual([
      'VR',
      'virtual reality',
    ])
  })

  it('reads the question’s parts from a JSON object, dropping what the model did not know or made up', () => {
    const ids = PICO.map((e) => e.id)
    const text =
      '{"population": "Online learners", "intervention": "gamification", "comparison": "traditional classes", "outcome": "Not stated"}'
    expect(readParts(text, ids)).toEqual({
      population: 'online learners',
      intervention: 'gamification',
      comparison: 'traditional classes',
    })
    // With the sentence: a comparison it does not mention is the model's invention.
    expect(
      readParts(text, ids, 'whether gamification improves engagement of online learners'),
    ).toEqual({ population: 'online learners', intervention: 'gamification' })
    // A question word alone ("whether") is no part.
    expect(
      readParts(
        '{"population": "online learners", "comparison": "whether", "outcome": "engagement"}',
        ids,
        'whether gamification improves engagement of online learners',
      ),
    ).toEqual({ population: 'online learners', outcome: 'engagement' })
    expect(readParts('no json here', ids)).toEqual({})
    expect(readParts("{'population': 'online learners', 'outcome': 'engagement',}", ids)).toEqual({
      population: 'online learners',
      outcome: 'engagement',
    })
    // A two-letter acronym is a part in its own right, and keeps its capitals.
    expect(
      readParts(
        '{"intervention": "AI", "outcome": "grades"}',
        ids,
        'does AI tutoring raise grades',
      ),
    ).toEqual({ intervention: 'AI', outcome: 'grades' })
    // A capital the sentence gives a word away from its start is a name's, and stays.
    expect(
      readParts(
        '{"population": "Filipino nurses", "intervention": "Peer support"}',
        ids,
        'Does peer support reduce burnout among Filipino nurses?',
      ),
    ).toEqual({ population: 'Filipino nurses', intervention: 'peer support' })
  })

  it('reads up to three tidy titles, each once, not the one the student has, and on the question', () => {
    const text =
      '```json\n[\n "Peer support and burnout among rural nurses: a systematic review.",\n "peer support and burnout among rural nurses: A Systematic Review",\n "Burnout in rural clinics: a systematic review",\n "' +
      'x'.repeat(141) +
      '",\n "Nurses and peer support: a systematic review",\n "Another one: a systematic review"\n]\n```'
    expect(readTitles(text, 'Burnout in rural clinics: a systematic review')).toEqual([
      'Peer support and burnout among rural nurses: a systematic review',
      'Nurses and peer support: a systematic review',
      'Another one: a systematic review',
    ])
    expect(
      readTitles('1. First title: a scoping review\n2. Second title: a scoping review'),
    ).toEqual(['First title: a scoping review', 'Second title: a scoping review'])
    // With the question: a title about something else (the model drifting) is left out.
    expect(
      readTitles(
        '["Peer support and burnout among rural nurses: a systematic review", "Exam scores of nursing students: a systematic review", "Rural nurses and peer support: a review"]',
        undefined,
        'Among rural nurses, does peer support reduce burnout?',
      ),
    ).toEqual([
      'Peer support and burnout among rural nurses: a systematic review',
      'Rural nurses and peer support: a review',
    ])
    expect(readTitles('')).toEqual([])
  })

  it('strips control and format characters from whatever the model gives', () => {
    // A zero-width joiner, a right-to-left override and a NUL, in each reader.
    expect(readList('["on‍line learning", "‮serious games\u0000", "e​learning"]')).toEqual([
      'online learning',
      'serious games',
      'elearning',
    ])
    expect(readParts('{"population": "nur‍ses\u0000 in\nrural clinics"}', ['population'])).toEqual({
      population: 'nurses in rural clinics',
    })
    expect(readTitles('["‮Burnout: a systematic review\u0000"]')).toEqual([
      'Burnout: a systematic review',
    ])
    // Composed and decomposed letters meet as one form.
    expect(readList('["café", "café"]')).toEqual(['café'])
  })

  it('rejects, rather than throws, when the browser will not start the worker', async () => {
    // (no Worker here: the switch must hear the failure and come back)
    await expect(loadModel(() => {})).rejects.toThrow()
  })

  it('asks for JSON, with a worked example built from the parts, and cuts a huge paste', () => {
    expect(termsPrompt('Population', 'nurses').user).toMatch(/JSON array/)
    expect(termsPrompt('Population', 'n'.repeat(500)).user.length).toBeLessThan(700)
    const p = partsPrompt('games in class', PICO)
    expect(p.user).toContain('"population"')
    expect(p.user).toContain('"comparison":""')
    expect(p.user).toContain('peer support groups and burnout among nurses in rural clinics')
    expect(partsPrompt('x'.repeat(5000), PICO).user.length).toBeLessThan(2000)
    const t = titlesPrompt('Does peer support reduce burnout?', 'scoping review')
    expect(t.user).toContain('a scoping review')
    expect(t.user).toContain('"Does peer support reduce burnout?"')
    expect(t.user).toMatch(/JSON array of 3 strings/)
    expect(titlesPrompt('x'.repeat(5000), 'systematic review').user.length).toBeLessThan(1500)
  })
})
