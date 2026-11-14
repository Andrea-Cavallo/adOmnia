/**
 * Outlines of the shape geometries as SVG paths, for any size. The canvas nodes and the library
 * previews draw from here, so a shape looks the same in both. `bodies` are filled and stroked,
 * `lines` are stroked only (rims, folds, separators).
 */
import type { ShapeGeometry } from './model'

export interface Outline {
  bodies: string[]
  lines: string[]
}

const NONE: Outline = { bodies: [], lines: [] }
/** Height of a container's title band. */
export const CONTAINER_TITLE_HEIGHT = 28

const rect = (x: number, y: number, w: number, h: number) => `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`

function roundedRect(x: number, y: number, w: number, h: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  return `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`
}

const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`

/** A cloud drawn in a unit square, scaled to the box. */
const CLOUD: ReadonlyArray<readonly number[]> = [
  [0.25, 0.86], [0.04, 0.86, 0.0, 0.55, 0.2, 0.5], [0.14, 0.24, 0.42, 0.12, 0.5, 0.3],
  [0.6, 0.06, 0.92, 0.14, 0.85, 0.42], [1.0, 0.46, 1.0, 0.86, 0.78, 0.86],
]

function cloud(x: number, y: number, w: number, h: number): string {
  const px = (value: number) => x + value * w
  const py = (value: number) => y + value * h
  const [start, ...curves] = CLOUD
  return `M ${px(start[0])} ${py(start[1])} ${curves.map((c) => `C ${px(c[0])} ${py(c[1])} ${px(c[2])} ${py(c[3])} ${px(c[4])} ${py(c[5])}`).join(' ')} Z`
}

/** A five-pointed star inscribed in the box. */
function star(x: number, y: number, w: number, h: number): string {
  const points = Array.from({ length: 10 }, (_, index) => {
    const radius = index % 2 === 0 ? 0.5 : 0.2
    const angle = (Math.PI / 5) * index - Math.PI / 2
    return `${x + w * (0.5 + radius * Math.cos(angle))} ${y + h * (0.5 + radius * Math.sin(angle))}`
  })
  return `M ${points.join(' L ')} Z`
}

/** The outline of a geometry in a w×h box, inset so a stroke of the given width stays inside it. */
export function outlineOf(geometry: ShapeGeometry, width: number, height: number, strokeWidth = 1.5): Outline {
  const s = strokeWidth / 2
  const x = s
  const y = s
  const w = Math.max(1, width - strokeWidth)
  const h = Math.max(1, height - strokeWidth)
  switch (geometry) {
    case 'rectangle':
    case 'uml-class':
      return { bodies: [rect(x, y, w, h)], lines: [] }
    case 'rounded':
      return { bodies: [roundedRect(x, y, w, h, 10)], lines: [] }
    case 'pill':
      return { bodies: [roundedRect(x, y, w, h, h / 2)], lines: [] }
    case 'diamond':
      return { bodies: [`M ${x + w / 2} ${y} L ${x + w} ${y + h / 2} L ${x + w / 2} ${y + h} L ${x} ${y + h / 2} Z`], lines: [] }
    case 'parallelogram': {
      const skew = Math.min(22, w * 0.15)
      return { bodies: [`M ${x + skew} ${y} H ${x + w} L ${x + w - skew} ${y + h} H ${x} Z`], lines: [] }
    }
    case 'ellipse':
    case 'circle':
      return { bodies: [ellipse(x + w / 2, y + h / 2, w / 2, h / 2)], lines: [] }
    case 'cylinder': {
      const ry = Math.min(12, h * 0.15)
      const body = `M ${x} ${y + ry} V ${y + h - ry} A ${w / 2} ${ry} 0 0 0 ${x + w} ${y + h - ry} V ${y + ry}`
      return { bodies: [`${body} Z`, ellipse(x + w / 2, y + ry, w / 2, ry)], lines: [] }
    }
    case 'queue': {
      const rx = Math.min(14, w * 0.1)
      const body = `M ${x + rx} ${y} H ${x + w - rx} A ${rx} ${h / 2} 0 0 1 ${x + w - rx} ${y + h} H ${x + rx} A ${rx} ${h / 2} 0 0 1 ${x + rx} ${y} Z`
      return { bodies: [body], lines: [`M ${x + w - rx} ${y} A ${rx} ${h / 2} 0 0 0 ${x + w - rx} ${y + h}`] }
    }
    case 'hexagon': {
      const inset = Math.min(24, w * 0.18)
      return { bodies: [`M ${x + inset} ${y} H ${x + w - inset} L ${x + w} ${y + h / 2} L ${x + w - inset} ${y + h} H ${x + inset} L ${x} ${y + h / 2} Z`], lines: [] }
    }
    case 'document': {
      const wave = Math.min(10, h * 0.14)
      return { bodies: [`M ${x} ${y} H ${x + w} V ${y + h - wave} Q ${x + w * 0.75} ${y + h - wave * 2.2} ${x + w / 2} ${y + h - wave} T ${x} ${y + h - wave} Z`], lines: [] }
    }
    case 'cloud':
      return { bodies: [cloud(x, y, w, h)], lines: [] }
    case 'package': {
      const tabW = Math.min(w * 0.4, 90)
      const tabH = Math.min(18, h * 0.2)
      return { bodies: [`M ${x} ${y} H ${x + tabW} V ${y + tabH} H ${x + w} V ${y + h} H ${x} Z`], lines: [`M ${x} ${y + tabH} H ${x + tabW}`] }
    }
    case 'component': {
      const notch = Math.min(16, w * 0.1)
      const tabs = [h * 0.28, h * 0.58].map((top) => rect(x - notch / 2 + s, y + top, notch, Math.min(12, h * 0.16)))
      return { bodies: [rect(x + notch / 2, y, w - notch / 2, h), ...tabs], lines: [] }
    }
    case 'container':
      return { bodies: [roundedRect(x, y, w, h, 8)], lines: [`M ${x} ${y + CONTAINER_TITLE_HEIGHT} H ${x + w}`] }
    case 'note': {
      const fold = Math.min(16, w * 0.15, h * 0.2)
      return { bodies: [`M ${x} ${y} H ${x + w - fold} L ${x + w} ${y + fold} V ${y + h} H ${x} Z`], lines: [`M ${x + w - fold} ${y} V ${y + fold} H ${x + w}`] }
    }
    case 'actor': {
      // The figure keeps the top of the box; its name is written underneath.
      const cx = x + w / 2
      const figure = h * 0.72
      const head = Math.min(w * 0.22, figure * 0.16)
      const hips = y + figure * 0.68
      return {
        bodies: [ellipse(cx, y + head, head, head)],
        lines: [`M ${cx} ${y + head * 2} V ${hips}`, `M ${x + w * 0.15} ${y + figure * 0.42} H ${x + w * 0.85}`, `M ${x + w * 0.2} ${y + figure} L ${cx} ${hips} L ${x + w * 0.8} ${y + figure}`],
      }
    }
    case 'triangle':
      return { bodies: [`M ${x + w / 2} ${y} L ${x + w} ${y + h} H ${x} Z`], lines: [] }
    case 'star':
      return { bodies: [star(x, y, w, h)], lines: [] }
    case 'arrow': {
      const head = Math.min(w * 0.4, h * 0.8)
      const shaft = h * 0.25
      return { bodies: [`M ${x} ${y + shaft} H ${x + w - head} V ${y} L ${x + w} ${y + h / 2} L ${x + w - head} ${y + h} V ${y + h - shaft} H ${x} Z`], lines: [] }
    }
    case 'subprocess': {
      const bar = Math.min(12, w * 0.1)
      return { bodies: [rect(x, y, w, h)], lines: [`M ${x + bar} ${y} V ${y + h}`, `M ${x + w - bar} ${y} V ${y + h}`] }
    }
    case 'manual-input': {
      const slope = Math.min(18, h * 0.3)
      return { bodies: [`M ${x} ${y + slope} L ${x + w} ${y} V ${y + h} H ${x} Z`], lines: [] }
    }
    case 'delay': {
      const r = Math.min(h / 2, w / 2)
      return { bodies: [`M ${x} ${y} H ${x + w - r} A ${r} ${h / 2} 0 0 1 ${x + w - r} ${y + h} H ${x} Z`], lines: [] }
    }
    case 'off-page': {
      const tip = Math.min(h * 0.35, 24)
      return { bodies: [`M ${x} ${y} H ${x + w} V ${y + h - tip} L ${x + w / 2} ${y + h} L ${x} ${y + h - tip} Z`], lines: [] }
    }
    case 'text':
      return NONE
  }
}
