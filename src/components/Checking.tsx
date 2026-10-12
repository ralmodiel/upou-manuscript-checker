// Stage 2: the file being read and checked on this device, with page progress for a PDF.
import { PRIVATE_SHORT } from '../notice'
import { PageIcon, ShieldIcon } from './icons'

export interface Progress {
  step: 'reading' | 'checking'
  done?: number
  total?: number
}

export default function Checking({ name, progress }: { name: string; progress: Progress }) {
  const pct = progress.total ? Math.round(((progress.done ?? 0) / progress.total) * 100) : undefined
  const status =
    progress.step === 'checking'
      ? 'Checking every item of the format checklist…'
      : progress.total
        ? `Reading page ${progress.done} of ${progress.total}…`
        : 'Reading the file…'
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center py-16 text-center sm:py-24">
      <span className="grid size-16 place-items-center rounded-pill bg-surface-2 text-maroon [&_svg]:size-8">
        <PageIcon strokeWidth={1.6} />
      </span>
      <h1
        tabIndex={-1}
        className="mt-6 font-display text-4xl leading-tight text-ink outline-none sm:text-5xl"
      >
        Checking your manuscript
      </h1>
      <p className="mt-3 max-w-full font-medium wrap-anywhere text-ink-2">{name}</p>
      {/* Screen readers hear each step once; the page count updates visibly and in the progress bar. */}
      <p role="status" className="sr-only">
        {progress.step === 'checking' ? status : 'Reading the file…'}
      </p>
      <p aria-hidden="true" className="mt-6 text-sm text-ink-2 tabular-nums">
        {status}
      </p>
      <div
        className="mt-3 h-1.5 w-full max-w-sm overflow-hidden rounded-pill bg-line"
        role="progressbar"
        aria-label="Progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        {pct === undefined ? (
          <div className="h-full w-2/5 rounded-pill bg-band-gold motion-safe:animate-sweep motion-reduce:w-full motion-reduce:opacity-40" />
        ) : (
          <div
            className="h-full rounded-pill bg-band-gold transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <p className="mt-8 text-[0.8125rem] font-medium text-balance text-ok">
        <ShieldIcon className="mr-1 inline size-4 align-[-0.2em]" />
        {PRIVATE_SHORT}
      </p>
    </section>
  )
}
