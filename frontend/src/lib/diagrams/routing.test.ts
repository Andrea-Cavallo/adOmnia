import { describe, expect, it } from 'vitest'
import { alignmentGuides } from './guides'
import { edgePoints, floatingAnchors, midpoint, pathOf, segmentCrossesRect, simplify, type Anchor } from './routing'

const left: Anchor = { x: 0, y: 100, side: 'right' }
const right: Anchor = { x: 400, y: 100, side: 'left' }

describe('connector routing', () => {
  it('draws straight and Bézier connectors through their waypoints', () => {
    expect(edgePoints('straight', left, right, [{ x: 200, y: 0 }])).toEqual([left, { x: 200, y: 0 }, right])
    expect(pathOf('straight', [left, right])).toBe('M 0 100 L 400 100')
    expect(pathOf('bezier', [left, { x: 200, y: 0 }, right])).toMatch(/^M 0 100 C .* C .* 400 100$/)
  })

  it('keeps orthogonal connectors horizontal and vertical, even through waypoints', () => {
    const points = edgePoints('orthogonal', left, { x: 400, y: 300, side: 'left' }, [{ x: 200, y: 180 }])
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1]
      const b = points[index]
      expect(a.x === b.x || a.y === b.y).toBe(true)
    }
    expect(pathOf('orthogonal', points)).toContain('Q')
  })

  it('routes around a node in the way', () => {
    const blocker = { x: 150, y: 50, width: 100, height: 100 }
    const points = edgePoints('orthogonal', left, right, [], [blocker])
    const crosses = points.slice(1).some((point, index) => segmentCrossesRect(points[index], point, blocker))
    expect(crosses).toBe(false)
    expect(points.length).toBeGreaterThan(2)
  })

  it('attaches handle-less connectors to the sides that face each other', () => {
    const a = { x: 0, y: 0, width: 100, height: 50 }
    expect(floatingAnchors(a, { x: 300, y: 10, width: 100, height: 50 })).toEqual([{ side: 'right', x: 100, y: 25 }, { side: 'left', x: 300, y: 35 }])
    expect(floatingAnchors(a, { x: 0, y: 300, width: 100, height: 50 })).toEqual([{ side: 'bottom', x: 50, y: 50 }, { side: 'top', x: 50, y: 300 }])
    expect(floatingAnchors(a, { x: -300, y: 0, width: 100, height: 50 })[0].side).toBe('left')
  })

  it('takes the direct route when nothing is in the way', () => {
    expect(edgePoints('orthogonal', left, right, [])).toEqual([left, right])
  })

  it('drops duplicate and collinear points and finds the middle of a path', () => {
    expect(simplify([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }])).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }])
    expect(midpoint([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toEqual({ x: 10, y: 0 })
  })
})

describe('alignment guides', () => {
  const other = { x: 100, y: 100, width: 100, height: 50 }

  it('snaps a nearby edge and center and reports the guide lines', () => {
    const result = alignmentGuides({ x: 104, y: 300, width: 80, height: 40 }, [other])
    expect(result.x).toBe(100)
    expect(result.guides).toEqual([{ orientation: 'vertical', position: 100, from: 100, to: 340 }])
    const centered = alignmentGuides({ x: 300, y: 103, width: 60, height: 40 }, [other])
    expect(centered.y).toBe(105)
    expect(centered.guides[0]).toMatchObject({ orientation: 'horizontal', position: 125 })
  })

  it('leaves a node alone when nothing is close', () => {
    expect(alignmentGuides({ x: 400, y: 400, width: 10, height: 10 }, [other])).toEqual({ x: 400, y: 400, guides: [] })
  })
})
