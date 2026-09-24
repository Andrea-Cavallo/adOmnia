import enemiesUrl from './assets/desk-enemies-v2.png'
import deskUrl from './assets/developer-desk.png'
import castUrl from './assets/desk-cast.png'
import materialsUrl from './assets/desk-materials.png'

/** Loaded only with the game's lazy chunk. All artwork is bundled and offline. */
export const deskArt: { enemies?: HTMLImageElement; background?: HTMLImageElement; cast?: HTMLCanvasElement; materials?: HTMLImageElement } = {}
/** Authored rectangles: generated poses are not assumed to be a perfect grid. */
export const CAST_FRAMES = [
  [38, 82, 312, 430], [431, 85, 312, 441], [788, 85, 350, 441], [1160, 52, 370, 428],
  [10, 580, 400, 352], [440, 630, 310, 317], [775, 550, 305, 395], [1080, 530, 450, 426],
] as const

/** Chroma matte once at load, never in the frame loop. Preserve cyan eyes and white paper. */
export function keyMagenta(data: Uint8ClampedArray) {
  for (let i = 0; i < data.length; i += 4) {
    const spill = Math.min(data[i], data[i + 2]) - data[i + 1]
    if (spill > 60 && data[i] > 100 && data[i + 2] > 100) {
      const alpha = Math.max(0, 1 - (spill - 60) / 65)
      data[i + 3] = Math.round(data[i + 3] * alpha)
      // Despill the remaining antialiased edge.
      if (alpha > 0) { data[i] = Math.min(data[i], data[i + 1] + 35); data[i + 2] = Math.min(data[i + 2], data[i + 1] + 45) }
    }
  }
}

function prepareCast(image: HTMLImageElement): HTMLCanvasElement | undefined {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return undefined
  ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  keyMagenta(pixels.data); ctx.putImageData(pixels, 0, 0)
  return canvas
}
let pending: Promise<void> | undefined
export function loadDeskArt(): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve()
  return pending ??= Promise.all([
    ['enemies', enemiesUrl], ['background', deskUrl], ['cast', castUrl], ['materials', materialsUrl],
  ].map(([key, url]) => new Promise<void>((resolve) => {
    const image = new Image()
    image.onload = () => {
      try {
        if (key === 'enemies') deskArt.enemies = image
        else if (key === 'background') deskArt.background = image
        else if (key === 'materials') deskArt.materials = image
        else deskArt.cast = prepareCast(image)
      } catch { /* Canvas processing unavailable: keep the vector fallback. */ }
      finally { resolve() }
    }
    // Existing canvas artwork is a usable fallback if an asset cannot load.
    image.onerror = () => resolve()
    image.src = url
  }))).then(() => undefined)
}

export function drawCast(ctx: CanvasRenderingContext2D, cell: number, x: number, bottom: number, width: number, height: number, mirror = false): boolean {
  const image = deskArt.cast
  if (!image) return false
  const [sx, sy, sw, sh] = CAST_FRAMES[cell]
  const scale = Math.min(width / sw, height / sh)
  const w = sw * scale, h = sh * scale
  ctx.save()
  ctx.translate(x, bottom)
  if (mirror) ctx.scale(-1, 1)
  ctx.drawImage(image, sx, sy, sw, sh, -w / 2, -h, w, h)
  ctx.restore()
  return true
}
