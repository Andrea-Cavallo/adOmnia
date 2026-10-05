import { describe, expect, it } from 'vitest'
import { traceTreeRows } from './traceTree'

describe('traceTreeRows', () => {
  it('orders children beneath parents even when logs arrive out of order', () => {
    const rows = traceTreeRows([
      { spanId: 'child', parentSpanId: 'root' },
      { spanId: 'other', parentSpanId: '' },
      { spanId: 'root', parentSpanId: '' },
      { spanId: 'grandchild', parentSpanId: 'child' },
    ])
    expect(rows.map(({ span, depth }) => [span.spanId, depth])).toEqual([
      ['other', 0], ['root', 0], ['child', 1], ['grandchild', 2],
    ])
  })

  it('keeps missing parents and cycles visible at the root', () => {
    const rows = traceTreeRows([
      { spanId: 'orphan', parentSpanId: 'missing' },
      { spanId: 'a', parentSpanId: 'b' },
      { spanId: 'b', parentSpanId: 'a' },
    ])
    expect(rows).toHaveLength(3)
    expect(rows.map(({ span }) => span.spanId).sort()).toEqual(['a', 'b', 'orphan'])
  })
})
