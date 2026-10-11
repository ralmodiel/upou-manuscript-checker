// The maroon band that closes every page (as in UPOU OER): the notice, the official files and
// references, and the project's own licences.
import { NOTICE, PRIVATE_SHORT } from '../notice'

const LINK =
  'text-on-band underline decoration-on-band/40 underline-offset-4 transition-[text-decoration-color] hover:decoration-band-gold'
const HEADING = 'text-xs font-semibold tracking-[0.08em] text-band-gold uppercase'

// Only a real https URL becomes a link.
const REPO_RAW = import.meta.env.VITE_REPO_URL as string | undefined
const REPO = /^https:\/\/\S+$/.test(REPO_RAW ?? '') ? REPO_RAW : undefined

export default function Footer() {
  const base = import.meta.env.BASE_URL
  return (
    <footer
      className="mt-16 bg-band-maroon bg-(image:--gradient-band) text-sm text-on-band band-focus"
      data-print="hide"
    >
      <div className="mx-auto grid max-w-6xl gap-10 px-(--gutter) py-12 md:grid-cols-3 md:gap-8">
        <section aria-labelledby="f-about">
          <h2 id="f-about" className={HEADING}>
            Unofficial proof of concept
          </h2>
          <p className="mt-3 leading-relaxed text-on-band/90">{NOTICE}</p>
        </section>
        <section aria-labelledby="f-files">
          <h2 id="f-files" className={HEADING}>
            Files and references
          </h2>
          <ul className="mt-3 space-y-2.5">
            <li>
              <a
                className={LINK}
                href={`${base}downloads/mdc-thesis-manuscript-template.docx`}
                download="MDC Thesis Manuscript_SURNAME, Given Name.docx"
              >
                MDC thesis manuscript template (.docx)
              </a>
            </li>
            <li>
              <a
                className={LINK}
                href={`${base}downloads/mdc-format-checklist.xlsx`}
                download="Format Checklist.xlsx"
              >
                MDC Format Checklist (.xlsx)
              </a>
            </li>
            <li>
              <a
                className={LINK}
                href="https://apastyle.apa.org/style-grammar-guidelines/tables-figures"
                target="_blank"
                rel="noopener noreferrer"
              >
                APA style: tables and figures
              </a>
            </li>
            <li>
              <a
                className={LINK}
                href="https://apastyle.apa.org/style-grammar-guidelines/paper-format/reference-list"
                target="_blank"
                rel="noopener noreferrer"
              >
                APA style: reference list
              </a>
            </li>
          </ul>
        </section>
        <section aria-labelledby="f-project">
          <h2 id="f-project" className={HEADING}>
            This project
          </h2>
          <ul className="mt-3 space-y-2.5">
            <li className="text-on-band/90">{PRIVATE_SHORT}</li>
            <li className="text-on-band/75">No accounts, cookies or analytics.</li>
            <li className="text-on-band/75">Code: MIT License</li>
            <li>
              <a className={LINK} href={`${base}THIRD_PARTY_LICENSES.txt`}>
                Third-party licenses
              </a>
            </li>
            {REPO && (
              <li>
                <a className={LINK} href={REPO} target="_blank" rel="noopener noreferrer">
                  View source
                </a>
              </li>
            )}
          </ul>
        </section>
      </div>
      <div className="border-t border-on-band/15 bg-black/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-(--gutter) py-5 text-xs text-on-band/80 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-display text-lg leading-none text-on-band">
            MDC <span className="text-band-gold">Format Check</span>
          </p>
          <p>Not affiliated with or endorsed by UP Open University · alpha testing</p>
        </div>
      </div>
    </footer>
  )
}
