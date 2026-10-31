// The page: header and notice, the three-stage rail, the stage itself (Prepare, Check, Correct),
// the questions and the footer. A file dropped anywhere on the page is checked (a new one replaces a
// check still running); dropping it never navigates away.
import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Report } from './engine/report'
import { clearPlans } from './topic/store'
import { decodeImage, isStale, loadPdfJs, STALE } from './lib/browser'
import Checking, { type Progress } from './components/Checking'
import Correct from './components/Correct'
import Faq from './components/Faq'
import Footer from './components/Footer'
import Header from './components/Header'
import Prepare from './components/Prepare'
import StepRail from './components/StepRail'
import { CompassIcon, PageIcon } from './components/icons'

// The topic planner is its own part of the site, fetched when its tab is opened (or about to be:
// the pointer over the tab, or the page idle). If that fails after a new version was published,
// the tab says so instead of the whole page going blank.
const loadTopic = () => import('./components/Topic')
const Topic = lazy(() =>
  loadTopic().catch(() => ({
    default: () => (
      <p role="alert" className="py-10 text-sm leading-relaxed text-ink-2">
        {STALE}
      </p>
    ),
  })),
)

// The planner draws on a plan kept in this browser. Should a saved plan ever break its render, the
// rest of the page stays up and the student can let the plans go, instead of a blank site that
// comes back blank on every visit.
class TopicBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <p role="alert" className="py-10 text-sm leading-relaxed text-ink-2">
        The Topic planner could not be shown.{' '}
        <button
          type="button"
          onClick={() => {
            clearPlans()
            location.reload()
          }}
          className="cursor-pointer font-semibold text-maroon underline underline-offset-2"
        >
          Start over
        </button>{' '}
        clears the plans kept in this browser and opens the page again.
      </p>
    )
  }
}

export type Tab = 'check' | 'topic'
const tabFromHash = (): Tab => (location.hash === '#topic' ? 'topic' : 'check')

type View =
  | { stage: 'prepare'; error?: string }
  | { stage: 'check'; name: string; progress: Progress }
  | { stage: 'correct'; report: Report }

const GENERIC =
  'This file could not be read. It may be damaged or in a form this checker does not know. Save it again as Word (.docx) or PDF and check that.'

const nextPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))

export default function App() {
  const [view, setView] = useState<View>({ stage: 'prepare' })
  const [dragging, setDragging] = useState(false)
  const run = useRef(0)

  // The two tabs: the format check (the page itself) and the topic planner (#topic), so a link
  // can open either.
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const pick = useCallback((t: Tab) => {
    setTab(t)
    if (tabFromHash() !== t)
      history.replaceState(null, '', t === 'topic' ? '#topic' : location.pathname + location.search)
  }, [])
  useEffect(() => {
    // (only the two tabs' own hashes switch tabs: a link to a part of the page, such as the
    // questions or the notice, must not throw the student out of the planner)
    const onHash = () => {
      if (location.hash === '#topic' || location.hash === '') setTab(tabFromHash())
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const onFile = useCallback(
    async (file: File) => {
      const id = ++run.current
      pick('check')
      setView({ stage: 'check', name: file.name, progress: { step: 'reading' } })
      window.scrollTo({ top: 0 })
      await nextPaint()
      try {
        const [bytes, engine] = await Promise.all([file.arrayBuffer(), import('./engine/check')])
        const report = await engine.check(file.name, new Uint8Array(bytes), {
          pdfjs: loadPdfJs,
          env: { decodeImage },
          progress: (step, done, total) => {
            if (run.current === id)
              setView((v) => (v.stage === 'check' ? { ...v, progress: { step, done, total } } : v))
          },
        })
        if (run.current === id) setView({ stage: 'correct', report })
      } catch (e) {
        if (run.current !== id) return
        const known = e instanceof Error && e.name === 'FileProblem'
        if (!known) console.error(e)
        setView({
          stage: 'prepare',
          error: isStale() ? STALE : known ? (e as Error).message : GENERIC,
        })
      }
    },
    [pick],
  )

  const restart = useCallback(() => {
    run.current++
    setView({ stage: 'prepare' })
  }, [])

  // The checking engine loads once the page is idle, so the first check starts at once; pdf.js
  // (the heaviest part) still waits for a PDF. The topic planner follows it.
  useEffect(() => {
    const load = () => void import('./engine/check').finally(loadTopic)
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(load, { timeout: 4000 })
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(load, 1500)
    return () => clearTimeout(id)
  }, [])

  // Each new stage's heading takes focus, so screen readers announce where the visitor now is. Not on
  // the first load: there the skip link and header come first.
  const shown = useRef(view.stage)
  useEffect(() => {
    if (shown.current === view.stage) return
    shown.current = view.stage
    // The result starts at the top, even if the page was scrolled while the file was read.
    if (view.stage === 'correct') window.scrollTo({ top: 0, behavior: 'instant' })
    // An error takes focus itself, so screen readers read it rather than stop at the heading.
    const target =
      document.querySelector<HTMLElement>('main [role=alert]') ??
      document.querySelector<HTMLElement>('main h1')
    target?.focus({ preventScroll: true })
  }, [view.stage])

  // Drop a file anywhere: the browser would otherwise open it and leave the page.
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) =>
      !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      setDragging(true)
    }
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setDragging(false)
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      const file = e.dataTransfer?.files[0]
      if (file) void onFile(file)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [onFile])

  return (
    <div id="top" className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-pill bg-action px-4 py-2 font-semibold text-on-action focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <Header
        onHome={() => {
          pick('check')
          restart()
        }}
        home={tab === 'check' && view.stage === 'prepare'}
        tab={tab}
        onTab={pick}
      />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-(--gutter) pt-6">
        <div
          role="tablist"
          aria-label="Tools"
          data-print="hide"
          className="mb-8 inline-flex gap-1 rounded-pill border border-line bg-surface p-1 shadow-(--shadow-elev-1)"
        >
          {(
            [
              ['check', 'Format check', PageIcon],
              ['topic', 'Topic planner', CompassIcon],
            ] as const
          ).map(([t, name, Icon]) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => pick(t)}
              onPointerEnter={t === 'topic' ? () => void loadTopic() : undefined}
              onFocus={t === 'topic' ? () => void loadTopic() : undefined}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-pill px-4 text-sm font-semibold text-ink-2 transition-colors hover:text-ink aria-selected:bg-action aria-selected:bg-(image:--gradient-action) aria-selected:text-on-action [&_svg]:size-4"
            >
              <Icon />
              {name}
            </button>
          ))}
        </div>
        {tab === 'topic' ? (
          <TopicBoundary>
            <Suspense
              fallback={
                <p className="py-10 text-sm text-ink-3" aria-busy="true">
                  Opening the Topic planner…
                </p>
              }
            >
              <Topic />
            </Suspense>
          </TopicBoundary>
        ) : (
          <>
            <StepRail stage={view.stage} busy={view.stage === 'check'} />
            {view.stage === 'prepare' && view.error && (
              <p
                role="alert"
                tabIndex={-1}
                className="mt-8 rounded-card outline-none border border-fix/30 bg-fix-soft px-5 py-4 text-sm leading-relaxed text-ink"
              >
                <strong className="font-semibold text-fix">That file could not be checked. </strong>
                {view.error}
              </p>
            )}
            {view.stage === 'prepare' && <Prepare onFile={onFile} dragging={dragging} />}
            {view.stage === 'check' && <Checking name={view.name} progress={view.progress} />}
            {view.stage === 'correct' && <Correct report={view.report} onRestart={restart} />}
          </>
        )}
        <Faq tab={tab} />
      </main>
      <Footer />
    </div>
  )
}
