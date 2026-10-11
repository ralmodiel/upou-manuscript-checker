// Questions a first-time visitor asks: is it official, where does my file go, which file to check,
// what the statuses mean, whether it can be wrong. The first answer is the full notice.
import { NOTICE, PRIVATE_BODY, PRIVATE_HEAD } from '../notice'
import { ChevronDownIcon } from './icons'
import { StatusPill } from './ui'

const QA: { id?: string; q: string; a: React.ReactNode; open?: boolean }[] = [
  {
    id: 'about',
    q: 'Is this an official UPOU site?',
    open: true,
    a: <p>{NOTICE}</p>,
  },
  {
    q: 'Is my manuscript sent anywhere?',
    a: (
      <>
        <p>
          <strong className="font-semibold text-ink">No. {PRIVATE_HEAD}</strong> {PRIVATE_BODY}
        </p>
        <p>
          This site is a set of static pages with no server of its own to receive files. Its code
          never sends your file anywhere, and its security policy blocks the page's scripts from
          making network requests. The comments you download are made on your device too.
        </p>
        <p>
          Like any website, its host (GitHub Pages) receives the ordinary requests for the pages
          themselves, such as your IP address; your manuscript is never part of them.
        </p>
      </>
    ),
  },
  {
    q: 'Which file should I check?',
    a: (
      <>
        <p>
          Both, if you can. A Word file (.docx) tells exactly which fonts, spacing and alignment you
          set; the PDF you will send shows the pages exactly as they print, so page numbers, blank
          pages and headings left at the foot of a page are checked there.
        </p>
        <p>
          Google Docs: choose File › Download › Microsoft Word (.docx) or PDF Document. Apple Pages:
          File › Export To › Word or PDF. An old Word 97-2003 file (.doc) is checked for its text
          and page numbering only; save it as .docx for the full check. A scanned PDF has no text to
          read.
        </p>
      </>
    ),
  },
  {
    q: 'What do the results mean?',
    a: (
      <dl className="grid gap-3 sm:grid-cols-[9rem_1fr] sm:items-baseline">
        <dt>
          <StatusPill status="fix" />
        </dt>
        <dd>
          Something the checklist asks for is missing or different; the result says what to change
          and where.
        </dd>
        <dt>
          <StatusPill status="review" />
        </dt>
        <dd>
          The file cannot settle it (such as how a name is spelled), or the checker is unsure. Look
          at it yourself.
        </dd>
        <dt>
          <StatusPill status="ok" />
        </dt>
        <dd>The file meets this item, as far as the checker can tell.</dd>
        <dt>
          <StatusPill status="na" />
        </dt>
        <dd>The item does not apply, such as figure rules for a manuscript without figures.</dd>
      </dl>
    ),
  },
  {
    q: 'Can the checker be wrong?',
    a: (
      <>
        <p>
          Yes. It is in alpha testing, and although it was built diligently and meticulously with
          the help of AI, it reads files the way a program does, not the way a person does. It can
          miss a problem or flag one that is not there, especially with unusual layouts, text boxes,
          or scanned pages.
        </p>
        <p>
          No AI reads your file: the checks are rules written into this site, and they run the same
          way every time. Treat every result as a guide and confirm it in your manuscript. MDC
          Program Support’s format review remains the official check, and its comments come first.
        </p>
      </>
    ),
  },
  {
    q: 'Who is it for?',
    a: (
      <p>
        It is made for MDC students preparing their manuscript and for reviewers preparing format
        comments; both use the same page. The downloadable comments follow the layout of the
        program’s comment emails: numbered parts with the corrections under each.
      </p>
    ),
  },
]

export default function Faq() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className="border-t border-line py-12"
      data-print="hide"
    >
      <div className="grid gap-8 lg:grid-cols-12">
        <h2 id="faq-title" className="font-display text-3xl text-ink lg:col-span-4">
          Questions
        </h2>
        <div className="divide-y divide-line border-y border-line lg:col-span-8">
          {QA.map((x) => (
            <details key={x.q} id={x.id} open={x.open} className="group scroll-mt-28">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left font-semibold text-ink [&::-webkit-details-marker]:hidden">
                {x.q}
                <ChevronDownIcon className="size-5 shrink-0 text-ink-3 transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <div className="space-y-3 pb-5 text-[0.9375rem] leading-relaxed text-ink-2">
                {x.a}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
