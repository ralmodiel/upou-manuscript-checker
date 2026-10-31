// Questions a first-time visitor asks, about either tool: is it official, where does my file or my
// plan go, which file to check, what the statuses mean, whether it can be wrong, what the Topic
// planner does and what its AI helper is. The first answer is the full notice; after it come the
// questions about the tool on screen.
import { NOTICE, PRIVATE_BODY, PRIVATE_HEAD } from '../notice'
import { ChevronDownIcon } from './icons'
import { StatusPill } from './ui'

const QA: { id?: string; q: string; a: React.ReactNode; open?: boolean; topic?: true }[] = [
  {
    id: 'about',
    q: 'Is this an official UPOU site?',
    open: true,
    a: <p>{NOTICE}</p>,
  },
  {
    q: 'Is my manuscript or my plan sent anywhere?',
    a: (
      <>
        <p>
          <strong className="font-semibold text-ink">No. {PRIVATE_HEAD}</strong> {PRIVATE_BODY}
        </p>
        <p>
          The Topic planner works the same way. Your question, criteria, search log and screening
          numbers are kept in this browser’s own storage on your device, so they are there when you
          come back, and nowhere else; “Start over” clears them. The plan’s Word file is written on
          your device as well.
        </p>
        <p>
          This site is a set of static pages with no server of its own to receive files. Its code
          never sends your file anywhere, and its security policy lets the page's scripts reach only
          this site itself and Hugging Face, the host of the Topic planner's optional model, which
          is fetched only when you turn that helper on. The comments you download are made on your
          device too.
        </p>
        <p>
          Like any website, its host (GitHub Pages) receives the ordinary requests for the pages
          themselves, such as your IP address; your manuscript and your plan are never part of them.
          Two things leave your browser only when you choose them: an “Open search” link carries
          your search string to that database, and turning the AI helper on fetches the model from
          Hugging Face, which then sees your IP address, as any download does.
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
    q: 'What do the format check results mean?',
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
    q: 'Can the checker or the planner be wrong?',
    a: (
      <>
        <p>
          Yes. Both are in beta testing and were built diligently and meticulously with the help of
          AI, but a program is not a person. The checker reads files the way a program does: it can
          miss a problem or flag one that is not there, especially with unusual layouts, text boxes,
          or scanned pages.
        </p>
        <p>
          No AI reads your file: the checks are rules written into this site, and they run the same
          way every time. Treat every result as a guide and confirm it in your manuscript. Your
          program’s format review remains the official check, and its comments come first.
        </p>
        <p>
          The Topic planner’s flow and verdict are arithmetic on the numbers you bring back, so they
          are only as right as your counts, and whether a topic is workable also depends on your
          time, your access to the databases and your adviser’s view. The suggestions of its
          optional AI helper are guesses from a small model and can be wrong; nothing enters your
          plan until you choose it.
        </p>
      </>
    ),
  },
  {
    q: 'Does it work for my program?',
    a: (
      <>
        <p>
          The Format check is meant for every UPOU program and level: a bachelor’s special or
          capstone project, a master’s capstone project, special problem or thesis, and a doctoral
          dissertation. It follows the MDC program’s copy of UPOU’s central format checklist. Where
          UPOU’s style guide (issued in May 2022) differs from that checklist, as with upper case or
          title case for the title, other programs get “To review” instead of “Needs update”. Ask
          your program office whether it adds rules of its own.
        </p>
        <p>
          The Topic planner suits any program in which a systematic or scoping review is an accepted
          form of special problem, thesis or dissertation; PRISMA 2020 is written for reviews in any
          field. Ask your adviser whether it is accepted in yours.
        </p>
      </>
    ),
  },
  {
    id: 'faq-topic',
    topic: true,
    q: 'What does the Topic planner do?',
    a: (
      <>
        <p>
          It helps you choose and size a topic for a systematic or scoping review before you commit
          to it. You write your question from its parts (a PICO, PICo, PEO or PCC frame), set the
          criteria, build the search string, log what each source found, and enter the screening
          numbers. The planner draws the PRISMA 2020 flow from those numbers and says whether the
          topic looks too narrow, workable, or too large for one person.
        </p>
        <p>
          The PRISMA 2020 checklists it shows are the published ones (Page et al., 2021, CC BY 4.0).
          Nothing is searched for you: the “Open search” links take your search string to each
          database (the UPOU Repository and IJODeL first, then Google Scholar, ERIC, PubMed and
          others), and you bring the counts back. It also points you to where published reviews are
          listed, so you see whether your question has been answered already.
        </p>
        <p>
          Weighing more than one idea? Keep up to three candidate topics side by side and compare
          their size. The plans stay in this browser only; you can save a copy as a file to open on
          another device, and download any plan as a Word file to discuss with your adviser.
        </p>
        <p>
          It follows the PRISMA 2020 statement, as PRISMA asks of those who endorse it: when you
          report a systematic review or meta-analysis, complete the PRISMA checklist and include a
          PRISMA flow diagram. The templates, and the PRISMA extensions for other kinds of review (a
          scoping review reports with PRISMA-ScR), are on{' '}
          <a
            href="https://www.prisma-statement.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:decoration-2"
          >
            prisma-statement.org
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: 'faq-ai',
    topic: true,
    q: 'What is the AI helper in the Topic planner?',
    a: (
      <>
        <p>
          An optional helper, off until you turn it on. It is a small language model,
          Qwen2.5-0.5B-Instruct (about 790 MB, fetched once from Hugging Face and kept in your
          browser), that runs on your own device’s graphics chip, so what you type never leaves your
          device. It reads your sentence into the parts of the question, offers other words for the
          search and suggests titles for the review; each suggestion is a chip you take or leave.
        </p>
        <p>
          It needs WebGPU, which a recent Chrome, Edge or Firefox, or Safari 26 or newer, provides
          on a computer with a capable graphics chip; where it is not available, the planner says so
          and works without it. Its suggestions can be wrong, and the planner is complete without
          them. Turn it off when you are done, and the memory it took is freed.
        </p>
      </>
    ),
  },
  {
    q: 'Who is it for?',
    a: (
      <p>
        It is made for UPOU students at every level: the Topic planner for those still choosing and
        sizing a review topic, the Format check for those preparing a special problem, thesis or
        dissertation for submission; and for reviewers preparing format comments, who use the same
        page. The downloadable comments follow the layout of the program’s comment emails: numbered
        parts with the corrections under each.
      </p>
    ),
  },
]

export default function Faq({ tab }: { tab: 'check' | 'topic' }) {
  // The notice first, then the questions about the tool on screen, then the other tool's.
  const rank = (x: (typeof QA)[number]) =>
    x.id === 'about' ? 0 : !!x.topic === (tab === 'topic') ? 1 : 2
  const list = [...QA].sort((a, b) => rank(a) - rank(b))
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
          {list.map((x) => (
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
