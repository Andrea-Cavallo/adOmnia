/**
 * Connector geometry: the points an edge passes through and the SVG path that draws them.
 * Orthogonal connectors without waypoints are routed automatically: a handful of candidate routes
 * are scored (crossing a node costs most, then length, then bends) and the best one wins.
 */
import type { EdgeRouting, Waypoint } from './model'
import type { Rect } from './graphOps'

export type Side = 'top' | 'right' | 'bottom' | 'left'
export interface Point { x: number; y: number }
export interface Anchor extends Point { side: Side }

/** How far a connector leaves its node straight before it turns. */
export const EXIT_OFFSET = 20
/** Free space kept between a routed connector and the nodes it avoids. */
const OBSTACLE_MARGIN = 12
const CORNER_RADIUS = 8
const CROSSING_COST = 10_000
const BEND_COST = 18

const DIRECTION: Record<Side, Point> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } }

const step = (anchor: Anchor, distance = EXIT_OFFSET): Point => ({
  x: anchor.x + DIRECTION[anchor.side].x * distance,
  y: anchor.y + DIRECTION[anchor.side].y * distance,
})

/**
 * Ends for a connector attached to no particular point: the middle of the two sides that face each
 * other, so it follows the nodes wherever they move.
 */
export function floatingAnchors(source: Rect, target: Rect): [Anchor, Anchor] {
  const dx = target.x + target.width / 2 - (source.x + source.width / 2)
  const dy = target.y + target.height / 2 - (source.y + source.height / 2)
  const sideOf = (rect: Rect, side: Side): Anchor => ({
    side,
    x: side === 'left' ? rect.x : side === 'right' ? rect.x + rect.width : rect.x + rect.width / 2,
    y: side === 'top' ? rect.y : side === 'bottom' ? rect.y + rect.height : rect.y + rect.height / 2,
  })
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? [sideOf(source, 'right'), sideOf(target, 'left')] : [sideOf(source, 'left'), sideOf(target, 'right')]
  return dy >= 0 ? [sideOf(source, 'bottom'), sideOf(target, 'top')] : [sideOf(source, 'top'), sideOf(target, 'bottom')]
}

/** The points of an edge, ends included, for the given routing. */
export function edgePoints(routing: EdgeRouting, source: Anchor, target: Anchor, waypoints: readonly Waypoint[], obstacles: readonly Rect[] = []): Point[] {
  if (routing !== 'orthogonal') return [source, ...waypoints, target]
  if (waypoints.length > 0) return simplify([source, ...orthogonalThrough([step(source), ...waypoints, step(target)]), target])
  return simplify([source, ...autoRoute(source, target, obstacles), target])
}

/** The SVG path of the points: straight segments, rounded orthogonal corners or a smooth curve. */
export function pathOf(routing: EdgeRouting, points: readonly Point[]): string {
  if (points.length < 2) return ''
  if (routing === 'bezier') return smoothPath(points)
  if (routing === 'orthogonal') return roundedPath(points, CORNER_RADIUS)
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

/** The point halfway along the path, where the label sits. */
export function midpoint(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  const lengths = points.slice(1).map((point, index) => distance(points[index], point))
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2
  for (let index = 0; index < lengths.length; index++) {
    if (remaining <= lengths[index] && lengths[index] > 0) {
      const ratio = remaining / lengths[index]
      const from = points[index]
      const to = points[index + 1]
      return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio }
    }
    remaining -= lengths[index]
  }
  return points[points.length - 1]
}

// ---- orthogonal routing

/** Turns a list of points into horizontal and vertical segments, one elbow per pair. */
function orthogonalThrough(points: readonly Point[]): Point[] {
  const out: Point[] = [points[0]]
  for (let index = 1; index < points.length; index++) {
    const from = out[out.length - 1]
    const to = points[index]
    if (from.x !== to.x && from.y !== to.y) out.push({ x: to.x, y: from.y })
    out.push(to)
  }
  return out
}

function autoRoute(source: Anchor, target: Anchor, obstacles: readonly Rect[]): Point[] {
  const start = step(source)
  const end = step(target)
  const inflated = obstacles.map((rect) => inflate(rect, OBSTACLE_MARGIN))
  const candidates = candidateRoutes(start, end, inflated)
  let best = candidates[0]
  let bestScore = Infinity
  for (const middle of candidates) {
    const route = simplify([source, ...middle, target])
    const score = scoreRoute(route, inflated)
    if (score < bestScore) { best = middle; bestScore = score }
  }
  return best
}

function candidateRoutes(start: Point, end: Point, obstacles: readonly Rect[]): Point[][] {
  const midX = (start.x + end.x) / 2
  const midY = (start.y + end.y) / 2
  const routes: Point[][] = [
    [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end],
    [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end],
    [start, { x: start.x, y: end.y }, end],
    [start, { x: end.x, y: start.y }, end],
  ]
  // Lanes just outside the obstacles in the way: around the top, the bottom, the left or the right.
  const between = obstacles.filter((rect) => overlapsSpan(rect, start, end))
  if (between.length > 0) {
    const top = Math.min(...between.map((rect) => rect.y)) - OBSTACLE_MARGIN
    const bottom = Math.max(...between.map((rect) => rect.y + rect.height)) + OBSTACLE_MARGIN
    const left = Math.min(...between.map((rect) => rect.x)) - OBSTACLE_MARGIN
    const right = Math.max(...between.map((rect) => rect.x + rect.width)) + OBSTACLE_MARGIN
    for (const y of [top, bottom]) routes.push([start, { x: start.x, y }, { x: end.x, y }, end])
    for (const x of [left, right]) routes.push([start, { x, y: start.y }, { x, y: end.y }, end])
  }
  return routes
}

function scoreRoute(points: readonly Point[], obstacles: readonly Rect[]): number {
  let score = 0
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]
    const to = points[index]
    score += distance(from, to)
    for (const rect of obstacles) if (segmentCrossesRect(from, to, rect)) score += CROSSING_COST
  }
  return score + (points.length - 2) * BEND_COST
}

function overlapsSpan(rect: Rect, a: Point, b: Point): boolean {
  const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
  return rect.x < box.x + box.width && rect.x + rect.width > box.x && rect.y < box.y + box.height && rect.y + rect.height > box.y
}

/** Whether an axis-aligned segment passes through the inside of a rectangle. */
export function segmentCrossesRect(from: Point, to: Point, rect: Rect): boolean {
  const minX = Math.min(from.x, to.x)
  const maxX = Math.max(from.x, to.x)
  const minY = Math.min(from.y, to.y)
  const maxY = Math.max(from.y, to.y)
  return maxX > rect.x && minX < rect.x + rect.width && maxY > rect.y && minY < rect.y + rect.height
}

const inflate = (rect: Rect, by: number): Rect => ({ x: rect.x - by, y: rect.y - by, width: rect.width + by * 2, height: rect.height + by * 2 })
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)

/** Drops repeated points and points in the middle of a straight run. */
export function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = []
  for (const point of points) {
    const last = out[out.length - 1]
    if (last && last.x === point.x && last.y === point.y) continue
    const before = out[out.length - 2]
    if (before && last && collinear(before, last, point)) out.pop()
    out.push(point)
  }
  return out
}

const collinear = (a: Point, b: Point, c: Point) => (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)

// ---- drawing

function roundedPath(points: readonly Point[], radius: number): string {
  let path = `M ${points[0].x} ${points[0].y}`
  for (let index = 1; index < points.length - 1; index++) {
    const before = points[index - 1]
    const corner = points[index]
    const after = points[index + 1]
    const r = Math.min(radius, distance(before, corner) / 2, distance(corner, after) / 2)
    const into = towards(corner, before, r)
    const out = towards(corner, after, r)
    path += ` L ${into.x} ${into.y} Q ${corner.x} ${corner.y} ${out.x} ${out.y}`
  }
  const last = points[points.length - 1]
  return `${path} L ${last.x} ${last.y}`
}

function towards(from: Point, to: Point, length: number): Point {
  const total = distance(from, to)
  if (total === 0) return from
  return { x: from.x + ((to.x - from.x) / total) * length, y: from.y + ((to.y - from.y) / total) * length }
}

/** A smooth curve through every point (Catmull-Rom as cubic Béziers); two points make a gentle S. */
function smoothPath(points: readonly Point[]): string {
  if (points.length === 2) {
    const [a, b] = points
    const dx = Math.abs(b.x - a.x) / 2
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`
  }
  let path = `M ${points[0].x} ${points[0].y}`
  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[index - 1] ?? points[index]
    const p1 = points[index]
    const p2 = points[index + 1]
    const p3 = points[index + 2] ?? p2
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }
    path += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`
  }
  return path
}
