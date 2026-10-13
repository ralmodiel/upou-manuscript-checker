// What a check produces: one finding per checklist item.
import type { Doc, Kind, Pixels } from './model.ts'
import type { Structure } from './structure.ts'

/** fix: needs correcting · review: look at it yourself · ok: passed · na: not applicable. */
export type Status = 'fix' | 'review' | 'ok' | 'na'

export interface Where {
  /** 0-based physical page (PDF). */
  page?: number
  /** Short quote of the paragraph or footer, to find it in the file. */
  quote?: string
}

export interface Finding {
  id: string
  status: Status
  /** One sentence: the correction to make, or what was found right. */
  message: string
  details?: string[]
  where?: Where[]
}

export interface Report {
  fileName: string
  kind: Kind
  pages?: number
  /** The title as the title page gives it, when found. */
  title?: string
  /** PDF: the page number printed on each page ("vii", "48"; undefined where none shows), by
   *  0-based physical page, as `Where.page` counts them. */
  pageLabels?: (string | undefined)[]
  findings: Finding[]
  notes: string[]
  /** Milliseconds spent reading and checking. */
  ms: number
}

/** What the browser (or a test) lends the engine. */
export interface Env {
  /** Decodes PNG/JPEG/GIF/BMP/WebP bytes; absent where there is no decoder (tests). */
  decodeImage?: (bytes: Uint8Array) => Promise<Pixels | undefined>
}

export interface Ctx {
  doc: Doc
  s: Structure
  env: Env
}

const make =
  (status: Status) =>
  (
    id: string,
    message: string,
    extra: Omit<Finding, 'id' | 'status' | 'message'> = {},
  ): Finding => ({
    id,
    status,
    message,
    ...extra,
  })
export const fix = make('fix')
export const review = make('review')
export const ok = make('ok')
export const na = make('na')

/** A fault read from strong evidence (measured on clear running text, repeated or large) is a fix;
 *  from weaker evidence the same finding is a review whose message says it may be so. */
export const weigh = (
  strong: boolean,
  id: string,
  message: string,
  check: string,
  extra: Omit<Finding, 'id' | 'status' | 'message'> = {},
): Finding => (strong ? fix(id, message, extra) : review(id, `Check: ${check}`, extra))

/** At most `n` places, in their order: each page's first before a second on one page, so the
 *  places cover the pages the details name. */
export function spread<T extends Where>(xs: T[], n = 5): T[] {
  const firsts = xs.filter((x, k) => xs.findIndex((y) => y.page === x.page) === k)
  const kept = new Set([...firsts, ...xs.filter((x) => !firsts.includes(x))].slice(0, n))
  return xs.filter((x) => kept.has(x))
}

const RANK: Record<Status, number> = { fix: 3, review: 2, ok: 1, na: 0 }
/** The more serious of several statuses. */
export const worst = (xs: Status[]): Status =>
  xs.reduce<Status>((a, b) => (RANK[b] > RANK[a] ? b : a), 'na')
