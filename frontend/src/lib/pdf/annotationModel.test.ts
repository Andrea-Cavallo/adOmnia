import { describe, it, expect } from 'vitest'
import {
  pointToScreen,
  screenToPoint,
  normalizeRect,
  hexToRgb01,
  createTextAnnotation,
  createShapeAnnotation,
} from './annotationModel'

describe('annotationModel coordinate helpers', () => {
  it('round-trips points through screen pixels at a given zoom', () => {
    const zoom = 1.5
    const px = pointToScreen(100, zoom)
    expect(px).toBe(150)
    expect(screenToPoint(px, zoom)).toBeCloseTo(100)
  })

  it('returns 0 points when zoom is 0 (guard against divide-by-zero)', () => {
    expect(screenToPoint(120, 0)).toBe(0)
  })

  it('normalizes a rect with negative width/height to a top-left origin', () => {
    const r = normalizeRect({ x: 100, y: 80, w: -40, h: -20 })
    expect(r).toEqual({ x: 60, y: 60, w: 40, h: 20 })
  })

  it('parses hex colors into 0..1 rgb', () => {
    expect(hexToRgb01('#ff0000')).toEqual({ r: 1, g: 0, b: 0 })
    expect(hexToRgb01('#000')).toEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('annotationModel factories', () => {
  it('creates a text annotation at the click point with defaults', () => {
    const a = createTextAnnotation(2, 30, 40)
    expect(a.type).toBe('text')
    expect(a.page).toBe(2)
    expect(a.x).toBe(30)
    expect(a.y).toBe(40)
    expect(a.text.length).toBeGreaterThan(0)
  })

  it('keeps signed geometry for lines but normalizes rectangles', () => {
    const line = createShapeAnnotation('line', 1, { x: 10, y: 10, w: -5, h: -5 })
    expect(line.w).toBe(-5)
    const rect = createShapeAnnotation('rect', 1, { x: 10, y: 10, w: -5, h: -5 })
    expect(rect.x).toBe(5)
    expect(rect.w).toBe(5)
  })
})
