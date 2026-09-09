import { describe, expect, it } from 'vitest'
import { parseLogText } from './parse'
import { EMPTY_FILTERS, compileQuery, filterEvents, highlightSegments } from './query'
import { correlateEvents, correlationCandidates, sortChronologically } from './correlate'
import { hideJsonFields, maskEvents, maskText } from './mask'
import { buildHistogram, computeFacet, countByLevel } from './stats'
import { exportEvents } from './exporters'
import { LOG_SAMPLES } from './samples'
import type { LogEvent } from './types'

const BATCH = [
  '{"time":"2026-03-11T09:14:01.902Z","level":"info","service":"api-gateway","pod":"gateway-1","correlationId":"c8f1","msg":"POST /v2/settlements accepted"}',
  '{"time":"2026-03-11T09:14:01.944Z","level":"debug","service":"payments-api","pod":"pay-1","correlationId":"c8f1","traceId":"4bf9","msg":"Loading merchant profile"}',
  '{"time":"2026-03-11T09:14:02.310Z","level":"warn","service":"payments-api","pod":"pay-2","correlationId":"c8f1","traceId":"4bf9","msg":"Clearing house latency above threshold"}',
  '{"time":"2026-03-11T09:14:02.481Z","level":"error","service":"payments-api","pod":"pay-1","correlationId":"c8f1","traceId":"4bf9","msg":"Settlement rejected"}',
  '{"time":"2026-03-11T09:14:09.000Z","level":"info","service":"ledger","pod":"ledger-1","correlationId":"zzzz","msg":"Batch closed"}',
].join('\n')

function events(): LogEvent[] {
  return parseLogText(BATCH).events
}

function withFilters(overrides: Partial<typeof EMPTY_FILTERS>) {
  return { ...EMPTY_FILTERS, ...overrides }
}

describe('query language', () => {
  it('filters by level', () => {
    const result = filterEvents(events(), withFilters({ query: 'level:error' }))
    expect(result.map((e) => e.message)).toEqual(['Settlement rejected'])
  })

  it('filters by service', () => {
    const result = filterEvents(events(), withFilters({ query: 'service:payments-api' }))
    expect(result).toHaveLength(3)
  })

  it('supports wildcards', () => {
    const result = filterEvents(events(), withFilters({ query: 'pod:pay-*' }))
    expect(result.map((e) => e.pod)).toEqual(['pay-1', 'pay-2', 'pay-1'])
  })

  it('supports the existence form field:*', () => {
    const result = filterEvents(events(), withFilters({ query: 'traceId:*' }))
    expect(result).toHaveLength(3)
  })

  it('filters by correlation id', () => {
    expect(filterEvents(events(), withFilters({ query: 'correlationId:c8f1' }))).toHaveLength(4)
  })

  it('combines clauses with AND', () => {
    const result = filterEvents(events(), withFilters({ query: 'service:payments-api level:warn' }))
    expect(result.map((e) => e.message)).toEqual(['Clearing house latency above threshold'])
  })

  it('excludes with a leading minus', () => {
    const result = filterEvents(events(), withFilters({ query: '-service:payments-api' }))
    expect(result.map((e) => e.service)).toEqual(['api-gateway', 'ledger'])
  })

  it('does a full-text match on bare terms', () => {
    expect(filterEvents(events(), withFilters({ query: 'merchant' }))).toHaveLength(1)
  })

  it('keeps quoted phrases together', () => {
    const compiled = compileQuery('"latency above threshold" level:warn')
    expect(compiled.clauses[0].value).toBe('latency above threshold')
    expect(filterEvents(events(), withFilters({ query: '"latency above threshold"' }))).toHaveLength(1)
  })

  it('resolves a field the model does not carry against the payload', () => {
    const parsed = parseLogText('{"msg":"charge","merchantId":"M-4471"}\n{"msg":"charge","merchantId":"M-9000"}').events
    expect(filterEvents(parsed, withFilters({ query: 'merchantId:M-4471' })).map((e) => e.message)).toEqual(['charge'])
    expect(filterEvents(parsed, withFilters({ query: 'merchantId:M-4471' }))).toHaveLength(1)
  })

  it('matches payload fields whatever their casing or separators', () => {
    const parsed = parseLogText('{"msg":"a","X-Idempotency-Key":"idem-77"}').events
    expect(filterEvents(parsed, withFilters({ query: 'x_idempotency_key:idem-77' }))).toHaveLength(1)
    expect(filterEvents(parsed, withFilters({ query: 'XIdempotencyKey:idem-77' }))).toHaveLength(1)
    // It is also promoted to requestId, so the modelled field finds it too.
    expect(filterEvents(parsed, withFilters({ query: 'requestId:idem-77' }))).toHaveLength(1)
  })

  it('finds values inside a nested payload object', () => {
    const parsed = parseLogText('{"msg":"a","http":{"status":502}}\n{"msg":"b","http":{"status":200}}').events
    expect(filterEvents(parsed, withFilters({ query: 'http.status:502' })).map((e) => e.message)).toEqual(['a'])
  })

  it('keeps a pasted URL as a full-text term', () => {
    const parsed = parseLogText('{"msg":"calling https://clearing.internal/v1/submit"}').events
    expect(filterEvents(parsed, withFilters({ query: 'https://clearing.internal' }))).toHaveLength(1)
  })
})

describe('fast-search operators', () => {
  it('accepts a regular expression as a bare term', () => {
    expect(filterEvents(events(), withFilters({ query: '/Settlement rejec\\w+/' }))).toHaveLength(1)
  })

  it('accepts a regular expression as a field value', () => {
    const result = filterEvents(events(), withFilters({ query: 'pod:/^pay-\\d$/' }))
    expect(result.map((e) => e.pod)).toEqual(['pay-1', 'pay-2', 'pay-1'])
  })

  it('falls back to literal text when the regex is invalid', () => {
    expect(() => compileQuery('/[unclosed/')).not.toThrow()
    expect(filterEvents(events(), withFilters({ query: '/[unclosed/' }))).toHaveLength(0)
  })

  it('supports alternatives on a field', () => {
    const result = filterEvents(events(), withFilters({ query: 'level:warn|error' }))
    expect(result.map((e) => e.level)).toEqual(['warn', 'error'])
  })

  it('supports alternatives on a bare term', () => {
    expect(filterEvents(events(), withFilters({ query: 'merchant|threshold' }))).toHaveLength(2)
  })

  it('highlights every alternative but not the regex source', () => {
    expect(compileQuery('warn|error').highlights).toEqual(['warn', 'error'])
    expect(compileQuery('/^pay/').highlights).toEqual([])
  })
})

describe('structured filters', () => {
  it('combines query, levels, facets and exclusions', () => {
    const result = filterEvents(events(), withFilters({
      query: 'correlationId:c8f1',
      levels: ['warn', 'error'],
      include: { service: ['payments-api'] },
      exclude: { pod: ['pay-2'] },
    }))
    expect(result.map((e) => e.message)).toEqual(['Settlement rejected'])
  })

  it('filters by time range', () => {
    const from = Date.parse('2026-03-11T09:14:02.000Z')
    const result = filterEvents(events(), withFilters({ from, to: null }))
    expect(result).toHaveLength(3)
  })

  it('keeps only events with a stack trace', () => {
    const parsed = parseLogText(LOG_SAMPLES.find((s) => s.id === 'java-stack')!.text).events
    const result = filterEvents(parsed, withFilters({ onlyStack: true }))
    expect(result).toHaveLength(1)
  })

  it('keeps only unparsable rows', () => {
    const parsed = parseLogText('{"msg":"ok"}\n{"msg":"broken"').events
    const result = filterEvents(parsed, withFilters({ onlyUnparsed: true }))
    expect(result).toHaveLength(1)
    expect(result[0].parseError).not.toBe('')
  })

  it('returns the input untouched when nothing is filtered', () => {
    const all = events()
    expect(filterEvents(all, EMPTY_FILTERS)).toBe(all)
  })

  it('stays responsive on 100k events', () => {
    const many = parseLogText(
      Array.from({ length: 100_000 }, (_, i) => `{"level":"${i % 1000 === 0 ? 'error' : 'info'}","service":"svc-${i % 7}","msg":"m${i}"}`).join('\n'),
    ).events
    const started = performance.now()
    const result = filterEvents(many, withFilters({ query: 'level:error service:svc-0' }))
    expect(result.length).toBeGreaterThan(0)
    expect(performance.now() - started).toBeLessThan(2000)
  })
})

describe('highlighting', () => {
  it('splits the text around matches', () => {
    const segments = highlightSegments('Settlement rejected', ['reject'])
    expect(segments.map((s) => s.hit)).toEqual([false, true, false])
    expect(segments.map((s) => s.text).join('')).toBe('Settlement rejected')
  })

  it('ignores terms shorter than two characters', () => {
    expect(highlightSegments('abc', ['a'])).toEqual([{ text: 'abc', hit: false }])
  })
})

describe('correlation', () => {
  it('rebuilds a request chronologically with deltas', () => {
    const result = correlateEvents(events(), 'correlationId', 'c8f1')
    expect(result.events).toHaveLength(4)
    expect(result.events[0].deltaMs).toBeNull()
    expect(result.events[1].deltaMs).toBe(42)
    expect(result.spanMs).toBe(579)
    expect(result.errorCount).toBe(1)
    expect(result.services).toEqual(['api-gateway', 'payments-api'])
  })

  it('correlates by trace id', () => {
    expect(correlateEvents(events(), 'traceId', '4bf9').events).toHaveLength(3)
  })

  it('lists the correlation ids available on an event', () => {
    const candidates = correlationCandidates(events()[3])
    expect(candidates.map((c) => c.key)).toEqual(['correlationId', 'traceId'])
  })

  it('sorts descending on request', () => {
    const sorted = sortChronologically(events(), 'desc')
    expect(sorted[0].message).toBe('Batch closed')
  })

  it('sorts ascending even when source lines arrive out of order', () => {
    const reversed = [...events()].reverse()
    expect(sortChronologically(reversed, 'asc')[0].message).toBe('POST /v2/settlements accepted')
  })
})

describe('sensitive data masking', () => {
  it('redacts bearer tokens in free text', () => {
    expect(maskText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def')).toContain('[redacted]')
    expect(maskText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def')).not.toContain('eyJhbGci')
  })

  it('redacts sensitive JSON fields at any depth', () => {
    const parsed = parseLogText('{"msg":"login","user":{"name":"ana","password":"hunter2"},"api_key":"k-123"}').events
    const masked = maskEvents(parsed)
    const json = masked[0].json as { user: { name: string; password: string }; api_key: string }
    expect(json.user.password).toBe('[redacted]')
    expect(json.api_key).toBe('[redacted]')
    expect(json.user.name).toBe('ana')
  })

  it('leaves the original events untouched', () => {
    const parsed = parseLogText('{"msg":"x","token":"abc"}').events
    maskEvents(parsed)
    expect((parsed[0].json as { token: string }).token).toBe('abc')
  })

  it('accepts extra configurable field names', () => {
    const parsed = parseLogText('{"msg":"x","iban":"IT60X0542811101000000123456"}').events
    const masked = maskEvents(parsed, ['iban'])
    expect((masked[0].json as { iban: string }).iban).toBe('[redacted]')
  })

  it('redacts enterprise identifiers and contact data by default', () => {
    const parsed = parseLogText('{"msg":"x","attributes":{"dean":"DEAN-123"},"http":{"request":{"body":{"iban":"IT60X0542811101000000123456","phone":"+393331234567"}}}}').events
    const json = maskEvents(parsed)[0].json as { attributes: { dean: string }; http: { request: { body: { iban: string; phone: string } } } }
    expect(json.attributes.dean).toBe('[redacted]')
    expect(json.http.request.body.iban).toBe('[redacted]')
    expect(json.http.request.body.phone).toBe('[redacted]')
  })

  it('hides configured noisy fields recursively without mutating the source', () => {
    const source = { message: 'ok', labels: { noisy: true }, nested: { labels: 'drop', keep: 1 } }
    expect(hideJsonFields(source, ['labels'])).toEqual({ message: 'ok', nested: { keep: 1 } })
    expect(source.labels).toEqual({ noisy: true })
  })
})

describe('stats', () => {
  it('counts events by level', () => {
    const counts = countByLevel(events())
    expect(counts.info).toBe(2)
    expect(counts.error).toBe(1)
  })

  it('computes facets ordered by frequency', () => {
    expect(computeFacet(events(), 'service')[0]).toEqual({ value: 'payments-api', count: 3 })
  })

  it('builds a histogram covering the whole range', () => {
    const buckets = buildHistogram(events(), 10)
    expect(buckets).toHaveLength(10)
    expect(buckets.reduce((sum, b) => sum + b.total, 0)).toBe(5)
    expect(buckets.some((b) => b.errors > 0)).toBe(true)
  })
})

describe('export', () => {
  it('exports JSONL one event per line', () => {
    const text = exportEvents(events().slice(0, 2), 'jsonl')
    expect(text.split('\n')).toHaveLength(2)
    expect(JSON.parse(text.split('\n')[0]).message).toBe('POST /v2/settlements accepted')
    expect(JSON.parse(text.split('\n')[0]).json.correlationId).toBe('c8f1')
  })

  it('exports readable text with the stack trace', () => {
    const parsed = parseLogText(LOG_SAMPLES.find((s) => s.id === 'java-stack')!.text).events
    expect(exportEvents(parsed, 'text')).toContain('Caused by: java.net.SocketTimeoutException')
  })

  it('exports valid JSON', () => {
    expect(JSON.parse(exportEvents(events(), 'json'))).toHaveLength(5)
  })
})
