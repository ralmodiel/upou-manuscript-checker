// Stage 3: the whole checklist with the file's status on every item. A summary and the downloads
// lead; then one manuscript part at a time (or all of them) beside an overview of every part.
import { useEffect, useMemo, useRef, useState } from 'react'
import { CHECKLIST, type Item } from '../engine/checklist'
import type { Finding, Report, Status } from '../engine/report'
import { saveFile } from '../lib/browser'
import { PRIVATE_SHORT, VERIFY } from '../notice'
import { reportModel, reportName } from '../report/model'
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ExternalLinkIcon,
  InfoIcon,
  PrintIcon,
  RestartIcon,
  ShieldIcon,
} from './icons'
import { buttonClass } from './styles'
import { StatusPill } from './ui'

const KIND: Record<Report['kind'], string> = {
  docx: 'Word document',
  doc: 'Word 97-2003 document',
  pdf: 'PDF',
  odt: 'OpenDocument text',
  rtf: 'Rich Text document',
}

interface PartView {
  name: string
  extra: boolean
  rows: { item: Item; finding: Finding }[]
  fix: number
  review: number
  ok: number
}

function tally(rows: PartView['rows']) {
  const n = (s: Status) => rows.filter((r) => r.finding.status === s).length
  return { fix: n('fix'), review: n('review'), ok: n('ok') }
}

function PartState({ part, compact = false }: { part: PartView; compact?: boolean }) {
  if (part.fix)
    return (
      <span className="text-sm font-semibold text-fix tabular-nums">{part.fix} to correct</span>
    )
  if (part.review)
    return (
      <span className="text-sm font-semibold text-review tabular-nums">
        {part.review} to review
      </span>
    )
  if (!part.ok) return <span className="text-sm text-ink-3">Not applicable</span>
  return (
    <span className="inline-flex items-center gap-1 text-sm font-semibold text-ok [&_svg]:size-4">
      <CheckIcon strokeWidth={2.5} />
      {compact ? 'Passed' : 'All passed'}
    </span>
  )
}

function ItemRow({ item, finding }: { item: Item; finding: Finding }) {
  const where = finding.where?.filter((w) => w.page !== undefined || w.quote) ?? []
  const open = finding.status === 'fix' || finding.status === 'review'
  return (
    <li
      className="grid grid-cols-1 gap-x-5 gap-y-2 py-5 sm:grid-cols-[9rem_minmax(0,1fr)]"
      data-print="avoid-break"
    >
      <div>
        <StatusPill status={finding.status} />
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-ink">{item.text}</p>
        <p className={`mt-1 leading-relaxed ${open ? 'text-ink' : 'text-sm text-ink-2'}`}>
          {finding.message}
        </p>
        {finding.details && finding.details.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm leading-relaxed text-ink-2">
            {finding.details.map((d, k) => (
              <li key={k} className="flex gap-2">
                <span aria-hidden="true" className="text-ink-3">
                  ›
                </span>
                <span className="min-w-0 break-words">{d}</span>
              </li>
            ))}
          </ul>
        )}
        {open && where.length > 0 && (
          <p className="mt-3 flex flex-wrap gap-1.5">
            <span className="sr-only">Where to look: </span>
            {where.slice(0, 5).map((w, k) => (
              <span
                key={k}
                className="inline-flex max-w-full items-center gap-1.5 rounded-[8px] border border-line bg-surface-2 px-2 py-1 text-xs text-ink-2"
              >
                {w.page !== undefined && (
                  <span className="shrink-0 font-semibold whitespace-nowrap text-ink tabular-nums">
                    p. {w.page + 1}
                  </span>
                )}
                {w.quote && <span className="line-clamp-2 wrap-anywhere">“{w.quote}”</span>}
              </span>
            ))}
          </p>
        )}
        {item.links && (
          <p className="mt-1 flex flex-wrap gap-x-4">
            {item.links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 py-1 text-sm font-medium text-maroon underline decoration-1 underline-offset-3 hover:decoration-2 [&_svg]:size-3.5"
              >
                {l.label}
                <ExternalLinkIcon />
              </a>
            ))}
          </p>
        )}
      </div>
    </li>
  )
}

export default function Correct({ report, onRestart }: { report: Report; onRestart: () => void }) {
  const parts = useMemo<PartView[]>(() => {
    const byId = new Map(report.findings.map((f) => [f.id, f]))
    return CHECKLIST.map((p) => {
      const rows = p.items.map((item) => ({ item, finding: byId.get(item.id)! }))
      return { name: p.name, extra: !!p.extra, rows, ...tally(rows) }
    })
  }, [report])
  const core = parts.filter((p) => !p.extra).flatMap((p) => p.rows)
  const count = (s: Status) => core.filter((r) => r.finding.status === s).length
  const fix = count('fix')
  const review = count('review')
  const ok = count('ok')
  const applicable = core.length - count('na')
  const extraFix = parts.filter((p) => p.extra).reduce((n, p) => n + p.fix, 0)

  const [current, setCurrent] = useState(() =>
    Math.max(
      0,
      parts.findIndex((p) => p.fix || p.review),
    ),
  )
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState<'docx' | 'pdf' | null>(null)
  const [failed, setFailed] = useState(false)
  const partHeading = useRef<HTMLHeadingElement>(null)
  const focusPart = useRef(false)

  useEffect(() => {
    if (!focusPart.current) return
    focusPart.current = false
    partHeading.current?.focus({ preventScroll: true })
    partHeading.current?.scrollIntoView({
      block: 'start',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }, [current])

  const go = (k: number) => {
    if (all) {
      document.getElementById(`part-${k}`)?.scrollIntoView({ block: 'start' })
      document.getElementById(`part-${k}-title`)?.focus({ preventScroll: true })
      return
    }
    focusPart.current = true
    setCurrent(k)
  }

  const download = async (kind: 'docx' | 'pdf') => {
    setBusy(kind)
    setFailed(false)
    try {
      const model = reportModel(report)
      if (kind === 'docx') {
        const { reportDocx } = await import('../report/docx')
        saveFile(
          reportDocx(model),
          reportName(report.fileName, 'docx'),
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        )
      } else {
        const { reportPdf } = await import('../report/pdf')
        saveFile(await reportPdf(model), reportName(report.fileName, 'pdf'), 'application/pdf')
      }
    } catch (e) {
      console.error(e)
      setFailed(true)
    } finally {
      setBusy(null)
    }
  }

  const headline =
    fix > 0
      ? `${fix} ${fix === 1 ? 'thing' : 'things'} to correct`
      : review > 0
        ? `Nothing to correct, ${review} to review`
        : 'Every check passed'
  const bar = [
    { n: ok, cls: 'bg-ok', label: 'passed' },
    { n: review, cls: 'bg-review', label: 'to review' },
    { n: fix, cls: 'bg-fix', label: 'to correct' },
  ]

  return (
    <div className="py-8 sm:py-10">
      <section
        aria-labelledby="result-title"
        className="rounded-card border border-line bg-surface p-5 shadow-(--shadow-elev-2) sm:p-8"
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold wrap-anywhere text-ink">{report.fileName}</p>
            <p className="mt-0.5 text-sm text-ink-3">
              {KIND[report.kind]}
              {report.pages ? ` · ${report.pages} pages` : ''} · checked in{' '}
              {(report.ms / 1000).toFixed(1)} s on this device
            </p>
            <h1
              id="result-title"
              tabIndex={-1}
              className="mt-4 font-display text-4xl leading-tight text-ink outline-none sm:text-5xl"
            >
              {headline}
            </h1>
            <p className="mt-2 text-ink-2 tabular-nums">
              <span className="font-semibold text-ok">{ok}</span> of {applicable} checks passed
              {review > 0 && (
                <>
                  {' '}
                  · <span className="font-semibold text-review">{review}</span> to review
                </>
              )}
              {extraFix > 0 && <> · also {extraFix} more noticed</>}
            </p>
          </div>
          <div
            className="flex flex-wrap gap-2 max-sm:*:grow lg:grid lg:shrink-0 lg:grid-cols-2"
            data-print="hide"
          >
            <button
              type="button"
              className={buttonClass('primary', 'md')}
              onClick={() => download('docx')}
              disabled={!!busy}
            >
              <DownloadIcon />
              {busy === 'docx' ? 'Preparing…' : 'Comments (.docx)'}
            </button>
            <button
              type="button"
              className={buttonClass('secondary', 'md')}
              onClick={() => download('pdf')}
              disabled={!!busy}
            >
              <DownloadIcon />
              {busy === 'pdf' ? 'Preparing…' : 'Comments (.pdf)'}
            </button>
            <button
              type="button"
              className={buttonClass('secondary', 'md')}
              onClick={() => window.print()}
            >
              <PrintIcon />
              Print
            </button>
            <button type="button" className={buttonClass('ghost', 'md')} onClick={onRestart}>
              <RestartIcon />
              Check another file
            </button>
          </div>
        </div>
        <div
          className="mt-6 flex h-2.5 overflow-hidden rounded-pill bg-line"
          role="img"
          aria-label={bar.map((b) => `${b.n} ${b.label}`).join(', ')}
        >
          {bar.map(
            (b) =>
              b.n > 0 && (
                <div
                  key={b.label}
                  className={b.cls}
                  style={{ width: `${(b.n / Math.max(1, applicable)) * 100}%` }}
                />
              ),
          )}
        </div>
        {failed && (
          <p role="alert" className="mt-4 text-sm font-medium text-fix">
            The comments file could not be made. Try again, or use Print to save them as PDF.
          </p>
        )}
        <div className="mt-6 grid gap-3 text-sm leading-relaxed md:grid-cols-2">
          <p className="flex gap-2.5 rounded-[12px] bg-review-soft p-3.5 text-ink [&_svg]:size-5">
            <InfoIcon className="mt-px shrink-0 text-review" />
            <span>{VERIFY}</span>
          </p>
          <p className="flex gap-2.5 rounded-[12px] bg-ok-soft p-3.5 text-ink [&_svg]:size-5">
            <ShieldIcon className="mt-px shrink-0 text-ok" />
            <span>{PRIVATE_SHORT}</span>
          </p>
        </div>
        {report.notes.map((n) => (
          <p
            key={n}
            className="mt-3 flex gap-2.5 rounded-[12px] border border-line p-3.5 text-sm leading-relaxed text-ink-2 [&_svg]:size-5"
          >
            <InfoIcon className="mt-px shrink-0 text-ink-3" />
            <span>{n}</span>
          </p>
        ))}
      </section>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12">
        <aside aria-labelledby="parts-title" className="lg:order-2 lg:col-span-4" data-print="hide">
          <div className="lg:sticky lg:top-24 lg:-m-1 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:p-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="parts-title" className="font-display text-2xl text-ink">
                All parts
              </h2>
              <div
                role="group"
                aria-label="Show"
                className="inline-flex rounded-pill border border-line bg-surface p-0.5"
              >
                {[
                  { v: false, label: 'One by one' },
                  { v: true, label: 'All' },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    aria-pressed={all === o.v}
                    onClick={() => setAll(o.v)}
                    className="h-9 cursor-pointer rounded-pill px-3 text-xs font-semibold whitespace-nowrap text-ink-2 transition-colors aria-pressed:bg-maroon aria-pressed:text-paper"
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <ol className="mt-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
              {parts.map((p, k) => (
                <li key={p.name}>
                  <button
                    type="button"
                    onClick={() => go(k)}
                    aria-current={!all && k === current ? 'true' : undefined}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors hover:bg-surface-2 aria-[current=true]:bg-surface aria-[current=true]:shadow-(--shadow-elev-1) aria-[current=true]:ring-1 aria-[current=true]:ring-ink-3"
                  >
                    <span
                      className={`w-5 font-display text-lg leading-none tabular-nums ${p.fix ? 'text-fix' : p.review ? 'text-review' : 'text-ok'}`}
                    >
                      {p.extra ? '+' : k + 1}
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-medium text-ink">{p.name}</span>
                    <PartState part={p} compact />
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </aside>

        <div className="lg:order-1 lg:col-span-8">
          {parts.map((p, k) => {
            const shown = all || k === current
            return (
              <section
                key={p.name}
                id={`part-${k}`}
                aria-labelledby={`part-${k}-title`}
                className={`${shown ? '' : 'hidden print:block'} scroll-mt-28 rounded-card border border-line bg-surface px-5 shadow-(--shadow-elev-1) sm:px-8 ${all ? 'mb-6' : ''}`}
              >
                <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pt-6 pb-4">
                  <h2
                    id={`part-${k}-title`}
                    ref={k === current ? partHeading : undefined}
                    tabIndex={-1}
                    className="flex items-baseline gap-3 font-display text-3xl text-ink outline-none"
                  >
                    <span className="text-maroon tabular-nums">{p.extra ? '+' : k + 1}</span>
                    {p.name}
                  </h2>
                  <PartState part={p} />
                </header>
                <ul className="divide-y divide-line">
                  {p.rows.map((r) => (
                    <ItemRow key={r.item.id} item={r.item} finding={r.finding} />
                  ))}
                </ul>
                {!all && (
                  <nav
                    aria-label="Parts"
                    className="flex flex-wrap justify-between gap-2 border-t border-line py-4"
                    data-print="hide"
                  >
                    {k > 0 && (
                      <button
                        type="button"
                        onClick={() => go(k - 1)}
                        className={buttonClass('ghost', 'sm', 'max-w-full')}
                      >
                        <ChevronLeftIcon />
                        <span className="truncate">{parts[k - 1].name}</span>
                      </button>
                    )}
                    {k < parts.length - 1 && (
                      <button
                        type="button"
                        onClick={() => go(k + 1)}
                        className={buttonClass('secondary', 'sm', 'ml-auto max-w-full')}
                      >
                        <span className="truncate">Next: {parts[k + 1].name}</span>
                        <ChevronRightIcon />
                      </button>
                    )}
                  </nav>
                )}
              </section>
            )
          })}
          <p className="mt-6 text-sm leading-relaxed text-ink-3" data-print="hide">
            Corrected something? Save your file and check it again: nothing from this check is kept,
            so each check starts fresh.
          </p>
        </div>
      </div>
    </div>
  )
}
