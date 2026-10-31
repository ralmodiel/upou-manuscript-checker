// The topic planner's model, in a worker so the page stays responsive while it loads and answers.
/// <reference lib="webworker" />
import { env, pipeline, type TextGenerationPipeline } from '@huggingface/transformers'
import { MODEL, MODEL_REVISION, type Prompt } from './ai.ts'

type Request =
  | {
      id: number
      type: 'load'
      device: 'webgpu' | 'wasm'
      dtype?: string | null
      /** This chip passed the probe before, and the files their check: neither is redone. */
      probed?: boolean
      verified?: boolean
    }
  | { id: number; type: 'generate'; prompt: Prompt }

// The model comes from Hugging Face and nowhere else; ONNX Runtime's WebAssembly comes from this
// site (served under ort/ by vite.config.ts), not from the CDN it would otherwise reach for.
env.allowLocalModels = false
env.remoteHost = 'https://huggingface.co/'
env.useBrowserCache = true
env.backends.onnx.wasm!.wasmPaths = new URL(
  `${import.meta.env.BASE_URL}ort/`,
  self.location.origin,
).href

// A sum a sound model gets right; one that answers in nonsense (or copies its prompt) does not.
const PROBE = { ask: 'What is 7 plus 5? Reply with the number only.', pass: /\b12\b/ }

/** Each file the model needs, with the SHA-256 of its copy at MODEL_REVISION: the weights' is the
 *  LFS object id the Hugging Face API lists for that commit, the small files' were computed from
 *  copies fetched at it. */
const FILES: Record<string, string> = {
  'config.json': '777e01f0fbb3346eb229cb6fb278ed6533c1e4dcb9ebf4bed0f6e94ef17fa1b5',
  'generation_config.json': 'f7e7ce458658b2d40d9eb213b91b77a8bf698845ab89360976722d7ac46928a3',
  'tokenizer_config.json': '6a14243f0ae04884e597b3f032c05e15de9f417318fdcac24ab4e2680e691430',
  'tokenizer.json': 'a8506e7111b80c6d8635951a02eab0f4e1a8e4e5772da83846579e97b16f61bf',
  'onnx/model_q4.onnx': '09235a3b1c135cd04ef570e5053b5c079e028078a2cc5f76ba6a251e91bf3296',
}
// (the address transformers.js fetches a file from, and files it in the browser's cache under)
const fileUrl = (file: string) => `${env.remoteHost}${MODEL}/resolve/${MODEL_REVISION}/${file}`
const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('')

/** The fetched files against the hashes of the ones tested, read back from the browser's cache.
 *  A file that differs (changed on the host, or on the way) takes the model's files out of the
 *  cache, and the load fails. True when every file was checked; a file the cache does not hold
 *  cannot be, and the check waits for a later load. */
async function verify(): Promise<boolean> {
  if (typeof caches === 'undefined') return false
  const cache = await caches.open(env.cacheKey)
  const bad: string[] = []
  let all = true
  for (const [file, sha] of Object.entries(FILES)) {
    const r = await cache.match(fileUrl(file))
    if (!r) all = false
    else if (hex(await crypto.subtle.digest('SHA-256', await r.arrayBuffer())) !== sha)
      bad.push(file)
  }
  if (bad.length) {
    await Promise.all(Object.keys(FILES).map((f) => cache.delete(fileUrl(f))))
    throw new Error(
      `The model's files did not match the ones tested (${bad.join(', ')}), so they were removed from this browser. Turning it on again fetches them afresh; if this repeats, suggestions stay off here.`,
    )
  }
  return all
}

const answer = (out: unknown) => {
  const t = (out as { generated_text: string | { content: string }[] }[])[0]?.generated_text
  return typeof t === 'string' ? t : (t?.at(-1)?.content ?? '')
}
const chat = (
  g: TextGenerationPipeline,
  messages: { role: string; content: string }[],
  max: number,
) => g(messages, { max_new_tokens: max, do_sample: false, return_full_text: false })

let model: Promise<TextGenerationPipeline> | undefined
// What this load found out, for the page to remember.
let found: { probed?: boolean; verified?: boolean } = {}

async function handle(m: Request) {
  const post = (reply: object) => self.postMessage({ id: m.id, ...reply })
  try {
    if (m.type === 'load') {
      model ??= (async () => {
        // The runtime's WebAssembly (27 MB) is asked for only once the weights are in, and the
        // browser keeps it for ten minutes: fetched now, it is at hand by then.
        void fetch(
          new URL(
            'ort-wasm-simd-threaded.asyncify.wasm',
            env.backends.onnx.wasm!.wasmPaths as string,
          ),
        )
          .then((r) => r.arrayBuffer())
          .catch(() => {})
        // (the runtime reports every chunk it reads, thousands for the weights: the page gets
        // ten a second per file, and always the last)
        const sent = new Map<string, number>()
        const g = await pipeline('text-generation', MODEL, {
          device: m.device,
          // (4-bit weights with full-precision sums: in half precision this model's answers come
          // out as nonsense on some graphics chips)
          dtype: (m.dtype ?? 'q4') as 'q4',
          // (the files as tested, whatever the model's main branch holds later)
          revision: MODEL_REVISION,
          progress_callback: (p) => {
            if (p.status !== 'progress') return
            const now = performance.now()
            if (p.loaded < p.total && now - (sent.get(p.file) ?? 0) < 100) return
            sent.set(p.file, now)
            post({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total })
          },
        })
        found = {}
        if (!m.verified)
          try {
            found.verified = await verify()
          } catch (e) {
            await g.dispose()
            throw e
          }
        if (!m.probed) {
          // The first answer builds the chip's programs for the model (a minute or two on a
          // laptop), and shows whether the chip runs it right.
          post({ type: 'stage', stage: 'preparing' })
          const t = answer(await chat(g, [{ role: 'user', content: PROBE.ask }], 12))
          if (!PROBE.pass.test(t)) {
            await g.dispose()
            throw new Error(
              `This graphics chip did not run the model correctly (asked for 7 plus 5, it answered “${t.trim().slice(0, 40)}”), so suggestions stay off here.`,
            )
          }
          found.probed = true
        }
        return g
      })()
      await model
      post({ type: 'done', ...found })
    } else {
      if (!model) throw new Error('The model is not loaded.')
      const g = await model
      const out = await chat(
        g,
        [
          { role: 'system', content: m.prompt.system },
          { role: 'user', content: m.prompt.user },
        ],
        m.prompt.max,
      )
      post({ type: 'done', result: answer(out) })
    }
  } catch (err) {
    if (m.type === 'load') model = undefined
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

// One request at a time: the runtime cannot run two answers at once ("Session already started"),
// and two suggest buttons may well be pressed together. Each request reports its own errors, so
// the line never breaks.
let queue = Promise.resolve()
self.onmessage = (e: MessageEvent<Request>) => {
  queue = queue.then(() => handle(e.data))
}
