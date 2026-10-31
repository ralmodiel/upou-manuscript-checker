// Suggestions from a small language model run in this browser: the question's parts read from a
// sentence, other words for a part of the search, and title ideas for the review. Only after the
// student turns it on: the model (about 790 MB) is fetched once from Hugging Face and kept in the
// browser's cache, and runs on the device's graphics chip (WebGPU). What the student types goes to
// the model here and nowhere else. This file holds the prompts, the readers of the answers and the
// bridge to the worker (ai.worker.ts), where the model itself runs.
//
// Tried on the real model and dropped, as exclusion criteria were before (2026-11-01): naming the
// kind of question (right 2 of 4 times; the model leans to "effect"), picking the sources for a
// question (2 of 4, education sources for everything) and rewriting the student's rationale (it
// adds facts in 3 of 4).

export const MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct'
/** The commit of the model's files that was tested (2026-10-07): the planner fetches these and
 *  not whatever the model's main branch holds later. */
export const MODEL_REVISION = '22942cb7d7ba4cc81bb4673549ca4d4614469b5e'
export const MODEL_NAME = 'Qwen2.5-0.5B-Instruct'
// (the 4-bit weights with full-precision sums, 786 MB with the tokenizer: the half-precision
// form is smaller but answers in nonsense on some graphics chips)
export const MODEL_MB = 790
export const MODEL_LICENCE = 'Apache-2.0'
export const MODEL_URL = `https://huggingface.co/${MODEL}`

export interface Prompt {
  system: string
  user: string
  /** Tokens allowed for the answer. */
  max: number
}

// A small model answers best to a plain ask with one worked example; the readers below drop what
// it makes up anyway, and the page offers the rest as choices.
const SYSTEM =
  'You help a graduate student plan a systematic review. Reply with the JSON asked for and nothing else: no explanation, no markdown fences.'

// What the student typed goes into a prompt cut to a sane length: a huge paste would only tie up
// their own chip for minutes.
const cut = (s: string, n: number) => s.slice(0, n)

/** Other words for one part of the question, as databases and papers use them. */
export function termsPrompt(name: string, part: string): Prompt {
  part = cut(part, 200)
  return {
    system: SYSTEM,
    user: `For a literature search, list 6 other terms for "${part}" (the ${name.toLowerCase()} of the review): synonyms, narrower and broader terms, and British or American spellings, as papers and databases use them. Short phrases only; stay on this meaning, and do not repeat "${part}".\nReply with a JSON array of strings.`,
    max: 120,
  }
}

/** The question's parts read from the student's own sentence. */
export function partsPrompt(
  interest: string,
  elements: { id: string; name: string; hint: string; example: string; optional?: boolean }[],
): Prompt {
  const stated = elements.filter((e) => !e.optional)
  const sample = Object.fromEntries(elements.map((e) => [e.id, e.optional ? '' : e.example]))
  const description = `${stated
    .filter((e) => e.id !== 'population')
    .map((e) => e.example)
    .join(' and ')} among ${stated.find((e) => e.id === 'population')?.example ?? 'people'}`
  return {
    system: SYSTEM,
    user: `Read a student's description of a topic and write the parts of the review question as short noun phrases (never a verb) taken from the description. If the description does not state a part, write "" rather than guessing.\nParts: ${elements.map((e) => `"${e.id}" = ${e.name} (${e.hint.toLowerCase()})`).join('; ')}.\nExample description: "${description}"\nExample reply: ${JSON.stringify(sample)}\nDescription: "${cut(interest, 1000)}"\nReply with a JSON object with exactly the keys ${elements.map((e) => `"${e.id}"`).join(', ')}.`,
    max: 140,
  }
}

/** Three titles for the review, in the question's own words. (A worked title in the prompt was
 *  tried and dropped: its words crept into the titles of every other topic.) */
export const titlesPrompt = (question: string, review: string): Prompt => ({
  system: SYSTEM,
  user: `Write 3 different titles for a ${review} of this question: "${cut(question, 1000)}"\nA title states the topic and the people in the question's own words, then a colon and "a ${review}". Do not add topics, methods or outcomes that are not in the question. No title is a question.\nReply with a JSON array of 3 strings.`,
  max: 120,
})

// ---- Reading the answers ----

/** The JSON between the outermost brackets of the answer. A control character inside a string,
 *  Python's quotes or a trailing comma are not JSON, but are read all the same. */
function jsonBetween(text: string, open: string, close: string): unknown {
  const a = text.indexOf(open)
  const b = text.lastIndexOf(close)
  if (a < 0 || b <= a) return undefined
  const s = text.slice(a, b + 1).replace(/\p{Cc}/gu, ' ')
  for (const t of [s, s.replace(/'/g, '"').replace(/,\s*([\]}])/g, '$1')])
    try {
      return JSON.parse(t)
    } catch {
      // (the next form)
    }
  return undefined
}

/** Text as the model gave it, made safe to show: format characters (a zero-width joiner, a
 *  direction override) dropped, control characters (a NUL, a line break) made spaces, one normal
 *  form, spaces collapsed. */
const clean = (s: string) =>
  s
    .replace(/\p{Cf}+/gu, '')
    .replace(/\p{Cc}+/gu, ' ')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()

/** One item of an answer: clean, without a list marker, quotes or closing punctuation. */
const tidy = (s: string) =>
  clean(s)
    .replace(/^(?:[-*•]|\d+[.)])\s*/, '')
    .replace(/^["'“”‘’\s]+|["'“”‘’\s,.;:]+$/g, '')
    .trim()

const STOP = new Set(
  'the a an and or of in on for with among to at by from as that this their its who are is be not whether how does do did what which when where why if than then'.split(
    ' ',
  ),
)
/** A phrase's content words (an acronym of two capitals counts, "AI" or "VR"), cut to six letters
 *  so "learner" meets "learners". */
const stems = (s: string) =>
  (s.match(/\p{Lu}{2,}|\p{L}{3,}/gu) ?? [])
    .map((w) => w.toLowerCase())
    .filter((w) => !STOP.has(w))
    .map((w) => w.slice(0, 6))

/** Every string in a value: a list's items, an object's values, nested as they come. */
const strings = (v: unknown): string[] =>
  typeof v === 'string'
    ? [v]
    : Array.isArray(v)
      ? v.flatMap(strings)
      : v && typeof v === 'object'
        ? Object.values(v).flatMap(strings)
        : []

/** A list from the answer: its JSON array, else its lines; short, without repeats, the words to
 *  avoid, or (given `within`) a mere reordering or re-inflection of that phrase. */
export function readList(text: string, avoid: string[] = [], limit = 8, within?: string): string[] {
  const raw = jsonBetween(text, '[', ']')
  const items = Array.isArray(raw) ? strings(raw) : text.replace(/[[\]]/g, '').split(/\n|;|,/)
  const seen = new Set(avoid.map((a) => a.toLowerCase()))
  const own = within ? new Set(stems(within)) : undefined
  return items
    .map(tidy)
    .filter((s) => {
      if (!s || s.length > 70 || /^(json|```)/i.test(s) || seen.has(s.toLowerCase())) return false
      const ws = stems(s)
      // (the same words as the part, reordered or re-inflected: no other term)
      if (!ws.length || (own && ws.length === own.size && ws.every((w) => own.has(w)))) return false
      seen.add(s.toLowerCase())
      return true
    })
    .slice(0, limit)
}

/** The word carries its capital somewhere in the sentence other than at a sentence's start: a
 *  name, which keeps it. */
const capitalIn = (s: string, w: string) => {
  for (let i = s.indexOf(w); i >= 0; i = s.indexOf(w, i + 1)) {
    const before = s.slice(0, i).trimEnd()
    if (before && !/[.!?:]$/.test(before)) return true
  }
  return false
}

/** The question's parts from the answer's JSON object: a short phrase for each key given. With the
 *  student's sentence, a phrase whose words are mostly not in it (one the model made up) is left
 *  out. A phrase starts in lower case, as it will sit inside the question, unless the sentence
 *  itself capitalises its first word away from a sentence's start (a name). */
export function readParts(text: string, ids: string[], source?: string): Record<string, string> {
  const raw = jsonBetween(text, '{', '}')
  const out: Record<string, string> = {}
  const said = source ? new Set(stems(source)) : undefined
  if (raw && typeof raw === 'object')
    for (const id of ids) {
      const v = (raw as Record<string, unknown>)[id]
      if (typeof v !== 'string') continue
      const t = tidy(v)
      if (
        !t ||
        t.length > 80 ||
        t.split(' ').length > 8 ||
        /^(none|n\/a|not stated|not specified|unknown|null)$/i.test(t)
      )
        continue
      if (said) {
        const ws = stems(t)
        if (!ws.length || ws.filter((w) => said.has(w)).length < 0.7 * ws.length) continue
      }
      const name = source ? capitalIn(source, t.match(/^\p{L}+/u)?.[0] ?? t) : false
      out[id] = /^[A-Z][a-z]/.test(t) && !name ? t[0].toLowerCase() + t.slice(1) : t
    }
  return out
}

/** Up to three titles from the answer's JSON array, else its lines: tidy, short, each once, not
 *  the title the student already has. With the question, a title whose words are mostly not in
 *  it (the model drifting to another topic) is left out. */
export function readTitles(text: string, avoid?: string, question?: string): string[] {
  const raw = jsonBetween(text, '[', ']')
  const items = Array.isArray(raw) ? strings(raw) : text.split('\n')
  const seen = new Set(avoid ? [tidy(avoid).toLowerCase()] : [])
  // (the words a title adds to the question's own: the kind of review, and little else)
  const said = question ? new Set([...stems(question), 'review', 'system', 'scopin']) : undefined
  return items
    .map(tidy)
    .filter((t) => {
      if (!t || t.length > 140 || /^(json|```)/i.test(t) || seen.has(t.toLowerCase())) return false
      if (said) {
        const ws = stems(t)
        if (!ws.length || ws.filter((w) => said.has(w)).length < (2 / 3) * ws.length) return false
      }
      seen.add(t.toLowerCase())
      return true
    })
    .slice(0, 3)
}

// ---- The bridge to the worker ----

export type Phase = 'off' | 'loading' | 'ready' | 'error'
export interface Progress {
  loaded: number
  total: number
  /** Fetching the files, then preparing the chip's programs for them (the first answer). */
  stage?: 'fetching' | 'preparing'
}

/** What a finished request brings back: an answer; after a load, whether the chip passed the
 *  probe and the files their check this time. */
interface Done {
  result?: string
  probed?: boolean
  verified?: boolean
}
type Reply =
  | { id: number; type: 'progress'; file: string; loaded: number; total: number }
  | { id: number; type: 'stage'; stage: 'preparing' }
  | ({ id: number; type: 'done' } & Done)
  | { id: number; type: 'error'; message: string }

interface Adapter {
  info?: { vendor?: string; architecture?: string; device?: string; description?: string }
}
type Gpu = { requestAdapter(): Promise<Adapter | null> }

/** WebGPU, which the model needs. */
export const supported = () => 'gpu' in navigator

// The graphics chip the browser offers, asked for once: WebGPU may be there with no adapter.
let adapter: Promise<Adapter | null> | undefined
const getAdapter = () =>
  (adapter ??= supported()
    ? (navigator as unknown as { gpu: Gpu }).gpu.requestAdapter().catch(() => null)
    : Promise.resolve(null))

/** A graphics chip the browser will hand the model to. */
export const usable = async () => !!(await getAdapter())

/** The graphics chip as the browser names it: a probe passed on this chip is not repeated, but
 *  another chip (a new device, a changed driver) is probed afresh. */
async function chip(): Promise<string | undefined> {
  const info = (await getAdapter())?.info
  return info && [info.vendor, info.architecture, info.device, info.description].join('|')
}

// What this browser already found out about the model, so the next load skips it.
const PROBED = 'upou-topic-ai-probe'
const VERIFIED = 'upou-topic-ai-verified'
const stored = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage blocked: the check just runs again next time.
  }
}

let worker: Worker | undefined
let seq = 0
const waiting = new Map<
  number,
  {
    resolve: (r: Done) => void
    reject: (e: Error) => void
    progress?: (p: Progress) => void
    files: Map<string, Progress>
  }
>()

/** Ends the worker, and with it the model and the chip's memory it held; whoever was waiting
 *  hears why. */
function drop(why: string) {
  for (const w of waiting.values()) w.reject(new Error(why))
  waiting.clear()
  worker?.terminate()
  worker = undefined
}

/** Turns the model off. The next load reads the browser's cache, so it is quick. */
export const unloadModel = () => drop('The model was turned off.')

function start(): Worker {
  const w = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<Reply>) => {
    const m = e.data
    const w = waiting.get(m.id)
    if (!w) return
    if (m.type === 'progress' || m.type === 'stage') {
      // (the files of the model, each reported on its own: the sum so far, measured against the
      // whole from the start, so the bar does not fill on the first small file)
      if (m.type === 'progress') w.files.set(m.file, { loaded: m.loaded, total: m.total })
      const all = [...w.files.values()]
      w.progress?.({
        loaded: all.reduce((a, f) => a + f.loaded, 0),
        total: Math.max(
          all.reduce((a, f) => a + f.total, 0),
          MODEL_MB * 1e6,
        ),
        stage: m.type === 'stage' ? m.stage : 'fetching',
      })
      return
    }
    waiting.delete(m.id)
    if (m.type === 'error') w.reject(new Error(m.message))
    else w.resolve(m)
  }
  w.onerror = (e) => drop(e.message || 'The model could not be started.')
  return w
}

// (a worker the browser refuses to start throws here, and the promise carries it to the page)
const ask = (message: object, progress?: (p: Progress) => void): Promise<Done> =>
  new Promise((resolve, reject) => {
    worker ??= start()
    const id = ++seq
    waiting.set(id, { resolve, reject, progress, files: new Map() })
    worker.postMessage({ ...message, id })
  })

/** Fetches the model (once; the browser caches it) and readies it. */
export async function loadModel(progress: (p: Progress) => void): Promise<void> {
  const key = await chip()
  const r = await ask(
    {
      type: 'load',
      device: 'webgpu',
      // (in development, ?dtype=q8 tries another quantisation of the weights)
      dtype: import.meta.env.DEV ? new URLSearchParams(location.search).get('dtype') : null,
      // (a chip that passed the probe before, and files that passed their check: neither is redone)
      probed: !!key && stored(PROBED) === key,
      verified: stored(VERIFIED) === MODEL_REVISION,
    },
    progress,
  )
  if (r.probed && key) remember(PROBED, key)
  if (r.verified) remember(VERIFIED, MODEL_REVISION)
}

/** One answer from the model, as text. */
export const generate = (prompt: Prompt) =>
  ask({ type: 'generate', prompt }).then((r) => r.result ?? '')

// In development, the page's own instance of this module at hand for a test script.
if (import.meta.env.DEV)
  Object.assign(globalThis, {
    __topicAi: {
      generate,
      loadModel,
      unloadModel,
      partsPrompt,
      termsPrompt,
      titlesPrompt,
      readParts,
      readList,
      readTitles,
    },
  })
