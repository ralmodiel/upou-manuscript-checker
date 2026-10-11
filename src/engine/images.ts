// Pictures, reduced to what the seal check needs: a small RGBA copy and a 64-bit difference hash
// (dHash), which survives resizing, recompression and a white or transparent background.
import type { Pixels } from './model.ts'

/** Box-filtered resize to exactly `w` x `h`, composited over white. */
export function resize(img: Pixels, w: number, h: number): Pixels {
  const out = new Uint8ClampedArray(w * h * 4)
  const sx = img.width / w
  const sy = img.height / h
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const k = (yy * img.width + xx) * 4
          const a = img.data[k + 3] / 255
          r += img.data[k] * a + 255 * (1 - a)
          g += img.data[k + 1] * a + 255 * (1 - a)
          b += img.data[k + 2] * a + 255 * (1 - a)
          n++
        }
      const o = (y * w + x) * 4
      out[o] = r / n
      out[o + 1] = g / n
      out[o + 2] = b / n
      out[o + 3] = 255
    }
  }
  return { width: w, height: h, data: out }
}

/** At most `max` px a side, same proportions. */
export function shrink(img: Pixels, max: number): Pixels {
  const scale = Math.min(1, max / Math.max(img.width, img.height))
  if (scale === 1) return resize(img, img.width, img.height)
  return resize(
    img,
    Math.max(1, Math.round(img.width * scale)),
    Math.max(1, Math.round(img.height * scale)),
  )
}

/** 16 hex digits: for each of 8 rows, whether each of 8 pixels is darker than its right neighbour. */
export function dHash(img: Pixels): string {
  const small = resize(img, 9, 8)
  const grey = (k: number) =>
    0.299 * small.data[k * 4] + 0.587 * small.data[k * 4 + 1] + 0.114 * small.data[k * 4 + 2]
  let bits = ''
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) bits += grey(y * 9 + x) < grey(y * 9 + x + 1) ? '1' : '0'
  let hex = ''
  for (let k = 0; k < 64; k += 4) hex += parseInt(bits.slice(k, k + 4), 2).toString(16)
  return hex
}

export function hamming(a: string, b: string): number {
  let d = 0
  for (let k = 0; k < Math.min(a.length, b.length); k++) {
    let x = parseInt(a[k], 16) ^ parseInt(b[k], 16)
    while (x) {
      d += x & 1
      x >>= 1
    }
  }
  return d
}

/** Mean colourfulness (0 grey to 255 vivid): the UP seal is maroon, green and gold. */
export function colourfulness(img: Pixels): number {
  let sum = 0
  const n = img.width * img.height
  for (let k = 0; k < n; k++) {
    const r = img.data[k * 4]
    const g = img.data[k * 4 + 1]
    const b = img.data[k * 4 + 2]
    sum += Math.max(r, g, b) - Math.min(r, g, b)
  }
  return n ? sum / n : 0
}
