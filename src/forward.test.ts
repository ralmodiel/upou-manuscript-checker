import { expect, it } from 'vitest'
import forward from '../public/topic-forward.js?raw'

it('moves the planner’s saved data to the new site’s keys and forwards #topic there', () => {
  const store = new Map([
    ['upou-topic-plans', 'plans'],
    ['upou-topic-ai', '1'],
    ['upou-topic-ai-verified', 'v'],
    ['upou-topic-plan', 'old'],
    ['topic-plan', 'kept'], // the new site already has its own: the old one stays where it is
  ])
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
  let to = ''
  const location = { hash: '#topic', replace: (u: string) => void (to = u) }
  new Function('localStorage', 'location', forward)(localStorage, location)
  expect(Object.fromEntries(store)).toEqual({
    'topic-plans': 'plans',
    'topic-ai': '1',
    'topic-ai-verified': 'v',
    'upou-topic-plan': 'old',
    'topic-plan': 'kept',
  })
  expect(to).toBe('https://ralmodiel.github.io/concept-topic-planner/')
})
