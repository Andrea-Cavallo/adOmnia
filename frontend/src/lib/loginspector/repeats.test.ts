import { describe, expect, it } from 'vitest'
import { parseLogText } from './parse'
import { groupRepeated } from './repeats'

const LINES = [
  '{"level":"info","msg":"GET /orders/17 200 in 12ms","service":"api"}',
  '{"level":"info","msg":"GET /orders/93 200 in 8ms","service":"api"}',
  '{"level":"warn","msg":"retrying payment 4f2c1a9e-1d2b-4c3d-9e8f-0a1b2c3d4e5f","service":"api"}',
  '{"level":"info","msg":"GET /orders/5 200 in 30ms","service":"api"}',
  '{"level":"warn","msg":"retrying payment 7a2c1a9e-1d2b-4c3d-9e8f-0a1b2c3d4e5f","service":"api"}',
  '{"level":"error","msg":"GET /orders/5 200 in 30ms","service":"api"}',
  '{"level":"info","msg":"GET /orders/5 200 in 30ms","service":"billing"}',
].join('\n')

describe('groupRepeated', () => {
  it('keeps one event per template in first-seen order with counts', () => {
    const { events } = parseLogText(LINES)
    const groups = groupRepeated(events)
    expect(groups.events.map((e) => `${e.level}:${e.message}`)).toEqual([
      'info:GET /orders/17 200 in 12ms',
      'warn:retrying payment 4f2c1a9e-1d2b-4c3d-9e8f-0a1b2c3d4e5f',
      'error:GET /orders/5 200 in 30ms', // same text, other level: separate
      'info:GET /orders/5 200 in 30ms', // same text, other service: separate
    ])
    expect(groups.counts.get(groups.events[0].id)).toBe(3)
    expect(groups.counts.get(groups.events[1].id)).toBe(2)
    expect(groups.counts.has(groups.events[2].id)).toBe(false)
  })
})
