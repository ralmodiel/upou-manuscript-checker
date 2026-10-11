// Stage 3: the whole checklist with the file's status on every item. A summary and the downloads
// lead; then a card for every manuscript part, and the items under tabs by status. Choosing a part
// or a tab changes only the list: nothing scrolls, and focus stays where it was.
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { CHECKLIST, type Item } from '../engine/checklist'
import type { Finding, Report, Status, Where } from '../engine/report'
import { saveFile } from '../lib/browser'
import { PRIVATE_SHORT, VERIFY } from '../notice'
import {
  PAGES_NOTE,
  detailText,
  hasPrinted,
  placesOf,
  printedOf,
  reportModel,
  reportName,
  samePage,
} from '../report/model'
import {
  CheckIcon,
  DownloadIcon,
  ExternalLinkIcon,
  InfoIcon,
  PrintIcon,
  RestartIcon,
  ShieldIcon,
} from './icons'
import { STATUS, buttonClass } from './styles'
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

function PartState({ part }: { part: PartView }) {
  if (part.fix || part.review)
    return (
      <span className="flex flex-wrap gap-x-2.5 text-sm font-semibold tabular-nums">
        {part.fix > 0 && <span className="text-fix">{part.fix} to correct</span>}
        {part.review > 0 && <span className="text-review">{part.review} to review</span>}
      </span>
    )
  if (!part.ok) return <span className="text-sm text-ink-3">Not applicable</span>
  return (
    <span className="inline-flex items-center gap-1 text-sm font-semibold text-ok [&_svg]:size-4">
      <CheckIcon strokeWidth={2.5} />
      All passed
    </span>
  )
}

/** Which items the list shows: all, or one status. */
type Filter = 'all' | 'ok' | 'review' | 'fix'
const TABS: { id: Filter; label: string; tone?: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'ok', label: STATUS.ok.label, tone: 'text-ok' },
  { id: 'review', label: STATUS.review.label, tone: 'text-review' },
  { id: 'fix', label: STATUS.fix.label, tone: 'text-fix' },
]
const shows = (filter: Filter, s: Status) => filter === 'all' || filter === s

// One mark per item on a part's card, in its status colour (the card says the counts in words).
const DOT: Record<Status, string> = {
  fix: 'bg-fix',
  review: 'bg-review',
  ok: 'bg-ok',
  na: 'bg-ink-3/40',
}

function ItemRow({
  item,
  finding,
  labels,
  hidden,
}: {
  item: Item
  finding: Finding
  labels: Report['pageLabels']
  hidden: boolean
}) {
  const where = placesOf(finding)
  const open = finding.status === 'fix' || finding.status === 'review'
  return (
    <li
      className={`${hidden ? 'hidden print:grid' : 'grid'} grid-cols-1 gap-x-5 gap-y-2 py-5 sm:grid-cols-[9rem_minmax(0,1fr)]`}
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
                <span className="min-w-0 break-words">{detailText(d, labels)}</span>
              </li>
            ))}
          </ul>
        )}
        {open && where.length > 0 && (
          <p className="mt-3 flex flex-wrap gap-1.5">
            <span className="sr-only">Where to look: </span>
            {/* Places on one page share a chip: the page once, then each quote. */}
            {where
              .reduce<Where[][]>((chips, w, k) => {
                if (samePage(where, k)) chips[chips.length - 1].push(w)
                else chips.push([w])
                return chips
              }, [])
              .map(([w, ...more], k) => (
                <span
                  key={k}
                  className="inline-flex max-w-full items-start gap-x-1.5 rounded-[8px] border border-line bg-surface-2 px-2 py-1 text-xs text-ink-2"
                >
                  {w.page !== undefined && (
                    <span className="shrink-0 font-semibold whitespace-nowrap text-ink tabular-nums">
                      p. {w.page + 1}
                      {printedOf(w.page, labels) && (
                        <span className="font-normal text-ink-3">
                          {' '}
                          · printed {printedOf(w.page, labels)}
                        </span>
                      )}
                    </span>
                  )}
                  {/* The quotes in a column beside the page, lined up when there are several. */}
                  {[w, ...more].some((q) => q.quote) && (
                    <span className="flex min-w-0 flex-col gap-y-0.5">
                      {[w, ...more].map(
                        (q, j) =>
                          q.quote && (
                            <span key={j} className="line-clamp-2 wrap-anywhere">
                              “{q.quote}”
                            </span>
                          ),
                      )}
                    </span>
                  )}
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

  // The list shows one part (a card chosen) or all, and all items or one status (a tab).
  const [part, setPart] = useState<number | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<'docx' | 'pdf' | null>(null)
  const [failed, setFailed] = useState(false)
  const list = useRef<HTMLElement>(null)
  const tabBar = useRef<HTMLDivElement>(null)
  const keepTabs = useRef(false)

  const inScope = parts.flatMap((p, k) => (part === null || part === k ? p.rows : []))
  const counts = Object.fromEntries(
    TABS.map((t) => [t.id, inScope.filter((r) => shows(t.id, r.finding.status)).length]),
  ) as Record<Filter, number>

  /** Shows another part or status. Nothing scrolls, unless the tabs are stuck under the header
   *  (the list read part-way): then they stay put and the new list starts right under them,
   *  rather than the page jumping as the list changes length. */
  const choose = (nextPart: number | null, nextFilter: Filter) => {
    const top = list.current?.getBoundingClientRect().top ?? 0
    keepTabs.current = !!tabBar.current && top < parseFloat(getComputedStyle(tabBar.current).top)
    setPart(nextPart)
    setFilter(nextFilter)
  }
  useLayoutEffect(() => {
    if (!keepTabs.current || !list.current || !tabBar.current) return
    keepTabs.current = false
    const stuck = parseFloat(getComputedStyle(tabBar.current).top)
    window.scrollTo({
      top: window.scrollY + list.current.getBoundingClientRect().top - stuck,
      behavior: 'instant',
    })
  }, [part, filter])

  // Arrow keys, Home and End move between the tabs (and show each), as tabs do.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = TABS.findIndex((t) => t.id === filter)
    const to =
      e.key === 'ArrowRight'
        ? (k + 1) % TABS.length
        : e.key === 'ArrowLeft'
          ? (k + TABS.length - 1) % TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? TABS.length - 1
              : -1
    if (to < 0) return
    e.preventDefault()
    choose(part, TABS[to].id)
    document.getElementById(`tab-${TABS[to].id}`)?.focus({ preventScroll: true })
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
              {extraFix > 0 && <> · {extraFix} more to correct outside the checklist</>}
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
        {[
          ...(fix + review + extraFix > 0 && hasPrinted(report) ? [PAGES_NOTE] : []),
          ...report.notes,
        ].map((n) => (
          <p
            key={n}
            className="mt-3 flex gap-2.5 rounded-[12px] border border-line p-3.5 text-sm leading-relaxed text-ink-2 [&_svg]:size-5"
          >
            <InfoIcon className="mt-px shrink-0 text-ink-3" />
            <span>{n}</span>
          </p>
        ))}
      </section>

      <section aria-labelledby="parts-title" className="mt-10" data-print="hide">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="parts-title" className="font-display text-3xl text-ink">
            All parts
          </h2>
          <p className="text-sm text-ink-3">Choose a part to list only its items.</p>
        </div>
        <ol className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          {parts.map((p, k) => (
            <li key={p.name}>
              <button
                type="button"
                aria-pressed={part === k}
                onClick={() => choose(part === k ? null : k, filter)}
                className="flex h-full w-full cursor-pointer flex-col gap-3 rounded-[14px] border border-line bg-surface p-3.5 text-left shadow-(--shadow-elev-1) transition-[border-color,box-shadow] duration-200 ease-out-soft hover:border-ink-3/50 hover:shadow-(--shadow-elev-2) aria-pressed:border-maroon aria-pressed:shadow-(--shadow-elev-2) aria-pressed:ring-1 aria-pressed:ring-maroon"
              >
                <span className="flex items-baseline gap-2">
                  <span
                    className={`font-display text-xl leading-none tabular-nums ${p.fix ? 'text-fix' : p.review ? 'text-review' : 'text-ok'}`}
                  >
                    {p.extra ? '+' : k + 1}
                  </span>
                  <span className="text-sm leading-snug font-semibold text-ink">{p.name}</span>
                </span>
                <span className="mt-auto grid gap-2">
                  <PartState part={p} />
                  <span aria-hidden="true" className="flex flex-wrap gap-1">
                    {p.rows.map((r) => (
                      <span
                        key={r.item.id}
                        className={`size-2 rounded-full ${DOT[r.finding.status]}`}
                      />
                    ))}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section ref={list} aria-label="Checklist items" className="mt-10">
        <div
          ref={tabBar}
          className="sticky top-[calc(4rem+1px)] z-30 border-b border-line bg-paper"
          data-print="hide"
        >
          <div
            role="tablist"
            aria-label="Show items"
            onKeyDown={onTabKey}
            className="grid grid-cols-4"
          >
            {TABS.map((t) => {
              const Icon = t.id === 'all' ? null : STATUS[t.id].icon
              return (
                <button
                  key={t.id}
                  id={`tab-${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={filter === t.id}
                  aria-controls="items"
                  tabIndex={filter === t.id ? 0 : -1}
                  onClick={() => choose(part, t.id)}
                  className="-mb-px flex min-h-12 cursor-pointer flex-col items-center justify-center gap-0.5 border-b-2 border-transparent px-1 py-2 text-xs font-semibold text-ink-2 transition-[color] hover:text-ink aria-selected:border-maroon aria-selected:text-ink sm:flex-row sm:gap-2 sm:text-sm [&_svg]:size-4"
                >
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    {Icon && <Icon strokeWidth={2.5} className={`max-sm:hidden ${t.tone}`} />}
                    {t.label}
                  </span>
                  <span className="rounded-pill bg-surface-2 px-1.5 text-[0.6875rem] leading-5 text-ink-2 tabular-nums">
                    {counts[t.id]}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div id="items" role="tabpanel" aria-labelledby={`tab-${filter}`}>
          <div
            className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3"
            data-print="hide"
          >
            <p aria-live="polite" className="text-sm text-ink-2 tabular-nums">
              {counts[filter]} {counts[filter] === 1 ? 'item' : 'items'}
              {part !== null ? ` in ${parts[part].name}` : ', all parts'}
            </p>
            {part !== null && (
              <button
                type="button"
                onClick={() => choose(null, filter)}
                className={buttonClass('ghost', 'sm')}
              >
                Show all parts
              </button>
            )}
          </div>
          {parts.map((p, k) => {
            const rows = p.rows.filter((r) => shows(filter, r.finding.status))
            const shown = (part === null || part === k) && rows.length > 0
            return (
              <section
                key={p.name}
                aria-labelledby={`part-${k}-title`}
                className={`${shown ? '' : 'hidden print:block'} mb-6 overflow-hidden rounded-card border border-line bg-surface px-5 shadow-(--shadow-elev-1) sm:px-8`}
              >
                <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pt-6 pb-4">
                  <h2
                    id={`part-${k}-title`}
                    className="flex items-baseline gap-3 font-display text-3xl text-ink"
                  >
                    <span className="text-maroon tabular-nums">{p.extra ? '+' : k + 1}</span>
                    {p.name}
                  </h2>
                  <PartState part={p} />
                </header>
                {/* -mb-px tucks under the card's edge the divider a shown item keeps when the
                    items after it are filtered out. */}
                <ul className="-mb-px divide-y divide-line">
                  {p.rows.map((r) => (
                    <ItemRow
                      key={r.item.id}
                      item={r.item}
                      finding={r.finding}
                      labels={report.pageLabels}
                      hidden={!shows(filter, r.finding.status)}
                    />
                  ))}
                </ul>
              </section>
            )
          })}
          {counts[filter] === 0 && (
            <div className="rounded-card border border-dashed border-line px-5 py-10 text-center sm:px-8">
              <p className="text-ink-2">
                No item {part !== null ? `in ${parts[part].name} ` : ''}is{' '}
                {TABS.find((t) => t.id === filter)!.label.toLowerCase()}.
              </p>
              <button
                type="button"
                onClick={() => choose(part, 'all')}
                className={buttonClass('secondary', 'sm', 'mt-4')}
              >
                Show all items
              </button>
            </div>
          )}
        </div>
        <p className="mt-6 text-sm leading-relaxed text-ink-3" data-print="hide">
          Corrected something? Save your file and check it again: nothing from this check is kept,
          so each check starts fresh.
        </p>
      </section>
    </div>
  )
}
