// The topic plan as a Word file to bring to an adviser: the question, criteria, search and flow
// numbers, then the PRISMA 2020 checklists with where each item will be reported.
import { NOTICE } from '../notice.ts'
import { docxFile, para, run } from '../report/docx.ts'
import {
  ABSTRACT,
  ENDORSEMENT,
  itemNumber,
  MAIN,
  PRISMA_CITATION,
  PRISMA_HOME,
  type PrismaItem,
} from './prisma.ts'
import {
  criteria,
  dateWords,
  drafted,
  flow,
  KINDS,
  objective,
  question,
  searchString,
  SOURCES,
  verdict,
  workingTitle,
  type Plan,
} from './plan.ts'

const GREY = '5C5A5C'
const head = (text: string) =>
  para(run(text, { bold: true, size: 13, color: '7B1113' }), {
    before: 12,
    after: 4,
    keepNext: true,
  })
/** The text as runs with a break at each new line: Word shows a bare newline in a run as nothing. */
const runs = (text: string, o?: Parameters<typeof run>[1]) =>
  text
    .split(/\r?\n/)
    .map((t) => run(t, o))
    .join('<w:r><w:br/></w:r>')
const line = (text: string, o: { label?: string } = {}) =>
  para((o.label ? run(`${o.label}: `, { bold: true }) : '') + runs(text), { after: 3 })
const dash = (text: string) => para(run('- ') + runs(text), { indent: 14, hanging: 10, after: 2 })

/** A table with a shaded header row; widths in twentieths of a point. */
function table(widths: number[], rows: string[][]): string {
  const cell = (text: string, w: number, header: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="F4E9E4"/>' : ''}</w:tcPr>${para(runs(text, { bold: header, size: 9.5 }), { after: 2 })}</w:tc>`
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:color="BFB8B3"/>`
  return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b)}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows
    .map(
      (r, k) =>
        `<w:tr>${k === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${r.map((t, j) => cell(t, widths[j], k === 0)).join('')}</w:tr>`,
    )
    .join('')}</w:tbl>`
}

const sectioned = (items: PrismaItem[], last: (i: PrismaItem) => string) =>
  items.map((i, k) => [
    items[k - 1]?.topic === i.topic && items[k - 1]?.section === i.section
      ? ''
      : `${i.section.toUpperCase()}: ${i.topic}`,
    itemNumber(i.id),
    i.text,
    last(i),
  ])

export function planDocx(p: Plan, today = new Date()): Uint8Array {
  const f = flow(p)
  const v = verdict(f)
  const c = criteria(p)
  const body: string[] = []
  body.push(para(run('Topic plan', { bold: true, size: 20, color: '7B1113' }), { after: 2 }))
  body.push(
    para(
      run(
        `${KINDS[p.kind].framework} question · ${KINDS[p.kind].review} · made ${today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} with the UPOU Format Check Topic planner`,
        { size: 9.5, color: GREY },
      ),
      { after: 8 },
    ),
  )
  body.push(para(run(NOTICE, { italic: true, size: 9 }), { after: 8, shade: 'F4E9E4' }))

  body.push(head('The topic'))
  if (p.interest.trim()) body.push(line(p.interest.trim(), { label: 'Interest' }))
  if (workingTitle(p)) body.push(line(workingTitle(p), { label: 'Working title' }))
  body.push(line(question(p), { label: 'Question' }))
  if (objective(p)) body.push(line(objective(p), { label: 'Objective' }))
  if (p.rationale.trim()) body.push(line(p.rationale.trim(), { label: 'Rationale' }))
  if (p.reviews.trim()) body.push(line(p.reviews.trim(), { label: 'Existing reviews' }))
  if (p.gaps.trim()) body.push(line(p.gaps.trim(), { label: 'Gaps noticed' }))

  body.push(head('Eligibility criteria'))
  body.push(para(run('Include', { bold: true }), { after: 2, keepNext: true }))
  for (const t of c.include.length ? c.include : ['(not yet set)']) body.push(dash(t))
  body.push(para(run('Exclude', { bold: true }), { before: 4, after: 2, keepNext: true }))
  for (const t of c.exclude.length ? c.exclude : ['Studies that do not meet the criteria above'])
    body.push(dash(t))

  body.push(head('Search'))
  body.push(line(searchString(p) || '(not yet written)', { label: 'Search string' }))
  const used = SOURCES.filter((s) => p.sources[s.id]?.on)
  if (used.length)
    body.push(
      table(
        [2400, 1800, 1500, 3938],
        [
          ['Source', 'Last searched', 'Records found', 'Filters and limits'],
          ...used.map((s) => {
            const log = p.sources[s.id]!
            return [s.name, dateWords(log.date ?? ''), log.found ?? '', log.filters ?? '']
          }),
        ],
      ),
    )
  if (p.others.trim()) body.push(line(p.others.trim(), { label: 'Other sources' }))
  if (p.screener) body.push(line(p.screener, { label: 'Screening' }))
  if (p.registered.trim()) body.push(line(p.registered.trim(), { label: 'Registration' }))

  body.push(head('PRISMA 2020 flow'))
  for (const [label, n] of [
    ['Records identified from databases', f.databases],
    ['Records identified from registers', f.registers],
    ['Records removed before screening', f.removed],
    ['Records screened', f.screened],
    ['Records excluded', f.excluded],
    ['Reports sought for retrieval', f.sought],
    ['Reports not retrieved', f.notRetrieved],
    ['Reports assessed for eligibility', f.assessed],
    ...f.reasons.map((r) => [`Reports excluded: ${r.why}`, r.n] as const),
    ['Studies included in review', f.studies],
    ['Reports of included studies', f.reports],
  ] as const)
    body.push(line(String(n), { label }))
  for (const x of f.problems) body.push(line(x.text, { label: 'Check' }))
  body.push(line(`${v.head}. ${v.body}`, { label: 'Size of the topic' }))

  body.push(head('PRISMA 2020 checklist'))
  body.push(para(run(`${ENDORSEMENT} (${PRISMA_HOME})`, { size: 10 }), { after: 8 }))
  body.push(
    table(
      [1900, 500, 4938, 2300],
      [
        ['Section and topic', '#', 'Checklist item', 'Location where item is reported'],
        ...sectioned(
          MAIN,
          (i) => (p.where[i.id] ?? '').trim() || (drafted(p, i.id) && 'Drafted in this plan'),
        ),
      ],
    ),
  )
  body.push(head('PRISMA 2020 for Abstracts checklist'))
  body.push(
    table(
      [1900, 500, 5838, 1400],
      [
        ['Section and topic', '#', 'Checklist item', 'Reported (Yes/No)'],
        ...sectioned(ABSTRACT, (i) =>
          p.abstract[i.id] === 'yes' ? 'Yes' : p.abstract[i.id] === 'no' ? 'No' : '',
        ),
      ],
    ),
  )
  body.push(
    para(
      run(`Checklists from: ${PRISMA_CITATION}. Licensed under CC BY 4.0.`, {
        size: 9,
        color: GREY,
      }),
      {
        before: 10,
      },
    ),
  )
  return docxFile(body, `Topic plan: ${workingTitle(p) || p.interest || 'untitled'}`)
}
