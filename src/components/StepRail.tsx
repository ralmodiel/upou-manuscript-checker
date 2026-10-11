// The UP tri-colour stripe as the step rail: Prepare fills maroon, Check gold, Correct forest. While
// a file is being read, the gold segment sweeps; that is the page's one authored motion.

export type Stage = 'prepare' | 'check' | 'correct'

const STEPS: { id: Stage; name: string; hint: string; fill: string }[] = [
  {
    id: 'prepare',
    name: 'Prepare',
    hint: 'Choose your manuscript',
    fill: 'bg-band-maroon dark:bg-fix',
  },
  { id: 'check', name: 'Check', hint: 'Read on this device', fill: 'bg-band-gold' },
  {
    id: 'correct',
    name: 'Correct',
    hint: 'Correct what is listed',
    fill: 'bg-band-forest dark:bg-ok',
  },
]

export default function StepRail({ stage, busy }: { stage: Stage; busy: boolean }) {
  const at = STEPS.findIndex((s) => s.id === stage)
  return (
    <nav aria-label="Progress" data-print="hide">
      <ol className="grid grid-cols-3 gap-2 sm:gap-3">
        {STEPS.map((s, k) => {
          const reached = k <= at
          const sweeping = busy && s.id === 'check'
          return (
            <li key={s.id} aria-current={k === at ? 'step' : undefined} className="min-w-0">
              <div className="relative h-2 overflow-hidden rounded-pill bg-line">
                <div
                  className={`absolute inset-0 origin-left rounded-pill transition-transform duration-500 ease-out-soft ${s.fill} ${reached && !sweeping ? 'scale-x-100' : 'scale-x-0'}`}
                />
                {sweeping && (
                  <div className="absolute inset-y-0 left-0 w-2/5 rounded-pill bg-band-gold motion-safe:animate-sweep motion-reduce:w-full motion-reduce:opacity-40" />
                )}
              </div>
              <p className="mt-2.5 flex items-baseline gap-2">
                <span
                  className={`font-display text-2xl leading-none tabular-nums ${k === at ? 'text-ink' : reached ? 'text-ink-2' : 'text-ink-3'}`}
                >
                  {k + 1}
                </span>
                <span className={`text-sm font-semibold ${k === at ? 'text-ink' : 'text-ink-3'}`}>
                  {s.name}
                </span>
              </p>
              <p className="mt-0.5 hidden text-xs text-ink-3 sm:block">{s.hint}</p>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
