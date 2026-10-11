/** Whether a canvas gives back the pixels drawn on it. Privacy settings (Tor and Mullvad Browser,
 *  Firefox's resistFingerprinting, Brave) blank or perturb them, and a seal compared on such pixels
 *  would come out wrong: there, pictures are not read, and the seal is left for a second look. */
let readsBack: boolean | undefined

export function canvasReadsBack(): boolean {
  if (readsBack === undefined) {
    try {
      const canvas =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(2, 2)
          : Object.assign(document.createElement('canvas'), { width: 2, height: 2 })
      const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
        OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
      ctx!.fillStyle = '#c83214'
      ctx!.fillRect(0, 0, 2, 2)
      const d = ctx!.getImageData(0, 0, 2, 2).data
      readsBack = [0, 4, 8, 12].every((k) => d[k] === 200 && d[k + 1] === 50 && d[k + 2] === 20)
    } catch {
      readsBack = false
    }
  }
  return readsBack
}
