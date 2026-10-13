// The manuscript as every reader delivers it: paragraphs in reading order with the formatting the
// file states, plus pages (PDF) or sections (Word, OpenDocument). A field is absent when the format
// cannot tell (a .doc is read for its text only; a PDF has no style names).

export type Kind = 'docx' | 'pdf' | 'odt' | 'rtf' | 'doc'
export type Align = 'left' | 'center' | 'right' | 'justify'

export interface Run {
  text: string
  bold?: boolean
  italic?: boolean
  /** All-caps formatting: the letters show in upper case whatever was typed. */
  caps?: boolean
  font?: string
  /** Points. */
  size?: number
  /** 'rrggbb', only when it is not black or automatic. */
  color?: string
  /** Inside a hyperlink (its colour is the link's, not the writer's). */
  link?: boolean
  /** PDF: the font's name says nothing (`CIDFont+F4`), so its typeface, bold and italics are unknown. */
  unknown?: boolean
}

/** A PDF text line: baseline `y` from the top of the page, `x0`-`x1` across it (points). */
export interface Line {
  page: number
  y: number
  x0: number
  x1: number
  size: number
  text: string
  runs: Run[]
  /** Words (pdf.js text items) and where they stand. */
  spans: { text: string; x0: number; x1: number }[]
}

export interface Para {
  /** Index in Doc.paras. */
  i: number
  /** Visible text; tabs stay `\t`, line breaks `\n`. All-caps runs are given as typed. */
  text: string
  runs: Run[]
  align?: Align
  /** Line spacing as a multiple of single spacing (2 = double). */
  spacing?: number
  /** Points: left indent, and the first line's offset from it (negative for a hanging indent). */
  indent?: { left: number; firstLine: number }
  /** Starts a new page: a page or section break before it (Word), its first line opens a page (PDF). */
  newPage?: boolean
  /** 0-based physical page, when known (always for PDF). */
  page?: number
  /** Word/OpenDocument section index. */
  section?: number
  inTable?: boolean
  /** Which table (0-based, in reading order) a paragraph inside a table belongs to. */
  table?: number
  /** In a text box or frame. */
  inBox?: boolean
  /** Drawn shapes anchored here (Word): their offset from the column (points) and their text. */
  shapes?: { x?: number; text: string }[]
  /** Holds a picture or drawing (Word); stands beside a picture (PDF: see Page.images). */
  image?: boolean
  /** Paragraph style name, e.g. 'Heading 1' or 'Caption'. */
  style?: string
  list?: boolean
  keepNext?: boolean
  /** Word's own pagination at its last save: the page broke inside or before this paragraph. */
  renderedBreak?: 'before' | 'inside'
  /** PDF lines of this paragraph. */
  lines?: Line[]
  /** Its formatting is unknown (a .doc read for its text): no bold, fonts or alignment to judge. */
  plain?: boolean
}

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** A PDF page. Coordinates are points from the top-left corner. */
export interface Page {
  n: number
  width: number
  height: number
  header: string
  footer: string
  footerLines: Line[]
  /** Paragraph indices whose first line is on this page. */
  paras: number[]
  /** Pictures; `ink` (0 white to 1 black) for the small ones on the first pages (tick boxes). */
  images: (Box & {
    ink?: number
    /** Drawing order on the page: a later white shape may cover it. */
    z?: number
  })[]
  /** Ink, stamps, free text and drawn shapes: anything a signature or a tick could be. */
  marks: (Box & {
    kind: string
    count?: number
    /** Drawing order on the page (not for annotations, which come after the page's content). */
    z?: number
    /** A filled path's colour ('#rrggbb'). */
    fill?: string
    /** A path neither stroked nor filled (a clipping outline): nothing of it shows. */
    clip?: boolean
    /** A form field: filled in (ticked, chosen, typed) or not. */
    on?: boolean
  })[]
  /** Small text marks (✓, X, /) and where they stand, for the permission boxes. */
  glyphs: (Box & { text: string })[]
  /** Letters of text set turned (a landscape table's cells): not part of the lines, but on the page. */
  turned?: number
  /** The turned letters themselves (a caption set sideways beside a landscape figure). */
  turnedText?: string
  /** Text painted in a colour other than black ('#rrggbb'). */
  colored: {
    text: string
    color: string
    /** White words set on a coloured filled shape (a box of a diagram, a table's header row). */
    shape?: boolean
  }[]
  /** Coloured text inside hyperlinks was left out of `colored` (a link keeps its colour). */
  linked?: boolean
  /** Its text is drawn invisibly over a picture of the page (a scan's machine-read layer): its
   *  words may be read, its fonts, sizes and line positions are guesses. */
  ocr?: boolean
  /** Footer words in the file that do not show (white, or under a white box drawn over them). */
  hiddenFoot?: string
  /** A note laid over a line shows words that are not in the file's text: what it says is unread. */
  veiled?: boolean
  /** The share of its words a font printed with wrong glyphs (only where that is several): what
   *  rests on its words may be misread. */
  unreliable?: number
  /** Where the lines of running text start and end, as read from the page. */
  margins?: { left: number; right: number }
}

/** A Word/OpenDocument header or footer: its text with `{PAGE}` where the page number shows. */
export interface HeaderFooter {
  text: string
  /** Number format forced by the field itself (PAGE \* roman), overriding the section's. */
  format?: NumberFormat
}

export type NumberFormat = 'decimal' | 'lowerRoman' | 'upperRoman' | 'lowerLetter' | 'upperLetter'

export interface Section {
  first: number
  last: number
  /** Page number this section restarts at, if it restarts. */
  start?: number
  format: NumberFormat
  titlePage: boolean
  /** Where the page number shows: the footers, or the headers for pages numbered at the top. */
  footer: { default?: HeaderFooter; first?: HeaderFooter; even?: HeaderFooter }
  newPage: boolean
}

export interface Picture {
  para: number
  /** Points, when the file says. */
  width?: number
  height?: number
  /** Loads the image file's bytes (Word, OpenDocument), for the seal check. */
  bytes?: () => Uint8Array | undefined
  /** PDF: decoded pixels of the image as painted. */
  pixels?: () => Promise<Pixels | undefined>
  /** PDF: the 0-based page it is painted on. */
  page?: number
}

export interface Pixels {
  width: number
  height: number
  /** RGBA, 4 bytes per pixel. */
  data: Uint8ClampedArray | Uint8Array
}

export interface Doc {
  kind: Kind
  paras: Para[]
  pages?: Page[]
  sections?: Section[]
  /** Word setting: odd and even pages have their own footers. */
  evenOdd?: boolean
  pictures: Picture[]
  /** Things the reader could not do (scanned pages, unsupported parts), said to the student. */
  notes: string[]
  /** Word: the tables (by `Para.table`) with lines drawn between their columns. */
  ruled?: number[]
  /** Hardly any text could be read (a scanned PDF): no item can be judged. */
  unreadable?: boolean
}
