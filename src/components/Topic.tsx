// The Topic planner tab: a student shapes a systematic-review topic in five steps (Question,
// Criteria, Search, Screen, Plan). The question is written as a sentence that fills in as its
// parts are typed; the search string, the PRISMA 2020 flow and a verdict on the topic's size
// follow from the entries; the last step is the PRISMA 2020 checklist, downloadable as Word.
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { saveFile } from '../lib/browser'
import {
  generate,
  loadModel,
  MODEL_LICENCE,
  MODEL_MB,
  MODEL_NAME,
  MODEL_URL,
  partsPrompt,
  readList,
  readParts,
  readTitles,
  supported,
  termsPrompt,
  titlesPrompt,
  unloadModel,
  usable,
  type Phase,
  type Progress,
  type Prompt,
} from '../topic/ai'
import {
  ABSTRACT,
  ENDORSEMENT,
  itemNumber,
  MAIN,
  PRISMA_APP,
  PRISMA_CITATION,
  PRISMA_ENDORSEMENT,
  PRISMA_EXTENSIONS,
  PRISMA_FLOW,
  PRISMA_HOME,
  PRISMA_SCOPING,
  PRISMA_SITE,
  type PrismaItem,
} from '../topic/prisma'
import {
  ANY_LANGUAGE,
  badNumbers,
  blank,
  criteria,
  DESIGNS,
  done,
  drafted,
  elementsOf,
  EXAMPLE,
  flow,
  hours,
  isSearched,
  KINDS,
  LANGUAGES,
  missing,
  objective,
  question,
  questionPieces,
  questionReady,
  REASONS,
  sane,
  SCREENERS,
  searchFor,
  searchString,
  SOURCES,
  STEPS,
  termsOf,
  TYPES,
  verdict,
  workingTitle,
  type Element,
  type Flow,
  type Kind,
  type Plan,
  type Step,
} from '../topic/plan'
import { OLD_PLAN_KEY, PLANS_KEY } from '../topic/store'
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  PlusIcon,
  RestartIcon,
  SparkIcon,
} from './icons'
import { buttonClass, STATUS } from './styles'

const STEP_NAMES: Record<Step, { name: string; hint: string }> = {
  question: { name: 'Question', hint: 'Write it from its parts' },
  criteria: { name: 'Criteria', hint: 'What counts' },
  search: { name: 'Search', hint: 'Where, and how many' },
  screen: { name: 'Screen', hint: 'The numbers, the size' },
  plan: { name: 'Plan', hint: 'PRISMA checklist' },
}

// (a width goes with each use: the narrow ones must not carry w-full as well)
const FIELD =
  'rounded-field border border-line bg-surface px-3.5 text-ink shadow-(--shadow-elev-1) transition-[border-color,box-shadow] placeholder:text-ink-3 hover:border-ink-3/50 focus-visible:border-maroon focus-visible:outline-offset-0'
const INPUT = `h-11 w-full ${FIELD}`
const AREA = `min-h-24 w-full py-2.5 leading-relaxed ${FIELD}`
const LABEL = 'block text-sm font-semibold text-ink'
const HINT = 'mt-1 text-[0.8125rem] text-ink-3'
const PILL =
  'inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-pill border border-line bg-surface px-3.5 text-sm font-medium text-ink-2 transition-[border-color,background-color,color] hover:border-ink-3/50 hover:text-ink aria-pressed:border-maroon aria-pressed:bg-maroon-soft aria-pressed:text-maroon [&_svg]:size-4'
const CARD = 'rounded-card border border-line bg-surface p-5 shadow-(--shadow-elev-1) sm:p-6'
const LINK = 'underline underline-offset-2 hover:decoration-2'

type Patch = (p: Partial<Plan> | ((prev: Plan) => Partial<Plan>)) => void

/** "a, b and c" */
const prose = (xs: string[]) =>
  xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? '')

// ---- Suggestions from the model (optional, on this device) ----

interface Ai {
  phase: Phase | 'unsupported'
  progress?: Progress
  error?: string
  /** The model was loaded in this browser before, so it should come from the cache. */
  seen: boolean
  start: () => void
  stop: () => void
  /** One answer as text; '' when the model fails, which the page then says. */
  text: (prompt: Prompt) => Promise<string>
}

// Remembered once the model has loaded here: the switch can then promise a quick start.
const SEEN = 'upou-topic-ai'
const wasSeen = () => {
  try {
    return localStorage.getItem(SEEN) === '1'
  } catch {
    return false
  }
}

function useAi(): Ai {
  const [phase, setPhase] = useState<Ai['phase']>(() => (supported() ? 'off' : 'unsupported'))
  const [progress, setProgress] = useState<Progress>()
  const [error, setError] = useState<string>()
  const [seen, setSeen] = useState(wasSeen)
  // (WebGPU may be there with no graphics chip behind it: then the switch is not offered)
  useEffect(() => {
    if (!supported()) return
    let on = true
    void usable().then((ok) => {
      if (on && !ok) setPhase('unsupported')
    })
    return () => {
      on = false
    }
  }, [])
  const start = () => {
    setPhase('loading')
    setProgress(undefined)
    setError(undefined)
    loadModel(setProgress).then(
      () => {
        setPhase('ready')
        setSeen(true)
        try {
          localStorage.setItem(SEEN, '1')
        } catch {
          // Storage blocked: the switch just keeps naming the size.
        }
      },
      (e: Error) => {
        setPhase('error')
        setError(e.message)
      },
    )
  }
  const stop = () => {
    unloadModel()
    setPhase('off')
    setProgress(undefined)
    setError(undefined)
  }
  const text = (prompt: Prompt) =>
    generate(prompt).catch((e: Error) => {
      setError(e.message)
      // (the worker is gone, and the model with it: back to the switch, which reloads it)
      if (/not loaded|could not be started/.test(e.message)) setPhase('error')
      return ''
    })
  return { phase, progress, error, seen, start, stop, text }
}

/** The switch for the model, with what it is and what it costs; then its state. */
function AiRow({ ai }: { ai: Ai }) {
  const mb = (n: number) => Math.round(n / 1e6)
  const pct =
    ai.progress && ai.progress.total
      ? Math.round((100 * ai.progress.loaded) / ai.progress.total)
      : 0
  const credit = (
    <span className="block text-[0.75rem] text-ink-3">
      Model:{' '}
      <a
        href={MODEL_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2"
      >
        {MODEL_NAME}
      </a>{' '}
      ({MODEL_LICENCE}), run in your browser with transformers.js.
    </span>
  )
  return (
    <div className="rounded-tile border border-dashed border-line px-4 py-3" data-print="hide">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SparkIcon className="size-5 shrink-0 text-maroon" />
        <div className="min-w-0 flex-1 basis-56 space-y-1 text-sm leading-relaxed text-ink-2">
          {ai.phase === 'unsupported' && (
            <p>
              Suggestions from a small AI model need a browser with WebGPU: a recent Chrome, Edge or
              Firefox, or Safari 26 or newer. Everything else here works without them.
            </p>
          )}
          {ai.phase === 'off' && (
            <>
              <p>
                <span className="font-semibold text-ink">Optional:</span> a small AI model can read
                your sentence into the parts of the question, offer other words for the search and
                suggest titles.
                {ai.seen
                  ? ' It was fetched into this browser before, so it should open in seconds; it'
                  : ` About ${MODEL_MB} MB, fetched once from Hugging Face and kept in this browser; it`}{' '}
                runs on this device, so what you type never leaves it. It can be wrong: you choose
                what to keep.
              </p>
              {credit}
            </>
          )}
          {ai.phase === 'loading' && ai.progress?.stage === 'preparing' && (
            <>
              <p aria-live="polite">
                Preparing the model for this graphics chip: a minute or two, once.
              </p>
              <div
                className="relative h-2 overflow-hidden rounded-pill bg-line"
                role="progressbar"
                aria-label="Preparing the model"
              >
                <div className="absolute inset-y-0 left-0 w-2/5 rounded-pill bg-band-gold motion-safe:animate-sweep motion-reduce:w-full motion-reduce:opacity-40" />
              </div>
            </>
          )}
          {ai.phase === 'loading' && ai.progress?.stage !== 'preparing' && (
            <>
              <p aria-live="polite">
                Fetching the model
                {ai.progress?.total
                  ? `: ${mb(ai.progress.loaded)} of ${mb(ai.progress.total)} MB`
                  : '…'}
              </p>
              <div
                className="h-2 overflow-hidden rounded-pill bg-line"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Model download"
              >
                <div
                  className="h-full rounded-pill bg-band-gold transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-[0.75rem] text-ink-3">
                Once it is in, it stays: next time it opens in seconds.
              </p>
            </>
          )}
          {ai.phase === 'ready' && (
            <>
              <p>
                Suggestions are on: look for the{' '}
                <SparkIcon className="inline size-4 align-[-0.2em] text-maroon" /> buttons. They
                come from the model on this device and can be wrong; keep only what fits.
              </p>
              {ai.error && <p className="text-fix">The last request failed: {ai.error}</p>}
              {credit}
            </>
          )}
          {ai.phase === 'error' && (
            <p className="text-fix">{ai.error ?? 'The model could not be started.'}</p>
          )}
        </div>
        {(ai.phase === 'off' || ai.phase === 'error') && (
          <button type="button" onClick={ai.start} className={buttonClass('secondary', 'sm')}>
            {ai.phase === 'error' || ai.seen ? 'Turn on' : `Turn on (${MODEL_MB} MB, once)`}
          </button>
        )}
        {ai.phase === 'ready' && (
          <button type="button" onClick={ai.stop} className={buttonClass('ghost', 'sm')}>
            Turn off
          </button>
        )}
      </div>
    </div>
  )
}

/** Seconds since `since`, ticking, for a wait the student can see passing. */
function useElapsed(since?: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (since === undefined) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [since])
  return since === undefined ? 0 : Math.max(0, Math.round((now - since) / 1000))
}

/** A suggest button and the chips it brings: each added with a tap, or all together. */
function Suggest({
  ai,
  label,
  ask,
  onPick,
  wrap = false,
}: {
  ai: Ai
  label: string
  ask: () => Promise<string[]>
  onPick: (s: string) => void
  /** Long suggestions (titles) wrap onto lines; the chips are not one line high. */
  wrap?: boolean
}) {
  const [items, setItems] = useState<string[]>()
  const [since, setSince] = useState<number>()
  const elapsed = useElapsed(since)
  if (ai.phase !== 'ready') return null
  const busy = since !== undefined
  const run = async () => {
    setSince(Date.now())
    const got = await ask()
    setSince(undefined)
    setItems(got)
  }
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={run} disabled={busy} className={buttonClass('ghost', 'sm')}>
          <SparkIcon />
          {busy ? `Thinking… ${elapsed}s` : label}
        </button>
        {items && items.length > 1 && (
          <button
            type="button"
            onClick={() => {
              items.forEach(onPick)
              setItems(undefined)
            }}
            className={buttonClass('ghost', 'sm')}
          >
            Add all
          </button>
        )}
      </div>
      {items && !items.length && (
        <p className={HINT}>Nothing usable came back; try again, or write your own.</p>
      )}
      {items && items.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Suggestions">
          {items.map((s) => (
            <li key={s} className="motion-safe:animate-rise">
              <button
                type="button"
                onClick={() => {
                  onPick(s)
                  // (the last one taken: nothing left to show, which is not "nothing came back")
                  setItems(items.length > 1 ? items.filter((x) => x !== s) : undefined)
                }}
                className={`inline-flex cursor-pointer items-center gap-1 rounded-pill border border-dashed border-maroon/50 pr-2.5 pl-2 text-sm text-maroon hover:bg-maroon-soft [&_svg]:size-3.5 ${wrap ? 'min-h-8 py-1 text-left [&_svg]:shrink-0' : 'h-8'}`}
              >
                <PlusIcon strokeWidth={2.5} />
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type Found = { id: string; name: string; value: string }

/** The parts of the question as the model reads them from the student's sentence: each offered
 *  beside its name, and written into the plan only when the student takes it. */
function DraftParts({ ai, plan, patch }: { ai: Ai; plan: Plan; patch: Patch }) {
  const [since, setSince] = useState<number>()
  const [found, setFound] = useState<Found[]>()
  const elapsed = useElapsed(since)
  const busy = since !== undefined
  const run = async () => {
    setSince(Date.now())
    const els = elementsOf(plan)
    const got = readParts(
      await ai.text(partsPrompt(plan.interest.trim(), els)),
      els.map((e) => e.id),
      plan.interest,
    )
    setFound(
      els
        .filter((e) => got[e.id] && got[e.id] !== (plan.parts[e.id] ?? '').trim())
        .map((e) => ({ id: e.id, name: e.name, value: got[e.id] })),
    )
    setSince(undefined)
  }
  const use = (xs: Found[]) => {
    patch((p) => ({
      parts: { ...p.parts, ...Object.fromEntries(xs.map((x) => [x.id, x.value])) },
    }))
    setFound((f) => {
      const left = f?.filter((x) => !xs.includes(x))
      return left?.length ? left : undefined
    })
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={run} disabled={busy} className={buttonClass('ghost', 'sm')}>
          <SparkIcon />
          {busy ? `Reading… ${elapsed}s` : 'Read the parts from this sentence'}
        </button>
        {found && found.length > 1 && (
          <button type="button" onClick={() => use(found)} className={buttonClass('ghost', 'sm')}>
            Use all
          </button>
        )}
      </div>
      {found && !found.length && (
        <p className={HINT}>Nothing new could be read from that sentence; write the parts below.</p>
      )}
      {found && found.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Parts read from the sentence">
          {found.map((x) => (
            <li key={x.id} className="motion-safe:animate-rise">
              <button
                type="button"
                onClick={() => use([x])}
                className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-pill border border-dashed border-maroon/50 pr-2.5 pl-2 text-sm text-maroon hover:bg-maroon-soft [&_svg]:size-3.5"
              >
                <PlusIcon strokeWidth={2.5} />
                <span className="text-ink-3">{x.name}:</span> {x.value}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
  id,
}: {
  label: string
  hint?: string
  children: (id: string) => ReactNode
  id?: string
}) {
  const own = useId()
  const fid = id ?? own
  return (
    <div>
      <label htmlFor={fid} className={LABEL}>
        {label}
      </label>
      {hint && <p className={HINT}>{hint}</p>}
      <div className="mt-2">{children(fid)}</div>
    </div>
  )
}

function Pills({
  label,
  options,
  chosen,
  onChange,
  hint,
  suggested = [],
}: {
  label: string
  options: string[]
  chosen: string[]
  onChange: (v: string[]) => void
  hint?: string
  suggested?: string[]
}) {
  const toggle = (o: string) =>
    onChange(chosen.includes(o) ? chosen.filter((c) => c !== o) : [...chosen, o])
  return (
    <fieldset>
      <legend className={LABEL}>{label}</legend>
      {hint && <p className={HINT}>{hint}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={chosen.includes(o)}
            onClick={() => toggle(o)}
            className={PILL}
          >
            {chosen.includes(o) && <CheckIcon strokeWidth={2.5} />}
            {o}
            {suggested.includes(o) && !chosen.includes(o) && (
              <span className="text-[0.6875rem] font-semibold tracking-wide text-gold uppercase dark:text-gold">
                suggested
              </span>
            )}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/** Synonyms as chips: type one, Enter or a comma adds it. */
function Terms({
  id,
  terms,
  onChange,
}: {
  id: string
  terms: string[]
  onChange: (t: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const t = draft.trim().replace(/,$/, '')
    if (t && !terms.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...terms, t])
    setDraft('')
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {terms.map((t) => (
        <span
          key={t}
          className="inline-flex h-8 items-center gap-1 rounded-pill bg-surface-2 pr-1 pl-3 text-sm text-ink"
        >
          {t}
          <button
            type="button"
            aria-label={`Remove ${t}`}
            onClick={() => onChange(terms.filter((x) => x !== t))}
            className="grid size-6 cursor-pointer place-items-center rounded-pill text-ink-3 hover:bg-line hover:text-ink [&_svg]:size-3.5"
          >
            <CloseIcon strokeWidth={2.5} />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add()
          } else if (e.key === 'Backspace' && !draft && terms.length) onChange(terms.slice(0, -1))
        }}
        onBlur={add}
        placeholder={terms.length ? 'Another synonym' : 'Synonyms: other words studies use for it'}
        className="h-9 min-w-40 flex-1 rounded-chip border border-dashed border-line bg-transparent px-3 text-sm text-ink placeholder:text-ink-3 focus-visible:border-maroon focus-visible:outline-offset-0"
      />
    </div>
  )
}

/** The question as a sentence, the blanks named where a part is still to write. */
function Question({ plan, big = false }: { plan: Plan; big?: boolean }) {
  return (
    <p
      className={`font-display text-ink ${big ? 'text-[1.75rem] leading-tight sm:text-4xl' : 'text-xl leading-snug'}`}
    >
      {questionPieces(plan).map((x, k) =>
        'text' in x ? (
          <span key={k}>{x.text}</span>
        ) : (
          <span
            key={k}
            className="mx-0.5 inline-block rounded-md border border-dashed border-ink-3/60 px-2 text-ink-3"
          >
            {x.blank}
          </span>
        ),
      )}
    </p>
  )
}

function Copy({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      disabled={!text}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1800)
        } catch {
          // Clipboard refused: the text is on the page to select.
        }
      }}
      className={buttonClass('secondary', 'sm')}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? 'Copied' : label}
    </button>
  )
}

// ---- Steps ----

function QuestionStep({ plan, patch, ai }: { plan: Plan; patch: Patch; ai: Ai }) {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Field
          label="What are you curious about?"
          hint="A few words, in your own terms. The question is shaped below."
        >
          {(id) => (
            <input
              id={id}
              className={INPUT}
              value={plan.interest}
              onChange={(e) => patch({ interest: e.target.value })}
              placeholder={`e.g. ${KINDS[plan.kind].sample}`}
            />
          )}
        </Field>
        <AiRow ai={ai} />
        {ai.phase === 'ready' && !!plan.interest.trim() && (
          <DraftParts ai={ai} plan={plan} patch={patch} />
        )}
      </div>
      <fieldset>
        <legend className={LABEL}>What kind of question is it?</legend>
        <p className={HINT}>Each kind has a frame reviewers use; the parts below change with it.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(Object.keys(KINDS) as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={plan.kind === k}
              onClick={() => patch({ kind: k })}
              className="flex cursor-pointer flex-col gap-1 rounded-tile border border-line bg-surface p-4 text-left shadow-(--shadow-elev-1) transition-[border-color,box-shadow] hover:border-ink-3/50 hover:shadow-(--shadow-elev-2) aria-pressed:border-maroon aria-pressed:ring-1 aria-pressed:ring-maroon"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-semibold text-ink">{KINDS[k].ask}</span>
                <span className="text-xs font-semibold tracking-[0.06em] text-maroon">
                  {KINDS[k].framework}
                </span>
              </span>
              <span className="text-sm text-ink-2">{KINDS[k].blurb}</span>
              <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3">
                {KINDS[k].elements.map((e) => (
                  <span key={e.id} className="inline-flex items-center gap-1">
                    <span className="inline-grid h-5 min-w-5 place-items-center rounded-md bg-maroon-soft px-1 font-display text-[0.8rem] leading-none text-maroon">
                      {e.letter}
                    </span>
                    {e.name}
                  </span>
                ))}
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <div className={`${CARD} bg-paper`}>
        <Question plan={plan} big />
        {questionReady(plan) && (
          <div className="mt-5">
            <Field
              label="Title"
              hint="The working title, written from the parts, stands until you write your own (PRISMA item 1)."
            >
              {(id) => (
                <input
                  id={id}
                  className={INPUT}
                  value={plan.title}
                  onChange={(e) => patch({ title: e.target.value })}
                  placeholder={workingTitle({ ...plan, title: '' })}
                />
              )}
            </Field>
            <Suggest
              ai={ai}
              label="Title ideas"
              wrap
              ask={async () =>
                readTitles(
                  await ai.text(titlesPrompt(question(plan), KINDS[plan.kind].review)),
                  workingTitle(plan),
                  question(plan),
                )
              }
              onPick={(t) => patch({ title: t })}
            />
          </div>
        )}
      </div>
      <div className="space-y-6">
        {elementsOf(plan).map((e) => (
          <ElementField key={e.id} e={e} plan={plan} patch={patch} ai={ai} />
        ))}
      </div>
      <Field
        label="Why does it matter?"
        hint="The rationale, in two or three sentences: what is known, and what is unsettled (PRISMA item 3)."
      >
        {(id) => (
          <textarea
            id={id}
            className={AREA}
            value={plan.rationale}
            onChange={(e) => patch({ rationale: e.target.value })}
          />
        )}
      </Field>
      <Reviewed plan={plan} patch={patch} />
    </div>
  )
}

/** Before the topic is settled: the reviews already published on it, looked up where reviews are
 *  kept, and where this one is or will be registered (PRISMA items 3 and 24a). */
function Reviewed({ plan, patch }: { plan: Plan; patch: Patch }) {
  const topic =
    elementsOf(plan)
      .filter((e) => isSearched(plan, e))
      .map((e) => (plan.parts[e.id] ?? '').trim())
      .filter(Boolean)
      .join(' ') || plan.interest.trim()
  const enc = encodeURIComponent
  const places: [string, string][] = topic
    ? [
        [
          'Google Scholar',
          `https://scholar.google.com/scholar?q=${enc(`${topic} "systematic review" OR "scoping review"`)}`,
        ],
        [
          'PubMed reviews',
          `https://pubmed.ncbi.nlm.nih.gov/?term=${enc(topic)}&filter=pubt.systematicreview`,
        ],
        ['Epistemonikos', `https://www.epistemonikos.org/en/search?q=${enc(topic)}`],
        ['PROSPERO', 'https://www.crd.york.ac.uk/prospero/'],
        ['Cochrane Library', 'https://www.cochranelibrary.com/search'],
      ]
    : []
  return (
    <div className={CARD}>
      <h3 className="font-semibold text-ink">Has it been reviewed already?</h3>
      <p className={HINT}>
        Look for reviews on your question before you commit to it: a recent one may have settled it,
        or left a gap yours can fill. PROSPERO lists reviews under way, not yet published.
      </p>
      {places.length ? (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Where to look for reviews">
          {places.map(([name, href]) => (
            <li key={name}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass('secondary', 'sm')}
              >
                {name}
                <ExternalLinkIcon />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-ink-3">
          Write the parts above, and the places to look open from here.
        </p>
      )}
      <div className="mt-5 grid gap-6 sm:grid-cols-2">
        <Field
          label="Reviews already published"
          hint="What you found, with its year, and what yours would add (PRISMA item 3)."
        >
          {(id) => (
            <textarea
              id={id}
              className={AREA}
              value={plan.reviews}
              onChange={(e) => patch({ reviews: e.target.value })}
              placeholder="e.g. A 2019 review covered higher education as a whole; none since on online learners."
            />
          )}
        </Field>
        <Field
          label="Registration"
          hint="The register and number (PROSPERO, OSF), or that it is not registered (PRISMA item 24a)."
        >
          {(id) => (
            <input
              id={id}
              className={INPUT}
              value={plan.registered}
              onChange={(e) => patch({ registered: e.target.value })}
              placeholder="e.g. Not registered yet"
            />
          )}
        </Field>
      </div>
    </div>
  )
}

function ElementField({ e, plan, patch, ai }: { e: Element; plan: Plan; patch: Patch; ai: Ai }) {
  const id = useId()
  return (
    <div className="grid gap-x-4 gap-y-2 sm:grid-cols-[3.25rem_1fr]">
      <span
        aria-hidden="true"
        className="hidden h-11 place-items-center rounded-field bg-maroon-soft font-display text-xl text-maroon sm:grid"
      >
        {e.letter}
      </span>
      <div>
        <label htmlFor={id} className={LABEL}>
          {e.name}
          {e.optional && <span className="ml-1.5 font-normal text-ink-3">(if any)</span>}
        </label>
        <p className={HINT}>{e.hint}</p>
        <input
          id={id}
          className={`${INPUT} mt-2`}
          value={plan.parts[e.id] ?? ''}
          onChange={(ev) => patch((p) => ({ parts: { ...p.parts, [e.id]: ev.target.value } }))}
          placeholder={`e.g. ${e.example}`}
        />
        <Terms
          id={`${id}-terms`}
          terms={plan.terms[e.id] ?? []}
          onChange={(t) => patch((p) => ({ terms: { ...p.terms, [e.id]: t } }))}
        />
        {!!(plan.parts[e.id] ?? '').trim() && (
          <Suggest
            ai={ai}
            label="Other words"
            ask={async () =>
              readList(
                await ai.text(termsPrompt(e.name, plan.parts[e.id]!.trim())),
                termsOf(plan, e.id),
                8,
                plan.parts[e.id]!.trim(),
              )
            }
            onPick={(t) =>
              patch((p) => {
                const ts = p.terms[e.id] ?? []
                // (a word already there, in any case: no second chip)
                return ts.some((x) => x.toLowerCase() === t.toLowerCase())
                  ? {}
                  : { terms: { ...p.terms, [e.id]: [...ts, t] } }
              })
            }
          />
        )}
      </div>
    </div>
  )
}

function CriteriaStep({ plan, patch }: { plan: Plan; patch: Patch }) {
  const kind = KINDS[plan.kind]
  return (
    <div className="space-y-8">
      <fieldset>
        <legend className={LABEL}>Years</legend>
        <p className={HINT}>
          Most reviews take ten to fifteen years; older studies when the field is young.
        </p>
        <div className="mt-2 flex items-center gap-3">
          <input
            aria-label="From year"
            inputMode="numeric"
            className={`h-11 w-28 ${FIELD}`}
            value={plan.from}
            onChange={(e) => patch({ from: e.target.value })}
            placeholder="2015"
          />
          <span className="text-ink-3">to</span>
          <input
            aria-label="To year"
            inputMode="numeric"
            className={`h-11 w-28 ${FIELD}`}
            value={plan.to}
            onChange={(e) => patch({ to: e.target.value })}
            placeholder={String(new Date().getFullYear())}
          />
        </div>
      </fieldset>
      <Pills
        label="Languages"
        options={LANGUAGES}
        chosen={plan.languages}
        onChange={(next) => {
          // ("Any language" stands alone: chosen, it clears the rest; another chosen drops it)
          const any = next.includes(ANY_LANGUAGE)
          const had = plan.languages.includes(ANY_LANGUAGE)
          patch({
            languages:
              any && !had
                ? [ANY_LANGUAGE]
                : any && next.length > 1
                  ? next.filter((l) => l !== ANY_LANGUAGE)
                  : next,
          })
        }}
      />
      <Pills
        label="Study designs"
        hint={
          kind.designs.length
            ? `For a ${kind.framework} question, these designs answer it best.`
            : 'A scoping review usually takes any design; choose only to narrow it.'
        }
        options={DESIGNS}
        chosen={plan.designs}
        suggested={kind.designs}
        onChange={(designs) => patch({ designs })}
      />
      <Pills
        label="Publication types"
        options={TYPES}
        chosen={plan.types}
        onChange={(types) => patch({ types })}
      />
      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Also include" hint="Anything else a study must have, one per line.">
          {(id) => (
            <textarea
              id={id}
              className={AREA}
              value={plan.include}
              onChange={(e) => patch({ include: e.target.value })}
            />
          )}
        </Field>
        <Field label="Exclude" hint="What rules a study out, one per line.">
          {(id) => (
            <textarea
              id={id}
              className={AREA}
              value={plan.exclude}
              onChange={(e) => patch({ exclude: e.target.value })}
              placeholder={'e.g. Studies of face-to-face classes only'}
            />
          )}
        </Field>
      </div>
    </div>
  )
}

/** Today as the date input writes it, in local time: a search made this evening was made today. */
const today = () => {
  const d = new Date()
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

const DIGITS = 'Digits only, as in 1,200.'

function SearchStep({ plan, patch }: { plan: Plan; patch: Patch }) {
  const s = searchString(plan)
  const bad = badNumbers(plan)
  // (what "Open search" takes along: the string as that database reads it, or the interest
  // while there is no string)
  const query = (id: string) => searchFor(plan, id) || plan.interest.trim()
  return (
    <div className="space-y-8">
      <div className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-ink">Your search string</h3>
            <p className={HINT}>
              Each part's words joined by OR, the parts by AND. Untick a part to leave it out.
              PubMed, Scopus and Web of Science read it in their own syntax: copy theirs from their
              rows below.
            </p>
          </div>
          <span data-print="hide">
            <Copy text={s} label="Copy" />
          </span>
        </div>
        <p className="mt-4 rounded-field bg-paper px-4 py-3 font-mono text-sm leading-relaxed break-words text-ink">
          {s || <span className="text-ink-3">Write the question's parts first (step 1).</span>}
        </p>
        {s.length > 256 && (
          <p className={HINT}>
            Google Scholar is said to read only the first 256 characters of a search and to drop the
            rest without a word; this string has {s.length}. There, keep the main terms, or search
            in parts.
          </p>
        )}
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {elementsOf(plan).map((e) => (
            <li key={e.id} className="flex items-start gap-3 text-sm">
              <input
                id={`search-${e.id}`}
                type="checkbox"
                checked={isSearched(plan, e)}
                onChange={(ev) =>
                  patch((p) => ({ searched: { ...p.searched, [e.id]: ev.target.checked } }))
                }
                className="mt-1 size-4 accent-maroon"
              />
              <label htmlFor={`search-${e.id}`} className="min-w-0">
                <span className="font-semibold text-ink">{e.name}</span>
                <span className="block text-ink-2">
                  {termsOf(plan, e.id).join(' · ') || (
                    <span className="text-ink-3">no words yet</span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      <fieldset>
        <legend className={LABEL}>Where will you search?</legend>
        <p className={HINT}>
          Tick each source, open it with your string, and note the date and the count it shows. Two
          or three sources are usual; a scoping review may add more.
        </p>
        <ul className="mt-3 divide-y divide-line rounded-card border border-line bg-surface shadow-(--shadow-elev-1)">
          {SOURCES.map((src) => {
            const log = plan.sources[src.id] ?? {}
            const set = (v: Partial<typeof log>) =>
              patch((p) => ({
                sources: { ...p.sources, [src.id]: { ...p.sources[src.id], ...v } },
              }))
            return (
              <li key={src.id} className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    id={`src-${src.id}`}
                    type="checkbox"
                    checked={!!log.on}
                    onChange={(e) => set({ on: e.target.checked })}
                    className="size-4 accent-maroon"
                  />
                  <label htmlFor={`src-${src.id}`} className="min-w-0 flex-1">
                    <span className="font-semibold text-ink">{src.name}</span>
                    <span className="ml-2 text-sm text-ink-3">{src.note}</span>
                  </label>
                  {s && (searchFor(plan, src.id) !== s || !src.url) && (
                    <Copy text={searchFor(plan, src.id)} label="Copy" />
                  )}
                  {src.url && (
                    <a
                      href={query(src.id) ? src.url(query(src.id)) : new URL(src.url('')).origin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonClass('secondary', 'sm')}
                    >
                      {query(src.id) ? 'Open search' : 'Open'}
                      <ExternalLinkIcon />
                    </a>
                  )}
                </div>
                {log.on && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_8rem_1fr] sm:pl-7">
                    <label className="text-sm">
                      <span className="text-ink-2">Last searched</span>
                      <input
                        type="date"
                        className={`${INPUT} mt-1`}
                        value={log.date ?? ''}
                        onChange={(e) => set({ date: e.target.value })}
                      />
                    </label>
                    <label className="text-sm">
                      <span className="text-ink-2">Records found</span>
                      <input
                        inputMode="numeric"
                        className={`${INPUT} mt-1 ${bad.includes(`source:${src.id}`) ? 'border-fix' : ''}`}
                        value={log.found ?? ''}
                        aria-invalid={bad.includes(`source:${src.id}`) || undefined}
                        aria-describedby={
                          bad.includes(`source:${src.id}`) ? `src-${src.id}-digits` : undefined
                        }
                        onChange={(e) => {
                          // (the first count brought back dates the search, until a date is set)
                          set({ found: e.target.value, date: log.date || today() })
                        }}
                      />
                    </label>
                    {bad.includes(`source:${src.id}`) && (
                      <p
                        id={`src-${src.id}-digits`}
                        className="text-[0.8125rem] font-medium text-fix sm:order-last sm:col-span-3"
                      >
                        {DIGITS}
                      </p>
                    )}
                    <label className="text-sm">
                      <span className="text-ink-2">Filters and limits</span>
                      <input
                        className={`${INPUT} mt-1`}
                        value={log.filters ?? ''}
                        onChange={(e) => set({ filters: e.target.value })}
                        placeholder="e.g. Years 2015–2025, peer reviewed"
                      />
                    </label>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </fieldset>
      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          label="Other sources"
          hint="Reference lists, websites, experts asked (PRISMA item 6)."
        >
          {(id) => (
            <textarea
              id={id}
              className={AREA}
              value={plan.others}
              onChange={(e) => patch({ others: e.target.value })}
            />
          )}
        </Field>
        <Num
          label="Records from registers"
          hint="Trial or review registers, if searched: how many."
          value={plan.registers}
          onChange={(registers) => patch({ registers })}
          problem={bad.includes('registers') ? DIGITS : undefined}
        />
      </div>
    </div>
  )
}

const Num = ({
  label,
  hint,
  value,
  onChange,
  problem,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  /** What this number cannot be, against the others: said beside it. */
  problem?: string
}) => (
  <Field label={label} hint={hint}>
    {(id) => (
      <>
        <input
          id={id}
          inputMode="numeric"
          className={`${INPUT} ${problem ? 'border-fix' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-problem` : undefined}
        />
        {problem && (
          <p id={`${id}-problem`} className="mt-1.5 text-[0.8125rem] font-medium text-fix">
            {problem}
          </p>
        )}
      </>
    )}
  </Field>
)

function ScreenStep({ plan, patch, f }: { plan: Plan; patch: Patch; f: Flow }) {
  const bad = badNumbers(plan)
  // (what a count cannot be: against the other numbers, or not a number at all)
  const problem = (about: Flow['problems'][number]['about'], key: string = about) =>
    f.problems.find((x) => x.about === about)?.text ?? (bad.includes(key) ? DIGITS : undefined)
  const digits = (key: string) => (bad.includes(key) ? DIGITS : undefined)
  const setReason = (k: number, v: Partial<{ why: string; n: string }>) =>
    patch((p) => ({ reasons: p.reasons.map((r, j) => (j === k ? { ...r, ...v } : r)) }))
  return (
    <div className="space-y-8">
      <fieldset>
        <legend className={LABEL}>Who screens?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {SCREENERS.map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={plan.screener === o}
              onClick={() => patch({ screener: o })}
              className={PILL}
            >
              {plan.screener === o && <CheckIcon strokeWidth={2.5} />}
              {o}
            </button>
          ))}
        </div>
        <p className={HINT}>
          PRISMA item 8 asks how many screened and whether they worked independently.
        </p>
      </fieldset>
      <div className="grid gap-6 sm:grid-cols-3">
        <Num
          label="Duplicates removed"
          hint={`Of ${f.identified.toLocaleString('en')} records identified.`}
          value={plan.duplicates}
          onChange={(duplicates) => patch({ duplicates })}
          problem={problem('removed', 'duplicates')}
        />
        <Num
          label="Removed by automation"
          hint="Marked ineligible by a tool, if any."
          value={plan.automation}
          onChange={(automation) => patch({ automation })}
          problem={digits('automation')}
        />
        <Num
          label="Removed for other reasons"
          value={plan.removed}
          onChange={(removed) => patch({ removed })}
          problem={digits('removed')}
        />
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <Num
          label="Excluded by title and abstract"
          hint={`Of ${f.screened.toLocaleString('en')} records screened.`}
          value={plan.screenedOut}
          onChange={(screenedOut) => patch({ screenedOut })}
          problem={problem('screenedOut')}
        />
        <Num
          label="Reports not retrieved"
          hint="Full texts you could not get."
          value={plan.notRetrieved}
          onChange={(notRetrieved) => patch({ notRetrieved })}
          problem={problem('notRetrieved')}
        />
      </div>
      {/* (a fieldset is as wide as its content's minimum: on a phone the rows must shrink instead) */}
      <fieldset className="min-w-0">
        <legend className={LABEL}>Full texts excluded, by reason</legend>
        <p className={HINT}>
          Of {f.assessed.toLocaleString('en')} reports assessed. PRISMA asks for each reason and its
          count.
        </p>
        {problem('reasons') && (
          <p className="mt-1 text-[0.8125rem] font-medium text-fix">{problem('reasons')}</p>
        )}
        <ul className="mt-2 space-y-2">
          {plan.reasons.map((r, k) => (
            <li key={k} className="flex gap-2">
              <input
                aria-label={`Reason ${k + 1}`}
                className={`h-11 min-w-0 flex-1 ${FIELD}`}
                value={r.why}
                onChange={(e) => setReason(k, { why: e.target.value })}
                list="reasons"
              />
              <input
                aria-label={`Count for reason ${k + 1}`}
                inputMode="numeric"
                className={`h-11 w-24 ${FIELD} ${bad.includes(`reason:${k}`) ? 'border-fix' : ''}`}
                value={r.n}
                aria-invalid={bad.includes(`reason:${k}`) || undefined}
                onChange={(e) => setReason(k, { n: e.target.value })}
              />
              <button
                type="button"
                aria-label={`Remove reason ${k + 1}`}
                onClick={() => patch((p) => ({ reasons: p.reasons.filter((_, j) => j !== k) }))}
                className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-field text-ink-3 hover:bg-surface-2 hover:text-ink [&_svg]:size-4"
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
        {bad.some((k) => k.startsWith('reason:')) && (
          <p className="mt-1.5 text-[0.8125rem] font-medium text-fix">{DIGITS}</p>
        )}
        <datalist id="reasons">
          {REASONS.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={() => patch((p) => ({ reasons: [...p.reasons, { why: '', n: '' }] }))}
          className={buttonClass('ghost', 'sm', 'mt-2')}
        >
          <PlusIcon />
          Another reason
        </button>
      </fieldset>
      <Num
        label="Studies included"
        hint={`Leave empty if each report is one study (${f.reports} so far). Fewer when several reports describe one study.`}
        value={plan.studies}
        onChange={(studies) => patch({ studies })}
        problem={problem('studies')}
      />
      <Field
        label="Gaps you noticed"
        hint="What the records do not cover: a setting, a group, a method. Useful for the rationale."
      >
        {(id) => (
          <textarea
            id={id}
            className={AREA}
            value={plan.gaps}
            onChange={(e) => patch({ gaps: e.target.value })}
          />
        )}
      </Field>
    </div>
  )
}

/** One box of the flow, its number large: on the main path, tied to the next by a line; or aside
 *  (dashed, quieter), tied to its main box, for what left the path. The last box, what the review
 *  is left with, is set apart once the numbers are in. */
const Box = ({
  label,
  n,
  children,
  aside = false,
  last = false,
  lit = false,
}: {
  label: string
  n: number
  children?: ReactNode
  aside?: boolean
  last?: boolean
  lit?: boolean
}) => (
  <div
    data-print="avoid-break"
    className={`relative rounded-field border px-3.5 py-2.5 text-sm ${
      aside
        ? 'border-dashed border-line text-ink-2 sm:before:absolute sm:before:top-1/2 sm:before:right-full sm:before:w-3 sm:before:border-t sm:before:border-dashed sm:before:border-line'
        : `${lit ? 'border-ok/40 bg-ok-soft' : 'border-line bg-surface'} text-ink shadow-(--shadow-elev-1) ${last ? '' : 'sm:after:absolute sm:after:top-full sm:after:left-1/2 sm:after:h-3 sm:after:w-px sm:after:bg-ink-3/50'}`
    }`}
  >
    <p className="flex items-baseline justify-between gap-3">
      <span className="font-semibold">{label}</span>
      <span
        className={`font-display text-2xl leading-none tabular-nums ${aside ? 'text-ink-2' : lit ? 'text-ok' : 'text-ink'}`}
      >
        {n.toLocaleString('en')}
      </span>
    </p>
    {children && <div className="mt-1 space-y-0.5 text-[0.8125rem] leading-snug">{children}</div>}
  </div>
)

type FlowBox = { label: string; n: number; detail?: ReactNode }

/** The PRISMA 2020 flow, as the diagram lays it out: the main path down the middle, what left it
 *  aside, the stages named at the left. */
function FlowDiagram({ f }: { f: Flow }) {
  const n = (x: number) => x.toLocaleString('en')
  const rows: { band?: string; main: FlowBox; aside?: FlowBox }[] = [
    {
      band: 'Identification',
      main: {
        label: 'Records identified',
        n: f.identified,
        detail: (
          <>
            {f.bySource.map((s) => (
              <p key={s.name}>
                {s.name}: {n(s.n)}
              </p>
            ))}
            {f.registers > 0 && <p>Registers: {n(f.registers)}</p>}
            {!f.identified && <p className="text-ink-3">Log the counts in step 3.</p>}
          </>
        ),
      },
      aside: {
        label: 'Removed before screening',
        n: f.removed,
        detail: <p>Duplicates, automation, other reasons</p>,
      },
    },
    {
      band: 'Screening',
      main: { label: 'Records screened', n: f.screened, detail: <p>By title and abstract</p> },
      aside: { label: 'Records excluded', n: f.excluded },
    },
    {
      main: { label: 'Reports sought', n: f.sought, detail: <p>Full texts to read</p> },
      aside: { label: 'Reports not retrieved', n: f.notRetrieved },
    },
    {
      main: { label: 'Reports assessed', n: f.assessed, detail: <p>For eligibility</p> },
      aside: {
        label: 'Reports excluded',
        n: f.reasons.reduce((a, r) => a + r.n, 0),
        detail: f.reasons.length ? (
          <>
            {f.reasons.map((r, k) => (
              <p key={k}>
                {r.why}: {n(r.n)}
              </p>
            ))}
          </>
        ) : undefined,
      },
    },
    {
      band: 'Included',
      main: {
        label: 'Studies included',
        n: f.studies,
        detail: <p>Reports of included studies: {n(f.reports)}</p>,
      },
    },
  ]
  return (
    <div
      role="group"
      aria-label="PRISMA 2020 flow"
      className="grid gap-3 sm:grid-cols-[6.5rem_1fr_1fr]"
    >
      {rows.map((r, k) => (
        <Fragment key={k}>
          <p
            className={`font-display text-lg text-maroon sm:pt-1 ${r.band ? (k ? 'mt-3 sm:mt-0' : '') : 'hidden sm:block'}`}
          >
            {r.band}
          </p>
          <Box
            label={r.main.label}
            n={r.main.n}
            last={k === rows.length - 1}
            lit={k === rows.length - 1 && f.screening}
          >
            {r.main.detail}
          </Box>
          {r.aside ? (
            <Box aside label={r.aside.label} n={r.aside.n}>
              {r.aside.detail}
            </Box>
          ) : (
            <div className="hidden sm:block" />
          )}
        </Fragment>
      ))}
    </div>
  )
}

function Verdict({ f }: { f: Flow }) {
  const v = verdict(f)
  const { icon: Icon, tone } = STATUS[v.tone]
  return (
    <div
      className="rounded-card border border-line bg-surface p-5 shadow-(--shadow-elev-1)"
      aria-live="polite"
    >
      <span
        className={`inline-flex size-9 items-center justify-center rounded-pill [&_svg]:size-4.5 ${tone}`}
      >
        <Icon strokeWidth={2.5} />
      </span>
      <p className="mt-3 font-display text-2xl leading-tight text-ink">{v.head}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{v.body}</p>
      {f.problems.map((x) => (
        <p key={x.about} className="mt-2 text-sm font-medium text-fix">
          {x.text}
        </p>
      ))}
    </div>
  )
}

// Where a thesis reports things, as the "where" fields offer them; any other words can be typed.
const SECTIONS = [
  'Title page',
  'Abstract',
  'Introduction',
  'Review of literature',
  'Methods',
  'Results',
  'Discussion',
  'Conclusions and recommendations',
  'References',
  'Appendix',
  'Not applicable',
]

/** The sections of the main checklist, in order, and the id of each section's first row. */
const SECTIONS_OF = [...new Set(MAIN.map((i) => i.section))]
const sectionId = (section: string) => `prisma-${section.toLowerCase().replace(/\W+/g, '-')}`

/** One checklist row. Memoised, with stable handlers: typing a location re-renders that row, not
 *  the forty-one others. */
const ChecklistRow = memo(function ChecklistRow({
  item: i,
  first,
  draft,
  where,
  reported,
  onWhere,
  onReported,
}: {
  item: PrismaItem
  /** The first row of its section, which it names. */
  first: boolean
  /** What this plan already drafts for the item. */
  draft: string
  where?: string
  reported?: 'yes' | 'no'
  /** Given for the main checklist (a location to write) ... */
  onWhere?: (id: string, v: string) => void
  /** ... or for the abstract checklist (reported, yes or no). */
  onReported?: (id: string, v: 'yes' | 'no') => void
}) {
  return (
    <li
      id={first ? sectionId(i.section) : undefined}
      data-print="avoid-break"
      className="grid scroll-mt-36 gap-x-4 gap-y-2 p-4 md:grid-cols-[3rem_1fr_14rem]"
    >
      {first && <h3 className="font-display text-lg text-maroon md:col-span-3">{i.section}</h3>}
      <span className="font-display text-xl text-ink-3 tabular-nums">{itemNumber(i.id)}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{i.topic}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-ink-2">{i.text}</p>
        {draft && (
          <p className="mt-2 rounded-chip bg-ok-soft px-3 py-2 text-[0.8125rem] leading-relaxed text-ok">
            <span className="font-semibold">Drafted in this plan: </span>
            {draft}
          </p>
        )}
      </div>
      {onWhere ? (
        <label className="text-sm">
          <span className="sr-only">Where item {i.id} is reported</span>
          <input
            className={INPUT}
            value={where ?? ''}
            onChange={(e) => onWhere(i.id, e.target.value)}
            placeholder="Section or page"
            list="thesis-sections"
          />
        </label>
      ) : (
        <div className="flex gap-1" role="group" aria-label={`Item ${itemNumber(i.id)} reported`}>
          {(['yes', 'no'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={reported === v}
              onClick={() => onReported?.(i.id, v)}
              className={`${PILL} h-9 px-3`}
            >
              {v === 'yes' ? 'Reported' : 'Not yet'}
            </button>
          ))}
        </div>
      )}
    </li>
  )
})

function PlanStep({ plan, patch }: { plan: Plan; patch: Patch }) {
  const [tab, setTab] = useState<'main' | 'abstract'>('main')
  const items = tab === 'main' ? MAIN : ABSTRACT
  const located = MAIN.filter((i) => (plan.where[i.id] ?? '').trim()).length
  const onWhere = useCallback(
    (id: string, v: string) => patch((p) => ({ where: { ...p.where, [id]: v } })),
    [patch],
  )
  const onReported = useCallback(
    (id: string, v: 'yes' | 'no') =>
      patch((p) => ({
        abstract: { ...p.abstract, [id]: p.abstract[id] === v ? undefined : v },
      })),
    [patch],
  )
  return (
    <div className="space-y-6">
      <datalist id="thesis-sections">
        {SECTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl space-y-2 text-sm leading-relaxed text-ink-2">
          <p>
            {ENDORSEMENT}{' '}
            <a href={PRISMA_HOME} target="_blank" rel="noopener noreferrer" className={LINK}>
              prisma-statement.org
            </a>
            {' · '}
            <a href={PRISMA_FLOW} target="_blank" rel="noopener noreferrer" className={LINK}>
              flow diagram template
            </a>
            {' · '}
            <a href={PRISMA_EXTENSIONS} target="_blank" rel="noopener noreferrer" className={LINK}>
              extensions
            </a>
            {' · '}
            <a href={PRISMA_ENDORSEMENT} target="_blank" rel="noopener noreferrer" className={LINK}>
              what PRISMA asks of endorsers
            </a>
          </p>
          {plan.kind === 'scope' && (
            <p className="font-medium text-ink">
              Your plan is a scoping review: report it with{' '}
              <a href={PRISMA_SCOPING} target="_blank" rel="noopener noreferrer" className={LINK}>
                PRISMA-ScR
              </a>
              , the extension for scoping reviews. The PRISMA 2020 checklist below covers the items
              the two share.
            </p>
          )}
          <p>
            The checklist as published. Items the plan already drafts are marked; write the section
            or page where each item will be reported, as the checklist asks, or “Not applicable” for
            an item your kind of review has no use for (a qualitative or scoping review makes no
            meta-analysis). Your adviser and your program decide which items a thesis needs.{' '}
            <span className="font-semibold text-ink">
              {located} of {MAIN.length} located so far.
            </span>
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Checklist"
          className="flex gap-1 rounded-pill border border-line bg-surface p-1"
        >
          {(['main', 'abstract'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className="h-9 cursor-pointer rounded-pill px-4 text-sm font-semibold text-ink-2 transition-colors aria-selected:bg-action aria-selected:text-on-action"
            >
              {t === 'main'
                ? `Main (${MAIN.filter((i) => !/[b-z]$/.test(i.id)).length} items)`
                : `Abstract (${ABSTRACT.length} items)`}
            </button>
          ))}
        </div>
      </div>
      {tab === 'main' && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div
            className="h-2 w-40 overflow-hidden rounded-pill bg-line"
            role="progressbar"
            aria-label="Items located"
            aria-valuenow={located}
            aria-valuemin={0}
            aria-valuemax={MAIN.length}
          >
            <div
              className="h-full rounded-pill bg-band-forest transition-[width] duration-300 dark:bg-ok"
              style={{ width: `${(100 * located) / MAIN.length}%` }}
            />
          </div>
          <nav aria-label="Checklist sections" className="flex flex-wrap gap-1">
            {SECTIONS_OF.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  const row = document.getElementById(sectionId(s))
                  row?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  row?.querySelector('input, button')?.dispatchEvent(new Event('focus'))
                }}
                className="cursor-pointer rounded-pill px-2.5 py-1 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                {s}
              </button>
            ))}
          </nav>
        </div>
      )}
      <ol className="divide-y divide-line rounded-card border border-line bg-surface shadow-(--shadow-elev-1)">
        {items.map((i, k) => (
          <ChecklistRow
            key={i.id}
            item={i}
            first={items[k - 1]?.section !== i.section}
            draft={tab === 'main' ? drafted(plan, i.id) : ''}
            where={plan.where[i.id]}
            reported={plan.abstract[i.id]}
            onWhere={tab === 'main' ? onWhere : undefined}
            onReported={tab === 'main' ? undefined : onReported}
          />
        ))}
      </ol>
      <p className="text-[0.8125rem] leading-relaxed text-ink-3">
        From: {PRISMA_CITATION}. Licensed under{' '}
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          CC BY 4.0
        </a>
        . The checklist can also be filled in on{' '}
        <a
          href={PRISMA_SITE}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          prisma-statement.org
        </a>{' '}
        or its{' '}
        <a
          href={PRISMA_APP}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          checklist app
        </a>
        .
      </p>
    </div>
  )
}

/** A file name from the plan's title or interest: letters, digits and plain punctuation only. */
const fileName = (p: Plan) =>
  (workingTitle(p) || p.interest || 'untitled')
    .replace(/[^\p{L}\p{N}\p{M} ,.'()&+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)

// ---- The plans kept in this browser ----

/** Up to three candidate topics, the one in hand, and the step the student was at. */
interface Kept {
  plans: Plan[]
  current: number
  step: Step
}
const MAX_PLANS = 3
const LETTERS = ['A', 'B', 'C']
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object'
const stepOf = (x: unknown): Step => (STEPS.includes(x as Step) ? (x as Step) : 'question')

/** The plans kept here, else the single plan an earlier version kept, else one blank plan. */
function loadPlans(): Kept {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PLANS_KEY) ?? 'null')
    if (isObj(raw) && Array.isArray(raw.plans) && raw.plans.length) {
      const plans = raw.plans.slice(0, MAX_PLANS).map(sane)
      const at = Number.isInteger(raw.current) ? (raw.current as number) : 0
      return { plans, current: Math.min(Math.max(0, at), plans.length - 1), step: stepOf(raw.step) }
    }
    const old: unknown = JSON.parse(localStorage.getItem(OLD_PLAN_KEY) ?? 'null')
    if (isObj(old) && old.plan)
      return { plans: [sane(old.plan)], current: 0, step: stepOf(old.step) }
  } catch {
    // Storage blocked or unreadable: start fresh.
  }
  return { plans: [blank()], current: 0, step: 'question' }
}

function storePlans(k: Kept) {
  try {
    localStorage.setItem(PLANS_KEY, JSON.stringify(k))
    localStorage.removeItem(OLD_PLAN_KEY)
  } catch {
    // Storage blocked (a private window): the plans last while the page is open.
  }
}

/** The candidate topics: the one in hand and the others a tap away, each with the size its
 *  numbers show, so two or three ideas can be weighed side by side. */
function Candidates({
  plans,
  current,
  onPick,
  onAdd,
  onRemove,
}: {
  plans: Plan[]
  current: number
  onPick: (i: number) => void
  onAdd: () => void
  onRemove: () => void
}) {
  const name = (p: Plan, i: number) => p.interest.trim() || workingTitle(p) || `Topic ${LETTERS[i]}`
  const size = (p: Plan) => {
    const pf = flow(p)
    const v = verdict(pf)
    if (!pf.identified) return v.head
    const h = hours(pf).total
    const work = pf.screening
      ? ` · ${pf.studies} ${pf.studies === 1 ? 'study' : 'studies'}${h ? `, about ${h} h` : ''}`
      : ''
    return `${pf.identified.toLocaleString('en')} records${work} · ${v.head}`
  }
  return (
    <div className={CARD} data-print="hide">
      <h2 className="text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">
        Candidate topics
      </h2>
      {plans.length > 1 ? (
        <ul className="mt-1 divide-y divide-line" aria-label="Candidate topics">
          {plans.map((p, i) => (
            <li key={i}>
              <button
                type="button"
                aria-pressed={i === current}
                onClick={() => onPick(i)}
                className="flex w-full cursor-pointer items-baseline gap-3 rounded-sm py-2.5 text-left text-ink-2 transition-colors hover:text-ink aria-pressed:text-ink"
              >
                <span className="font-display text-xl text-maroon">{LETTERS[i]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{name(p, i)}</span>
                  <span className="block text-[0.8125rem] text-ink-3">{size(p)}</span>
                </span>
                {i === current && (
                  <CheckIcon className="size-4 shrink-0 self-center text-ok" strokeWidth={2.5} />
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          Weighing two or three ideas? Keep each as its own topic and compare their size here.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {plans.length < MAX_PLANS && (
          <button type="button" onClick={onAdd} className={buttonClass('secondary', 'sm')}>
            <PlusIcon />
            Another topic
          </button>
        )}
        {plans.length > 1 && (
          <button type="button" onClick={onRemove} className={buttonClass('ghost', 'sm')}>
            Remove this topic
          </button>
        )}
      </div>
    </div>
  )
}

// ---- The tab ----

export default function Topic() {
  const [kept, setKept] = useState(loadPlans)
  const { plans, current, step } = kept
  const plan = plans[current]
  const first = useRef(true)
  useEffect(() => {
    if (first.current) first.current = false
    else storePlans(kept)
  }, [kept])
  // (stable, so the memoised rows below keep their handlers)
  const patch: Patch = useCallback(
    (p) =>
      setKept((k) => {
        const was = k.plans[k.current]
        const now = { ...was, ...(typeof p === 'function' ? p(was) : p) }
        return { ...k, plans: k.plans.map((x, i) => (i === k.current ? now : x)) }
      }),
    [],
  )
  /** A whole plan into the slot in hand, back at the first step. */
  const replace = (next: Plan) =>
    setKept((k) => ({
      ...k,
      step: 'question',
      plans: k.plans.map((x, i) => (i === k.current ? next : x)),
    }))
  const go = (step: Step) => {
    setKept((k) => ({ ...k, step }))
    document.getElementById('topic-step')?.focus({ preventScroll: true })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const at = STEPS.indexOf(step)
  const c = criteria(plan)
  const f = flow(plan)
  const miss = missing(plan, step)
  const ai = useAi()
  const started = elementsOf(plan).some((e) => (plan.parts[e.id] ?? '').trim())
  // (the Word writer is its own chunk: fetched when a download button is about to be pressed)
  const warm = () => void import('../topic/docx')
  const download = () =>
    void import('../topic/docx').then(({ planDocx }) =>
      saveFile(
        planDocx(plan),
        `Topic plan - ${fileName(plan)}.docx`,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    )
  // A copy of the plan as a file: for another device, or for after the browser's storage is
  // cleared. Opened, it goes into a free slot, or takes the place of the plan in hand.
  const fileRef = useRef<HTMLInputElement>(null)
  const [openError, setOpenError] = useState<string>()
  const saveCopy = () =>
    saveFile(
      new TextEncoder().encode(JSON.stringify({ plan }, null, 2)),
      `Topic plan - ${fileName(plan)}.json`,
      'application/json',
    )
  const openCopy = (file: File) =>
    void file.text().then((text) => {
      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        setOpenError('That file is not a plan saved from this page.')
        return
      }
      const next = sane(isObj(raw) && 'plan' in raw ? raw.plan : raw)
      if (!elementsOf(next).some((e) => (next.parts[e.id] ?? '').trim()) && !next.interest) {
        setOpenError('That file holds no plan.')
        return
      }
      if (
        started &&
        plans.length >= MAX_PLANS &&
        !confirm('Replace the plan in hand with this copy?')
      )
        return
      setOpenError(undefined)
      setKept((k) => {
        const into = started && k.plans.length < MAX_PLANS ? k.plans.length : k.current
        return {
          plans:
            into === k.plans.length
              ? [...k.plans, next]
              : k.plans.map((x, i) => (i === into ? next : x)),
          current: into,
          step: 'question',
        }
      })
    })

  return (
    <>
      <nav aria-label="Planning steps" className="mt-2" data-print="hide">
        <ol className="grid grid-cols-5 gap-2 sm:gap-3">
          {STEPS.map((s, k) => {
            const ok = done(plan, s)
            return (
              <li key={s} aria-current={k === at ? 'step' : undefined} className="min-w-0">
                <button
                  type="button"
                  onClick={() => go(s)}
                  aria-label={`Step ${k + 1}: ${STEP_NAMES[s].name}${ok ? ', done' : ''}`}
                  className="group w-full cursor-pointer rounded-sm text-left"
                >
                  <div className="relative h-2 overflow-hidden rounded-pill bg-line">
                    <div
                      className={`absolute inset-0 origin-left rounded-pill transition-transform duration-500 ease-out-soft ${
                        ok ? 'bg-band-forest dark:bg-ok' : 'bg-band-gold'
                      } ${ok || k === at ? 'scale-x-100' : 'scale-x-0'}`}
                    />
                  </div>
                  <p className="mt-2.5 flex items-baseline gap-2">
                    <span
                      className={`font-display text-2xl leading-none tabular-nums ${k === at ? 'text-ink' : 'text-ink-3'}`}
                    >
                      {k + 1}
                    </span>
                    <span
                      className={`hidden truncate text-sm font-semibold group-hover:text-ink sm:block ${k === at ? 'text-ink' : 'text-ink-3'}`}
                    >
                      {STEP_NAMES[s].name}
                    </span>
                    {ok && (
                      <CheckIcon
                        className="hidden size-4 shrink-0 text-ok sm:block"
                        strokeWidth={2.5}
                      />
                    )}
                  </p>
                  <p className="mt-0.5 hidden text-xs text-ink-3 md:block">{STEP_NAMES[s].hint}</p>
                </button>
              </li>
            )
          })}
        </ol>
        {/* (a phone has room for the numbers only: the current step is named below them) */}
        <p className="mt-3 text-sm text-ink-2 sm:hidden">
          <span className="font-semibold text-ink">
            Step {at + 1} of {STEPS.length}: {STEP_NAMES[step].name}.
          </span>{' '}
          {STEP_NAMES[step].hint}
        </p>
      </nav>

      <section className="grid gap-x-12 gap-y-10 py-10 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7 xl:col-span-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1
                id="topic-step"
                tabIndex={-1}
                className="font-display text-title text-ink outline-none"
              >
                {at === 0 ? 'Shape your review topic' : STEP_NAMES[step].name}
              </h1>
              {at === 0 && (
                <p className="mt-4 max-w-[36rem] leading-relaxed text-ink-2 sm:text-lg">
                  Write a systematic or scoping review question from its parts, set the criteria,
                  search, and see from the numbers whether the topic is the right size. The plan
                  stays in this browser, and goes to your adviser as a Word file.
                </p>
              )}
            </div>
            {at === 0 && !plan.interest && !questionReady(plan) && (
              <button
                type="button"
                onClick={() => replace(EXAMPLE)}
                data-print="hide"
                className={buttonClass('secondary', 'sm')}
              >
                Try an example
              </button>
            )}
          </div>
          {/* (keyed by step: each step's content enters afresh, with a short rise) */}
          <div className="mt-8 motion-safe:animate-rise" key={step}>
            {step === 'question' && <QuestionStep plan={plan} patch={patch} ai={ai} />}
            {step === 'criteria' && <CriteriaStep plan={plan} patch={patch} />}
            {step === 'search' && <SearchStep plan={plan} patch={patch} />}
            {step === 'screen' && (
              <div className="space-y-10">
                <ScreenStep plan={plan} patch={patch} f={f} />
                <div>
                  <h2 className="font-display text-3xl text-ink">Your PRISMA 2020 flow</h2>
                  <div className="mt-5">
                    <FlowDiagram f={f} />
                  </div>
                  <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-2">
                    These are the numbers of your PRISMA 2020 flow diagram, which a systematic
                    review reports. Draw the diagram itself with the{' '}
                    <a
                      href={PRISMA_FLOW}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={LINK}
                    >
                      template on the PRISMA website
                    </a>
                    , with each reason for exclusion and its count, as here.
                  </p>
                </div>
              </div>
            )}
            {step === 'plan' && <PlanStep plan={plan} patch={patch} />}
          </div>
          {miss.length > 0 && (
            <p className="mt-10 text-sm leading-relaxed text-ink-2">
              <span className="font-semibold text-ink">To finish this step:</span> {prose(miss)}.
            </p>
          )}
          <div
            data-print="hide"
            className={`${miss.length ? 'mt-5' : 'mt-10'} flex flex-wrap items-center gap-3 border-t border-line pt-6`}
          >
            {at > 0 && (
              <button
                type="button"
                onClick={() => go(STEPS[at - 1])}
                className={buttonClass('secondary')}
              >
                Back
              </button>
            )}
            {at < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => go(STEPS[at + 1])}
                className={buttonClass('primary')}
              >
                Next: {STEP_NAMES[STEPS[at + 1]].name}
              </button>
            ) : (
              <button
                type="button"
                onClick={download}
                onPointerEnter={warm}
                onFocus={warm}
                className={buttonClass('primary')}
              >
                <DownloadIcon />
                Download the plan (.docx)
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (confirm('Clear this plan and start again?')) replace(blank())
              }}
              className={buttonClass('ghost', 'md', 'ml-auto')}
            >
              <RestartIcon />
              Start over
            </button>
          </div>
        </div>

        <aside className="lg:col-span-5 xl:col-span-4" aria-label="Your plan so far">
          <div className="space-y-4 lg:sticky lg:top-[calc(4rem+3.5rem)]">
            <div className={CARD}>
              <h2 className="text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">
                Your question
              </h2>
              <div className="mt-2">
                {started || step !== 'question' ? (
                  <Question plan={plan} />
                ) : (
                  <p className="text-sm text-ink-3">It takes shape as you write its parts.</p>
                )}
              </div>
              {objective(plan) && (
                <p className="mt-3 text-sm leading-relaxed text-ink-2">{objective(plan)}</p>
              )}
              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-ink-3">Frame</dt>
                <dd className="text-ink">
                  {KINDS[plan.kind].framework}, a {KINDS[plan.kind].review}
                </dd>
                <dt className="text-ink-3">Include</dt>
                <dd className="text-ink">
                  {c.include.length ? (
                    `${c.include.length} criteria`
                  ) : (
                    <span className="text-ink-3">not yet set</span>
                  )}
                </dd>
                <dt className="text-ink-3">Search</dt>
                <dd className="min-w-0 truncate font-mono text-[0.8125rem] text-ink">
                  {searchString(plan) || (
                    <span className="font-sans text-ink-3">not yet built</span>
                  )}
                </dd>
              </dl>
            </div>
            <Verdict f={f} />
            <Candidates
              plans={plans}
              current={current}
              onPick={(i) => setKept((k) => ({ ...k, current: i }))}
              onAdd={() =>
                setKept((k) =>
                  k.plans.length < MAX_PLANS
                    ? { plans: [...k.plans, blank()], current: k.plans.length, step: 'question' }
                    : k,
                )
              }
              onRemove={() => {
                if (started && !confirm('Remove this topic and everything written for it?')) return
                setKept((k) => {
                  if (k.plans.length < 2) return k
                  const rest = k.plans.filter((_, i) => i !== k.current)
                  return { ...k, plans: rest, current: Math.min(k.current, rest.length - 1) }
                })
              }}
            />
            <div className="flex flex-wrap gap-2" data-print="hide">
              <Copy text={question(plan)} label="Copy question" />
              <button
                type="button"
                onClick={download}
                onPointerEnter={warm}
                onFocus={warm}
                className={buttonClass('secondary', 'sm')}
              >
                <DownloadIcon />
                Word file
              </button>
              <button type="button" onClick={saveCopy} className={buttonClass('ghost', 'sm')}>
                Save a copy
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={buttonClass('ghost', 'sm')}
              >
                Open a copy
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) openCopy(f)
                  e.target.value = ''
                }}
              />
            </div>
            {openError && (
              <p role="alert" className="text-[0.8125rem] font-medium text-fix">
                {openError}
              </p>
            )}
            <p className="text-[0.8125rem] leading-relaxed text-ink-3">
              Kept in this browser only, on this device. Nothing you type is sent anywhere. A saved
              copy (a .json file) opens here on another device, or after this browser’s storage is
              cleared.
            </p>
            <p className="text-[0.8125rem] leading-relaxed text-ink-3">
              Built around the PRISMA 2020 statement: Page MJ, McKenzie JE, Bossuyt PM, et al. BMJ
              2021;372:n71,{' '}
              <a
                href="https://doi.org/10.1136/bmj.n71"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                doi:10.1136/bmj.n71
              </a>
              . Its checklists are reproduced under CC BY 4.0 from{' '}
              <a
                href={PRISMA_SITE}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                prisma-statement.org
              </a>
              .
            </p>
            <p className="text-[0.8125rem] leading-relaxed text-ink-3">
              This page took its shape from the{' '}
              <a
                href={PRISMA_SITE}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                PRISMA 2020 checklist page
              </a>
              , the PRISMA group’s{' '}
              <a
                href={PRISMA_APP}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                checklist app
              </a>{' '}
              and its{' '}
              <a
                href={PRISMA_ENDORSEMENT}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                endorsement page
              </a>
              .
            </p>
          </div>
        </aside>
      </section>
    </>
  )
}
