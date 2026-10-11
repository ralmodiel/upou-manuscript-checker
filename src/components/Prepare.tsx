// Stage 1: what this is, the privacy promise, the drop zone; then the program's files and the whole
// checklist in its own words, so a visitor knows what will be looked at before choosing a file.
import { useRef } from 'react'
import { CHECKLIST } from '../engine/checklist'
import { PRIVATE_BODY, PRIVATE_HEAD, PRIVATE_SHORT } from '../notice'
import { DownloadIcon, ExternalLinkIcon, ListIcon, PageIcon, ShieldIcon } from './icons'
import { buttonClass } from './styles'

const ACCEPT = [
  '.docx',
  '.docm',
  '.dotx',
  '.doc',
  '.pdf',
  '.odt',
  '.ott',
  '.rtf',
  'application/pdf',
  'application/msword',
  'application/rtf',
  'text/rtf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
].join(',')

const FILES = [
  {
    name: 'MDC thesis manuscript template',
    kind: 'Word document',
    size: '344 KB',
    href: 'downloads/mdc-thesis-manuscript-template.docx',
    save: 'MDC Thesis Manuscript_SURNAME, Given Name.docx',
    icon: PageIcon,
  },
  {
    name: 'MDC Format Checklist',
    kind: 'Excel workbook',
    size: '7 KB',
    href: 'downloads/mdc-format-checklist.xlsx',
    save: 'Format Checklist.xlsx',
    icon: ListIcon,
  },
]

function DropZone({ onFile, dragging }: { onFile: (f: File) => void; dragging: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div
      className={`relative flex flex-col items-center rounded-card border-2 border-dashed px-6 py-10 text-center shadow-(--shadow-elev-2) transition-[border-color,background-color] duration-200 sm:px-10 sm:py-14 ${
        dragging ? 'border-maroon bg-maroon-soft' : 'border-line bg-surface'
      }`}
    >
      <span className="grid size-16 place-items-center rounded-pill bg-surface-2 text-maroon [&_svg]:size-8">
        <PageIcon strokeWidth={1.6} />
      </span>
      <h2 className="mt-5 font-display text-3xl leading-tight text-ink sm:text-4xl">
        {dragging ? (
          'Let go to check it'
        ) : (
          <>
            <span className="pointer-coarse:hidden">Drop your manuscript here</span>
            <span className="hidden pointer-coarse:inline">Choose your manuscript</span>
          </>
        )}
      </h2>
      <p className="mt-2 text-sm text-ink-3 pointer-coarse:hidden">or</p>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={buttonClass('primary', 'lg', 'mt-3')}
      >
        Choose a file
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (file) onFile(file)
        }}
      />
      <p className="mt-6 text-sm text-ink-2">
        Word <span className="text-ink-3">(.docx, .doc)</span> · PDF · OpenDocument{' '}
        <span className="text-ink-3">(.odt)</span> · Rich Text{' '}
        <span className="text-ink-3">(.rtf)</span>
      </p>
      <p className="mt-1.5 max-w-sm text-[0.8125rem] text-balance text-ink-3">
        Writing in Google Docs? Choose File › Download › Microsoft Word (.docx) or PDF, then check
        that file.
      </p>
      <p className="mt-5 max-w-sm text-[0.8125rem] font-medium text-balance text-ok">
        <ShieldIcon className="mr-1 inline size-4 align-[-0.2em]" />
        {PRIVATE_SHORT}
      </p>
    </div>
  )
}

export default function Prepare({
  onFile,
  dragging,
}: {
  onFile: (f: File) => void
  dragging: boolean
}) {
  const base = import.meta.env.BASE_URL
  return (
    <>
      {/* Phones and tablets read heading, drop zone, then the privacy note; wide screens put the
          drop zone beside the text. */}
      <section className="grid gap-x-14 gap-y-8 py-8 sm:py-10 lg:grid-cols-2 lg:grid-rows-[auto_1fr] lg:py-16">
        <div>
          <h1 tabIndex={-1} className="font-display text-title text-ink outline-none">
            Check your thesis manuscript before you send it
          </h1>
          <p className="mt-5 max-w-[36rem] leading-relaxed text-ink-2 sm:mt-6 sm:text-lg">
            Compare your Master of Development Communication manuscript with every item of the MDC
            Format Checklist. You get what to correct, with the pages to look at, and the comments
            as a Word or PDF file.
          </p>
        </div>
        <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
          <DropZone onFile={onFile} dragging={dragging} />
        </div>
        <div>
          <div className="flex max-w-[36rem] gap-4 rounded-card border border-ok/25 bg-ok-soft p-5 text-ok">
            <ShieldIcon className="mt-0.5 size-6 shrink-0" />
            <div>
              <p className="font-semibold">{PRIVATE_HEAD}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">{PRIVATE_BODY}</p>
            </div>
          </div>
          <p className="mt-6 max-w-[36rem] text-sm leading-relaxed text-ink-3">
            For the fullest check, check both files: your Word file shows styles and spacing
            exactly, and the PDF you will send shows the pages exactly as printed.
          </p>
        </div>
      </section>

      <section id="files" aria-labelledby="files-title" className="border-t border-line py-12">
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <h2 id="files-title" className="font-display text-3xl text-ink">
              Start from the program’s files
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-2">
              The template the program shares and the checklist this site checks against, offered
              here for convenience. Ask MDC Program Support if you are unsure you have the latest
              version.
            </p>
          </div>
          <ul className="grid gap-3 lg:col-span-8">
            {FILES.map((f) => (
              <li key={f.href}>
                <a
                  href={base + f.href}
                  download={f.save}
                  className="group flex items-center gap-4 rounded-card border border-line bg-surface p-4 shadow-(--shadow-elev-1) transition-[box-shadow,border-color] hover:border-ink-3/40 hover:shadow-(--shadow-elev-2) sm:p-5"
                >
                  <span className="grid size-12 shrink-0 place-items-center rounded-[12px] bg-maroon-soft text-maroon [&_svg]:size-6">
                    <f.icon />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">{f.name}</span>
                    <span className="block text-sm text-ink-3">
                      {f.kind} · {f.size}
                    </span>
                  </span>
                  <span
                    className={buttonClass('secondary', 'sm', 'pointer-events-none max-sm:hidden')}
                  >
                    <DownloadIcon />
                    Download
                  </span>
                  <DownloadIcon className="size-5 shrink-0 text-ink-2 sm:hidden" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        id="checklist"
        aria-labelledby="checklist-title"
        className="border-t border-line py-12"
      >
        <div className="max-w-2xl">
          <h2 id="checklist-title" className="font-display text-3xl text-ink">
            What gets checked
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-2">
            All {CHECKLIST.filter((p) => !p.extra).reduce((n, p) => n + p.items.length, 0)} items of
            the MDC Format Checklist, in its own words, and a few things reviewers often point out.
            After a check, each one shows whether your file passed it.
          </p>
        </div>
        <ol className="mt-8 gap-x-10 sm:columns-2 lg:columns-3">
          {CHECKLIST.map((part, k) => (
            <li key={part.id} className="mb-8 break-inside-avoid">
              <h3 className="flex items-baseline gap-2 font-semibold text-ink">
                <span className="font-display text-xl text-maroon tabular-nums">
                  {part.extra ? '+' : k + 1}
                </span>
                {part.name}
              </h3>
              <ul className="mt-2 space-y-1.5 border-l border-line pl-4 text-sm leading-snug text-ink-2">
                {part.items.map((item) => (
                  <li key={item.id}>
                    {item.text}
                    {item.links?.map((l) => (
                      <a
                        key={l.href}
                        href={l.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1.5 inline-flex items-center gap-0.5 text-maroon underline decoration-1 underline-offset-2 hover:decoration-2 [&_svg]:size-3"
                      >
                        {l.label}
                        <ExternalLinkIcon />
                      </a>
                    ))}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}
