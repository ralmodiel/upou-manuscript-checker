// The format checklist (data/Format Checklist.xlsx, the MDC program's copy of UPOU's central one), item for item and in its wording, plus a
// last group for things the program's reviewers point out that the checklist does not list.

export interface Item {
  id: string
  text: string
  links?: { label: string; href: string }[]
}

export interface Part {
  id: string
  name: string
  items: Item[]
  /** Not part of the official checklist. */
  extra?: boolean
}

const APA_FIGURES = 'https://apastyle.apa.org/style-grammar-guidelines/tables-figures/figures'
const APA_TABLES = 'https://apastyle.apa.org/style-grammar-guidelines/tables-figures/tables'
const APA_REFERENCES =
  'https://apastyle.apa.org/style-grammar-guidelines/paper-format/reference-list'

export const CHECKLIST: Part[] = [
  {
    id: 'title',
    name: 'Title Page',
    items: [
      { id: 'title.seal', text: 'Used official UP seal' },
      { id: 'title.sequence', text: 'Correct sequence of information' },
      { id: 'title.title', text: 'Indicated final thesis title; must be in upper case' },
      { id: 'title.adviser', text: 'Name of adviser spelled correctly' },
      { id: 'title.date', text: 'Indicated date of submission' },
      {
        id: 'title.permission',
        text: "Selected one permission classification code (one 'Yes', others marked as 'No')",
      },
      { id: 'title.signature', text: 'Affixed signature' },
      { id: 'title.pageNumber', text: 'No page number/footer (invisible page number i)' },
    ],
  },
  {
    id: 'permission',
    name: 'University Permission Page',
    items: [
      { id: 'permission.title', text: 'Indicated final thesis title; must be in upper case' },
      {
        id: 'permission.statement',
        text: 'Used either "I specifically allow..." or "Specifically, I grant..." (some manuscripts have both; request to remove one)',
      },
      { id: 'permission.signature', text: 'Signature and date of submission added' },
      {
        id: 'permission.pageNumber',
        text: 'With page number in the format (shortened thesis title + ellipsis + page number in Roman numeral - ii)',
      },
    ],
  },
  {
    id: 'acceptance',
    name: 'Acceptance Page',
    items: [
      { id: 'acceptance.title', text: 'Indicated final thesis title' },
      {
        id: 'acceptance.names',
        text: 'Names of the advisory committee and the Dean are correctly spelled',
      },
      {
        id: 'acceptance.convention',
        text: 'Uniformed naming convention (use either Dr./Asst. Prof. or degree abbreviations Ph.D./MA throughout)',
      },
      {
        id: 'acceptance.pageNumber',
        text: 'With page number in the format (shortened thesis title + ellipsis + page number in Roman numeral - iii)',
      },
    ],
  },
  {
    id: 'prelims',
    name: 'Other preliminary pages',
    items: [
      {
        id: 'prelims.present',
        text: 'With Biographical Sketch; Acknowledgment; Dedication; Table of Contents; List of Tables/Figures (if any); Abstract',
      },
      { id: 'prelims.justified', text: 'Body text must be justified in alignment' },
      { id: 'prelims.spacing', text: 'Double-spaced between lines' },
      {
        id: 'prelims.pageNumbers',
        text: 'With page number in the format (shortened thesis title + ellipsis + page number in Roman numerals)',
      },
    ],
  },
  {
    id: 'chapterStart',
    name: 'First page of each chapter',
    items: [
      { id: 'chapterStart.newPage', text: 'Started chapter in a new page' },
      {
        id: 'chapterStart.number',
        text: 'With chapter number (in title case, Roman numeral, bold text, Arial 12 pt.)',
      },
      {
        id: 'chapterStart.title',
        text: 'With chapter title (in upper case, bold text, Arial 12 pt.)',
      },
      { id: 'chapterStart.justified', text: 'Body text must be justified in alignment' },
      { id: 'chapterStart.spacing', text: 'Double-spaced between lines' },
      {
        id: 'chapterStart.noPageNumber',
        text: 'No page number/footer (invisible page number 1, etc.)',
      },
    ],
  },
  {
    id: 'body',
    name: 'Succeeding pages',
    items: [
      { id: 'body.hanging', text: 'No hanging (sub)headings, lines' },
      { id: 'body.justified', text: 'Body text must be justified in alignment' },
      { id: 'body.spacing', text: 'Double-spaced between lines' },
      {
        id: 'body.pageNumbers',
        text: 'With page numbers in the format (shortened thesis title + ellipsis + page number in Arabic numerals)',
      },
    ],
  },
  {
    id: 'figures',
    name: 'Figures and tables',
    items: [
      { id: 'figures.number', text: 'Figure/table number (in bold text) above the figure/table' },
      {
        id: 'figures.title',
        text: 'Figure/table title (in italics) right below the figure/table number',
      },
      {
        id: 'figures.apa',
        text: 'Follows the APA style figure and table setup',
        links: [
          { label: 'APA figure setup', href: APA_FIGURES },
          { label: 'APA table setup', href: APA_TABLES },
        ],
      },
    ],
  },
  {
    id: 'references',
    name: 'References',
    items: [
      { id: 'references.order', text: 'Reference list in alphabetical order' },
      {
        id: 'references.apa',
        text: 'Follows the APA style reference list setup',
        links: [{ label: 'APA reference list setup', href: APA_REFERENCES }],
      },
      {
        id: 'references.pageNumbers',
        text: 'With page numbers in the format (shortened thesis title + ellipsis + page number in Arabic numerals)',
      },
    ],
  },
  {
    id: 'appendices',
    name: 'Appendices (if any)',
    items: [
      { id: 'appendices.labels', text: 'Properly labelled' },
      {
        id: 'appendices.pageNumbers',
        text: 'With page numbers in the format (shortened thesis title + ellipsis + page number in Arabic numerals)',
      },
    ],
  },
  {
    id: 'extra',
    name: 'Also noticed (not on the checklist)',
    extra: true,
    items: [
      { id: 'extra.placeholders', text: 'No template placeholder text left' },
      { id: 'extra.blankPages', text: 'No blank pages' },
      { id: 'extra.color', text: 'Text is black (no colored text)' },
    ],
  },
]

export const ITEMS = CHECKLIST.flatMap((p) => p.items)

/** A part's letter as the checklist sections are named (A. Title Page, B. …); "+" for the extra part. */
export const partLetter = (k: number): string =>
  CHECKLIST[k].extra ? '+' : String.fromCharCode(65 + k)
