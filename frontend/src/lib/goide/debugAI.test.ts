import { describe, expect, it } from 'vitest'
import { debugAIDraft, debugSituation, type DebugEvidence } from './debugAI'

const base: DebugEvidence = {
  stopReason: 'breakpoint', frames: [{ name: 'main.find', location: 'api/api.go:20' }], locals: [{ name: 'id', value: '"7"', type: 'string' }],
  goroutines: null, console: [], logs: [], request: null, spans: [], changedSymbols: [], tests: [], related: [], runtime: [], history: [],
  previousSource: null, currentSource: null, panicValue: null,
}

describe('debug AI', () => {
  it('recognizes the situation from the stop and the evidence', () => {
    expect(debugSituation({ ...base, stopReason: 'panic', frames: [{ name: 'runtime.gopanic', location: '' }, ...base.frames] }).kind).toBe('panic')
    expect(debugSituation({ ...base, logs: ['query: context deadline exceeded'] }).kind).toBe('deadline')
    expect(debugSituation({ ...base, logs: ['pq: duplicate key value violates unique constraint'] }).kind).toBe('db')
    expect(debugSituation({ ...base, logs: ['rpc error: code = Unavailable desc = connection refused'] }).kind).toBe('grpc')
    expect(debugSituation({ ...base, logs: ['kafka: write to partition 3 failed: timeout'] }).kind).toBe('kafka')
    expect(debugSituation({ ...base, console: ['WARNING: DATA RACE'] }).kind).toBe('race')
    expect(debugSituation({ ...base, request: { method: 'GET', url: '/x', durationMs: 2400 } }).kind).toBe('slow')
    expect(debugSituation({ ...base, goroutines: { total: 3, byState: { 'chan receive': 3 }, blocked: ['#1', '#2', '#3'] } }).kind).toBe('deadlock')
    expect(debugSituation(base).kind).toBe('breakpoint')
  })

  it('builds a bounded, redacted draft with only the sections each action needs', () => {
    const evidence = { ...base, logs: ['token="sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"'], history: ['abc123 fix'], previousSource: '19  func find() {}', currentSource: '19  func find(id string) {}' }
    const cause = debugAIDraft(evidence, 'cause')
    expect(cause).toContain('Show the most likely cause')
    expect(cause).toContain('- main.find at api/api.go:20')
    expect(cause).toContain('- id (string) = "7"')
    expect(cause).not.toContain('Function in HEAD')
    expect(cause).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789')
    const compare = debugAIDraft(evidence, 'compare')
    expect(compare).toContain('Recent commits of this file:\n- abc123 fix')
    expect(compare).toContain('Function in HEAD:\n19  func find() {}')
    expect(compare).toContain('Function now:\n19  func find(id string) {}')
  })
})
