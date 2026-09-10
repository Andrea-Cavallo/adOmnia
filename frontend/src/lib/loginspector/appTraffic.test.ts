import { describe, expect, it } from 'vitest'
import { browserTrafficRecords, composerTrafficRecords, correlationIdsFromHeaders, eventsForTraffic, trafficForEvent } from './appTraffic'
import { parseLogText } from './parse'

describe('correlationIdsFromHeaders', () => {
  it('reads correlation, request and trace headers in any spelling', () => {
    const found = correlationIdsFromHeaders({
      'X-Correlation-ID': 'corr-1',
      'x_request_id': 'req-1',
      'X-B3-TraceId': 'trace-1',
      'Content-Type': 'application/json',
    })
    expect(found.map((item) => [item.key, item.value])).toEqual([
      ['correlationId', 'corr-1'],
      ['requestId', 'req-1'],
      ['traceId', 'trace-1'],
    ])
  })

  it('extracts the trace id out of traceparent and X-Amzn-Trace-Id', () => {
    expect(correlationIdsFromHeaders({ traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' }))
      .toEqual([{ key: 'traceId', header: 'traceparent', value: '4bf92f3577b34da6a3ce929d0e0e4736' }])
    expect(correlationIdsFromHeaders({ 'X-Amzn-Trace-Id': 'Root=1-5759e9f7-abc;Parent=x' })[0].value).toBe('1-5759e9f7-abc')
  })

  it('ignores a malformed traceparent instead of inventing an id', () => {
    expect(correlationIdsFromHeaders({ traceparent: 'garbage' })).toEqual([])
  })
})

describe('traffic matching', () => {
  const events = parseLogText(JSON.stringify({ message: 'handled', correlation_id: 'corr-1', service: 'orders' })).events
  const browser = browserTrafficRecords([
    { id: 'b1', url: 'https://app.test/checkout', method: 'POST', status: 500, requestHeaders: { 'X-Correlation-ID': 'corr-1' }, timestamp: 10 },
    { id: 'b2', url: 'https://app.test/home', method: 'GET', status: 200, requestHeaders: {}, timestamp: 11 },
  ])

  it('keeps only calls carrying a correlation header', () => {
    expect(browser.map((record) => record.id)).toEqual(['browser-b1'])
  })

  it('links a log event to the call that produced it, and back', () => {
    expect(trafficForEvent(browser, events[0]).map((record) => record.url)).toEqual(['https://app.test/checkout'])
    expect(eventsForTraffic(events, browser[0]).map((event) => event.service)).toEqual(['orders'])
  })

  it('reads composer history headers too', () => {
    const composer = composerTrafficRecords([{
      id: 'h1',
      recordedAt: '2026-09-10T07:00:00Z',
      request: { method: 'GET', url: 'https://api.test/orders', headers: [{ key: 'X-Correlation-Id', value: 'corr-1', enabled: true }] },
      response: { status: 200, headers: {} },
    }])
    expect(trafficForEvent(composer, events[0])).toHaveLength(1)
  })
})
