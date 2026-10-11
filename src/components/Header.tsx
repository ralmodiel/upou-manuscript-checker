// The sticky header (wordmark, the unofficial/alpha badge, the theme switch) and, under it, the
// notice strip every view carries. Text wordmark only: the site uses no UP or UPOU artwork.
import { useTheme } from '../lib/theme'
import { BADGE, SHORT } from '../notice'
import { InfoIcon, MoonIcon, SunIcon } from './icons'

const NAV =
  'rounded-pill px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink'

export default function Header({ onHome }: { onHome: () => void }) {
  const { theme, toggle } = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <>
      <header
        data-print="hide"
        className="sticky top-0 z-40 border-b border-glass-border bg-glass backdrop-blur-lg backdrop-saturate-150 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-1 before:brand-stripe"
      >
        <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-2 px-(--gutter) pt-1">
          <a
            href="#top"
            onClick={onHome}
            aria-label="MDC Format Check, start over"
            className="flex min-h-10 items-baseline gap-1.5 rounded-sm font-display text-[1.6rem] leading-none tracking-tight"
          >
            <span className="text-ink">MDC</span>
            <span className="text-maroon">Format Check</span>
          </a>
          <span className="ml-1 hidden rounded-pill border border-line bg-surface px-2 py-1 text-[0.6875rem] leading-none font-semibold tracking-[0.06em] text-ink-2 uppercase sm:inline">
            {BADGE}
          </span>
          <nav aria-label="Page" className="ml-auto hidden items-center gap-0.5 md:flex">
            <a href="#checklist" className={NAV}>
              The checklist
            </a>
            <a href="#files" className={NAV}>
              Template
            </a>
            <a href="#faq" className={NAV}>
              Questions
            </a>
          </nav>
          <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${next} theme`}
            title={`Switch to ${next} theme`}
            className="ml-auto inline-grid size-10 cursor-pointer place-items-center rounded-pill text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink md:ml-1 [&_svg]:size-5"
          >
            {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
          </button>
        </div>
      </header>
      <aside
        aria-label="About this site"
        className="border-b border-line bg-maroon-soft text-maroon print:border-black print:bg-white print:text-black"
      >
        <p className="mx-auto flex max-w-6xl items-start gap-2 px-(--gutter) py-2.5 text-[0.8125rem] leading-snug font-medium sm:items-center">
          <InfoIcon className="mt-px size-4 shrink-0 sm:mt-0" />
          <span>
            {SHORT}{' '}
            <a
              href="#about"
              className="underline decoration-1 underline-offset-3 hover:decoration-2"
              data-print="hide"
            >
              Read more
            </a>
          </span>
        </p>
      </aside>
    </>
  )
}
