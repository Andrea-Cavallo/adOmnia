import { describe, expect, it } from 'vitest'
import { parseLogText } from './parse'
import { analyzeLog, operationalContext } from './analyze'

const REALISTIC_JSONL = [
  { timestamp: '2026-09-09T10:00:00.000Z', level: 'INFO', message: 'request started', correlation_id: 'APPP-11111111', request_id: 'req-1', service: { name: 'maul-transaction-ms', version: '0.2.18' }, environment: 'svil', k8s: { pod: { name: 'maul-1' }, namespace: { name: 'backend-euro-digitale' } }, attributes: { layer: 'handler', operation: 'GetDetails' }, http: { route: '/details', method: 'GET' } },
  { timestamp: '2026-09-09T10:00:00.020Z', level: 'INFO', message: 'calling wallet', correlation_id: 'APPP-11111111', service: { name: 'maul-transaction-ms' }, attributes: { layer: 'client', client: 'WalletEDIG', latency_ms: 10_004, error: 'context deadline exceeded' } },
  { timestamp: '2026-09-09T10:00:10.024Z', level: 'ERROR', message: 'downstream failed: context deadline exceeded', correlation_id: 'APPP-11111111', event: { outcome: 'failure' }, http: { status_code: 503 }, duration_ms: 10_024 },
  { timestamp: '2026-09-09T10:00:20.000Z', level: 'INFO', message: 'request started', correlation_id: 'APPP-22222222', service: { name: 'sidious-access-ms', version: '0.1.32' }, attributes: { layer: 'handler', operation: 'CreateAlias', dean: 'DEAN-CLEAR-123' }, http: { route: '/aliases', method: 'POST', request: { body: { phone: '+393331234567' } } } },
  { timestamp: '2026-09-09T10:00:20.180Z', level: 'INFO', message: 'alias created', correlation_id: 'APPP-22222222', event: { outcome: 'success' }, http: { status_code: 201 }, duration_ms: 180 },
].map((record) => JSON.stringify(record)).join('\n')

describe('enterprise structured-log analysis', () => {
  it('extracts Go slog/zap operational context from nested fields', () => {
    const event = parseLogText(REALISTIC_JSONL).events[0]
    expect(operationalContext(event)).toMatchObject({
      service: 'maul-transaction-ms',
      serviceVersion: '0.2.18',
      environment: 'svil',
      namespace: 'backend-euro-digitale',
      pod: 'maul-1',
      layer: 'handler',
      operation: 'GetDetails',
      httpMethod: 'GET',
      httpRoute: '/details',
    })
  })

  it('groups request chains and classifies downstream timeouts deterministically', () => {
    const analysis = analyzeLog(parseLogText(REALISTIC_JSONL).events)
    expect(analysis.requests).toHaveLength(2)
    expect(analysis.requests[0]).toMatchObject({
      correlationId: 'APPP-11111111',
      status: 'timeout',
      operation: 'GetDetails',
      downstreams: ['WalletEDIG'],
      httpStatus: 503,
      durationMs: 10_024,
    })
    expect(analysis.requests[1]).toMatchObject({ status: 'success', httpStatus: 201 })
    expect(analysis.anomalies.some((item) => item.kind === 'timeout' && item.action.includes('WalletEDIG'))).toBe(true)
  })

  it('flags clear enterprise identifiers and payload data', () => {
    const analysis = analyzeLog(parseLogText(REALISTIC_JSONL).events)
    expect(analysis.sensitiveFields.map((item) => item.path)).toEqual(expect.arrayContaining([
      'attributes.dean',
      'http.request.body.phone',
    ]))
  })

  it('understands status, method and environment stored under attributes', () => {
    const logs = [
      { timestamp: '2026-09-09T10:00:00Z', level: 'WARN', message: 'GetBalance: rifiutata', correlation_id: 'APPP-v', attributes: { operation: 'GetBalance', method: 'POST', url: '/balance', status: 400, environment: 'svil', error: 'dean obbligatorio' } },
      { timestamp: '2026-09-09T10:00:01Z', level: 'INFO', message: 'CreateAlias: completata', correlation_id: 'APPP-ok', attributes: { operation: 'CreateAlias', status: 'completed' } },
    ].map((record) => JSON.stringify(record)).join('\n')
    const analysis = analyzeLog(parseLogText(logs).events)
    expect(analysis.requests[0]).toMatchObject({ status: 'client-error', method: 'POST', endpoint: '/balance', httpStatus: 400 })
    expect(analysis.requests[1].status).toBe('success')
    expect(analysis.environments).toContain('svil')
  })

  it('exposes request and response bodies nested inside attributes', () => {
    const event = parseLogText(JSON.stringify({
      message: 'client call',
      attributes: {
        operation: 'GetBalance',
        request_body: { dean: 'masked' },
        response_body: { balance: 42 },
      },
    })).events[0]
    const context = operationalContext(event)
    expect(context.requestBody).toEqual({ dean: 'masked' })
    expect(context.responseBody).toEqual({ balance: 42 })
    expect(event.extra).toMatchObject({ attributes: { request_body: { dean: 'masked' }, response_body: { balance: 42 } } })
  })
})
