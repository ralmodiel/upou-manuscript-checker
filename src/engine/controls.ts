// Drops control characters (C0, except the ones named in `keep`), which XML 1.0 and the readers'
// text never carry. A char-code test rather than a regular expression of control characters.
export const stripControls = (s: string, keep = '\t\n\r') =>
  [...s].filter((c) => c.charCodeAt(0) >= 0x20 || keep.includes(c)).join('')
