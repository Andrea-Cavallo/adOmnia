/**
 * Reading the painted sheets: where each cell's art actually starts and ends. The sheets are
 * generated with uneven padding, so every rect is measured from the alpha once, before the run.
 */
export interface SpriteRect { x: number; y: number; w: number; h: number }

/** Remove isolated scanline fragments from a neighbouring atlas row. */
export function trimSpriteRows(image: HTMLImageElement, rects: SpriteRect[]): HTMLCanvasElement {
  const source = canvasOf(image.naturalWidth, image.naturalHeight), context = source.getContext('2d')!
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, source.width, source.height).data
  const clean = canvasOf(source.width, source.height), paint = clean.getContext('2d')!
  for (const rect of rects) {
    const runs: Array<{ top: number; bottom: number }> = []
    for (let y = 0; y < rect.h; y++) {
      const occupied = (row: number) => {
        for (let x = 0; x < rect.w; x++) if (pixels[((rect.y + row) * source.width + rect.x + x) * 4 + 3] >= 24) return true
        return false
      }
      if (!occupied(y)) continue
      const top = y
      while (y + 1 < rect.h && occupied(y + 1)) y++
      runs.push({ top, bottom: y })
    }
    const tallest = runs.reduce((best, run) => run.bottom - run.top > best.bottom - best.top ? run : best, { top: 0, bottom: -1 })
    if (tallest.bottom < 0) continue
    rect.y += tallest.top; rect.h = tallest.bottom - tallest.top + 1
    paint.drawImage(image, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h)
  }
  return clean
}

const canvasOf = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** The alpha bounds of every cell of a `columns × rows` sheet. */
export function spriteBounds(
  atlas: HTMLImageElement,
  columns = 4,
  rows = 4,
  create: (width: number, height: number) => HTMLCanvasElement = canvasOf,
): SpriteRect[] {
  const canvas = create(atlas.naturalWidth, atlas.naturalHeight)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('The sprite atlas could not be read.')
  context.drawImage(atlas, 0, 0)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const cellW = Math.floor(canvas.width / columns)
  const cellH = Math.floor(canvas.height / rows)
  return Array.from({ length: columns * rows }, (_, index) => {
    const x0 = (index % columns) * cellW
    const y0 = Math.floor(index / columns) * cellH
    let left = cellW, right = -1, top = cellH, bottom = -1
    for (let y = 0; y < cellH; y++) for (let x = 0; x < cellW; x++) {
      if (pixels[((y0 + y) * canvas.width + x0 + x) * 4 + 3] < 24) continue
      left = Math.min(left, x); right = Math.max(right, x)
      top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
    if (right < left) throw new Error(`Sprite ${index} is empty.`)
    const body = bodyColumns(pixels, canvas.width, x0, y0, left, right, top, bottom)
    return { x: x0 + body.left, y: y0 + top, w: body.right - body.left + 1, h: bottom - top + 1 }
  })
}

/**
 * A cell sometimes has a prop painted beside the monster: the armored ghoul shares his cell with a
 * gravestone, and the sheet's bleed leaves slivers at the edge. Every column between them is empty,
 * so keep the widest stretch of columns and drop anything narrow hanging off it.
 */
function bodyColumns(
  pixels: Uint8ClampedArray,
  stride: number,
  x0: number,
  y0: number,
  left: number,
  right: number,
  top: number,
  bottom: number,
): { left: number; right: number } {
  const filled: boolean[] = []
  for (let x = left; x <= right; x++) {
    let any = false
    for (let y = top; y <= bottom && !any; y++) any = pixels[((y0 + y) * stride + x0 + x) * 4 + 3] >= 24
    filled.push(any)
  }
  const runs: { from: number; to: number }[] = []
  for (let index = 0; index < filled.length; index++) {
    if (!filled[index]) continue
    const start = index
    while (index + 1 < filled.length && filled[index + 1]) index++
    runs.push({ from: start, to: index })
  }
  if (runs.length < 2) return { left, right }
  const widest = runs.reduce((best, run) => (run.to - run.from > best.to - best.from ? run : best))
  const keep = runs.filter((run) => run.to - run.from + 1 >= (widest.to - widest.from + 1) * 0.3)
  return { left: left + Math.min(...keep.map((run) => run.from)), right: left + Math.max(...keep.map((run) => run.to)) }
}

/**
 * Frames of one walk cycle must share a rect. Trimmed separately, every frame gets its own bounds
 * and the body jumps sideways whenever the sheet swaps pose, which reads as sliding.
 */
export function shareRect(rects: SpriteRect[], frames: number[], cellWidth: number, cellHeight: number, columns = 4): void {
  const group = frames.filter((index) => !!rects[index]).map((index) => ({ ...rects[index], x: rects[index].x - index % columns * cellWidth, y: rects[index].y - Math.floor(index / columns) * cellHeight }))
  if (group.length < 2) return
  const x = Math.min(...group.map((rect) => rect.x))
  const y = Math.min(...group.map((rect) => rect.y))
  const right = Math.max(...group.map((rect) => rect.x + rect.w))
  const bottom = Math.max(...group.map((rect) => rect.y + rect.h))
  const shared = { x, y, w: right - x, h: bottom - y }
  for (const index of frames) if (rects[index]) rects[index] = { ...shared, x: shared.x + index % columns * cellWidth, y: shared.y + Math.floor(index / columns) * cellHeight }
}
