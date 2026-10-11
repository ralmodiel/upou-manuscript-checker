// The page: header and notice, the three-stage rail, the stage itself (Prepare, Check, Correct),
// the questions and the footer. A file dropped anywhere on the page is checked; dropping it never
// navigates away.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Report } from './engine/report'
import { decodeImage, loadPdfJs } from './lib/browser'
import Checking, { type Progress } from './components/Checking'
import Correct from './components/Correct'
import Faq from './components/Faq'
import Footer from './components/Footer'
import Header from './components/Header'
import Prepare from './components/Prepare'
import StepRail from './components/StepRail'

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
  const checking = view.stage === 'check'

  const onFile = useCallback(async (file: File) => {
    const id = ++run.current
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
      console.error(e)
      const known = e instanceof Error && e.name === 'FileProblem'
      setView({ stage: 'prepare', error: known ? (e as Error).message : GENERIC })
    }
  }, [])

  const restart = useCallback(() => {
    run.current++
    setView({ stage: 'prepare' })
  }, [])

  // The checking engine loads once the page is idle, so the first check starts at once; pdf.js
  // (the heaviest part) still waits for a PDF.
  useEffect(() => {
    const load = () => void import('./engine/check')
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(load, { timeout: 4000 })
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(load, 1500)
    return () => clearTimeout(id)
  }, [])

  // Each stage's heading takes focus, so screen readers announce where the visitor now is.
  useEffect(() => {
    const h = document.querySelector<HTMLElement>('main h1')
    h?.focus({ preventScroll: true })
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
      if (file && !checking) void onFile(file)
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
  }, [checking, onFile])

  const stage = view.stage === 'prepare' ? 'prepare' : view.stage
  return (
    <div id="top" className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-pill bg-action px-4 py-2 font-semibold text-on-action focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Header onHome={() => !checking && restart()} />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-(--gutter) pt-8">
        <StepRail stage={stage} busy={checking} />
        {view.stage === 'prepare' && view.error && (
          <p
            role="alert"
            className="mt-8 rounded-card border border-fix/30 bg-fix-soft px-5 py-4 text-sm leading-relaxed text-ink"
          >
            <strong className="font-semibold text-fix">That file could not be checked. </strong>
            {view.error}
          </p>
        )}
        {view.stage === 'prepare' && <Prepare onFile={onFile} dragging={dragging} />}
        {view.stage === 'check' && <Checking name={view.name} progress={view.progress} />}
        {view.stage === 'correct' && <Correct report={view.report} onRestart={restart} />}
        <Faq />
      </main>
      <Footer />
    </div>
  )
}
