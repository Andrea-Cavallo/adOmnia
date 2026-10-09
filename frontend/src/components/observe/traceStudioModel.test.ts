import { describe, expect, it } from 'vitest'
import type { OtlpSpan } from '@/lib/otlp-api'
import { compareTraces, relativeToRoots, serviceColor, spanSource } from './traceStudioModel'

const span = (service: string, name: string, durationMs: number): OtlpSpan => ({
  traceId: 't', spanId: `${service}-${name}-${durationMs}`, name, kind: 'internal', service, startMs: 0, durationMs, statusCode: 'UNSET', category: 'internal',
})

describe('trace studio helpers', () => {
  it('reads code.* attributes in both naming styles', () => {
    expect(spanSource({ attributes: { 'code.filepath': '/src/a.go', 'code.lineno': '42', 'code.function': 'main.run' } })).toEqual({ file: '/src/a.go', line: 42, function: 'main.run' })
    expect(spanSource({ attributes: { 'code.file.path': 'C:\\svc\\b.go', 'code.line.number': '7' } })).toEqual({ file: 'C:\\svc\\b.go', line: 7 })
    expect(spanSource({ attributes: {} })).toBeNull()
  })

  it('maps absolute files into an open project', () => {
    const roots = [{ id: 's1', root: 'C:\\Users\\me\\svc' }, { id: 's2', root: '/home/me/api/' }]
    expect(relativeToRoots('c:/users/me/svc/store/orders.go', roots)).toEqual({ sessionId: 's1', relativePath: 'store/orders.go' })
    expect(relativeToRoots('/home/me/api/main.go', roots)).toEqual({ sessionId: 's2', relativePath: 'main.go' })
    expect(relativeToRoots('/home/me/apix/main.go', roots)).toBeNull()
  })

  it('gives each service a stable color', () => {
    expect(serviceColor('orders')).toBe(serviceColor('orders'))
    expect(serviceColor('orders')).toMatch(/^oklch\(/)
  })

  it('compares two traces step by step', () => {
    const before = [span('api', 'GET /orders', 120), span('api', 'SELECT', 80), span('api', 'SELECT', 10)]
    const after = [span('api', 'GET /orders', 40), span('api', 'SELECT', 5), span('cache', 'GET', 1)]
    expect(compareTraces(before, after).map((row) => [row.name, row.left, row.right, row.deltaMs])).toEqual([
      ['GET /orders', 120, 40, -80],
      ['SELECT', 80, 5, -75],
      ['SELECT', 10, undefined, undefined],
      ['GET', undefined, 1, undefined],
    ])
  })
})
