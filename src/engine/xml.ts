// XML helpers over the browser's own parser. Office files use fixed prefixes in practice, but
// elements and attributes are matched by local name so any prefix (or Strict OOXML) still reads.

export function parseXml(text: string): Document {
  // Office and OpenDocument parts never declare a DTD; refusing one rules out entity tricks.
  if (/<!DOCTYPE/i.test(text.slice(0, 2048))) throw new Error('Unexpected DTD in document part')
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Unreadable XML part')
  return doc
}

export const local = (el: Element) => el.localName

/** Child elements, optionally only those with the given local name. */
export function kids(el: Element | null | undefined, name?: string): Element[] {
  if (!el) return []
  const out: Element[] = []
  for (const c of el.children) if (!name || c.localName === name) out.push(c)
  return out
}

export const kid = (el: Element | null | undefined, name: string) =>
  el
    ? (Array.prototype.find.call(el.children, (c: Element) => c.localName === name) as
        Element | undefined)
    : undefined

/** Descendants with the given local name, in document order. */
export function all(el: Element | Document, name: string): Element[] {
  return Array.from(el.getElementsByTagName('*')).filter((e) => e.localName === name)
}

/** Attribute by local name (w:val, r:id, style:name, ...). */
export function attr(el: Element | null | undefined, name: string): string | undefined {
  if (!el) return undefined
  for (const a of el.attributes) if (a.localName === name) return a.value
  return undefined
}

/** A WordprocessingML on/off property: present means on unless its val says otherwise. */
export function toggle(el: Element | null | undefined): boolean | undefined {
  if (!el) return undefined
  const v = attr(el, 'val')
  return v === undefined || !/^(0|false|off|none)$/i.test(v)
}

export const num = (v: string | undefined) => {
  const n = v === undefined ? NaN : parseFloat(v)
  return Number.isFinite(n) ? n : undefined
}
