/**
 * The knight without his armor: the same painted frames, with every steel pixel turned into linen
 * underclothes and the helmet into a bare head. The red cape, gold trim and dark outline stay, so he
 * is still clearly the knight, only now plainly one hit from death. Built once at load time from the
 * existing atlases, inside the knight frames only (terrain cells in the same sheets are untouched).
 */

interface Rect { x: number; y: number; w: number; h: number }

/** Pixels darker than this are outline and shadow: kept as they are. */
const OUTLINE = 48
/** Above this spread between channels a pixel is cloth, gold or skin, not grey steel. */
const STEEL_SPREAD = 38
/** The top of each frame, as a share of its height, is his head. */
const HEAD_SHARE = 0.2
const LINEN = [240, 228, 200] as const
const SKIN = [222, 160, 118] as const

/** The color one pixel takes without armor, or the pixel unchanged when it is not armor. */
export function bareColor(r: number, g: number, b: number, head = false): readonly [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  // The cape is red-dominant even in its darkest folds; steel keeps red and green close.
  const cape = r > g + 10 && r > b + 4
  if (max < OUTLINE || max - min > STEEL_SPREAD || cape) return [r, g, b]
  // Flatten the steel's shading so plate edges fade into cloth folds.
  const light = 0.6 + 0.4 * Math.min(1, (0.299 * r + 0.587 * g + 0.114 * b) / 150)
  const base = head ? SKIN : LINEN
  return [Math.round(base[0] * light), Math.round(base[1] * light), Math.round(base[2] * light)]
}

/** A copy of a knight sheet with the armor stripped inside `frames`. Falls back to the original when the canvas cannot be read. */
export function strippedAtlas(image: HTMLImageElement, frames: readonly Rect[]): HTMLImageElement | HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return image
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  const data = pixels.data
  for (const frame of frames) {
    const headBottom = frame.y + frame.h * HEAD_SHARE
    for (let y = frame.y; y < frame.y + frame.h; y++) for (let x = frame.x; x < frame.x + frame.w; x++) {
      const index = (y * canvas.width + x) * 4
      if (data[index + 3] === 0) continue
      const [r, g, b] = bareColor(data[index], data[index + 1], data[index + 2], y < headBottom)
      data[index] = r
      data[index + 1] = g
      data[index + 2] = b
    }
  }
  context.putImageData(pixels, 0, 0)
  return canvas
}
