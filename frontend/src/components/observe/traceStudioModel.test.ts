import { describe, expect, it } from 'vitest'
import type { OtlpSpan } from '@/lib/otlp-api'
import { compareTraces, relativeToRoots, serviceColor, spanInsights, spanSource } from './traceStudioModel'

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

describe('span insights', () => {
  const s = (spanId: string, parentSpanId: string, service: string, kind: string, startMs: number, durationMs: number, statusCode = 'UNSET'): OtlpSpan =>
    ({ traceId: 't', spanId, parentSpanId, name: spanId, kind, service, startMs, durationMs, statusCode, category: 'internal' })
  const spans = [
    s('root', '', 'gw', 'server', 0, 100, 'ERROR'),
    s('call', 'root', 'gw', 'client', 5, 60, 'ERROR'),
    s('srv', 'call', 'orders', 'server', 10, 50, 'ERROR'),
    s('db1', 'srv', 'orders', 'client', 12, 20, 'ERROR'),
    s('db2', 'srv', 'orders', 'client', 15, 10),
    s('pub', 'srv', 'orders', 'producer', 40, 2),
    s('con', 'pub', 'billing', 'consumer', 50, 80),
  ]
  const insights = spanInsights(spans)
  it('measures network and broker delay', () => {
    expect(insights.get('call')?.networkMs).toBe(10)
    expect(insights.get('con')?.brokerDelayMs).toBe(8)
  })
  it('finds where the error starts, parallel and async work', () => {
    expect([...insights].filter(([, i]) => i.errorOrigin).map(([id]) => id)).toEqual(['db1'])
    expect(insights.get('db1')?.parallel && insights.get('db2')?.parallel).toBe(true)
    expect(insights.get('con')?.async).toBe(true)
    expect(insights.get('pub')?.async).toBeFalsy()
  })
  it('numbers retries of the same call', () => {
    const again = spanInsights([s('p', '', 'gw', 'server', 0, 100), s('c2', 'p', 'gw', 'client', 30, 5), s('c1', 'p', 'gw', 'client', 10, 5), s('c3', 'p', 'gw', 'client', 50, 5)].map((span) => ({ ...span, name: span.spanId === 'p' ? 'GET /x' : 'GET' })))
    expect([again.get('c1')?.retry, again.get('c2')?.retry, again.get('c3')?.retry]).toEqual([undefined, 1, 2])
  })
})
