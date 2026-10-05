import { describe, expect, it } from 'vitest'
import type { LiveSession } from '@/lib/devsession-api'
import { structuredLiveTraceEntries } from './liveTraceLogs'

describe('structuredLiveTraceEntries', () => {
  it('adds the owning service to structured trace logs from separate live sessions', () => {
    const sessions = {
      a: { service: 'api' } as LiveSession,
      b: { service: 'worker' } as LiveSession,
    }
    const logs = {
      a: [{ seq: 1, sessionId: 'a', at: '2026-01-01T00:00:00Z', stream: 'stdout', text: '{"trace_id":"t1","span_id":"s1","msg":"request"}' }],
      b: [{ seq: 2, sessionId: 'b', at: '2026-01-01T00:00:01Z', stream: 'stdout', text: '{"trace_id":"t1","span_id":"s2","parent_span_id":"s1"}' }],
    }
    expect(structuredLiveTraceEntries(logs, sessions).map((entry) => [entry.source, entry.data?.trace_id])).toEqual([['api', 't1'], ['worker', 't1']])
  })

  it('ignores plain text and malformed JSON', () => {
    const logs = { a: [
      { seq: 1, sessionId: 'a', at: '', stream: 'stdout', text: 'ready' },
      { seq: 2, sessionId: 'a', at: '', stream: 'stdout', text: '{broken' },
    ] }
    expect(structuredLiveTraceEntries(logs, {})).toEqual([])
  })

  it('accepts nested OpenTelemetry fields', () => {
    const logs = { a: [{ seq: 3, sessionId: 'a', at: '', stream: 'stdout', text: '{"otel":{"trace_id":"t2","span_id":"s2"}}' }] }
    expect(structuredLiveTraceEntries(logs, {}).map((entry) => entry.data?.otel)).toEqual([{ trace_id: 't2', span_id: 's2' }])
  })
})
