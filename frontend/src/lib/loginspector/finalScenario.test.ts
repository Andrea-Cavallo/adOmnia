import { describe, expect, it } from 'vitest'
import { analyzeLog, operationalContext } from './analyze'
import { correlateEvents } from './correlate'
import { buildEvidenceBundle, serializeEvidence } from './evidence'
import { parseLogSourcesInBackground } from './multiSource'
import { EMPTY_FILTERS } from './query'
import { requestDraftFromEvent } from './reproduce'
import { diffPayloads } from './requestDiff'
import { fromText } from './sources'
import { parseStackTrace } from './stackTrace'

const failed = 'corr-failed-42'
const success = 'corr-success-43'

describe('final Log Inspector acceptance journey', () => {
  it('investigates four services, compares bodies, reproduces the call and exports redacted evidence', async () => {
    const gateway = {
      ...fromText([
        JSON.stringify({ timestamp: '2026-09-15T10:00:00.000Z', level: 'INFO', service: { name: 'gateway', version: '1.0' }, correlation_id: failed, span_id: 'gw-f', message: 'request started', http: { method: 'POST', url: 'https://api.test/orders' }, attributes: { http: { request: { body: { orderId: 42, amount: 10 }, headers: { Authorization: 'Bearer top-secret-token' } } } } }),
        JSON.stringify({ timestamp: '2026-09-15T10:00:03.000Z', level: 'ERROR', service: { name: 'gateway', version: '1.0' }, correlation_id: failed, span_id: 'gw-f', message: 'request failed', http: { method: 'POST', route: '/orders', status_code: 500 }, attributes: { http: { response: { body: { error: 'currency required' } } } } }),
        JSON.stringify({ timestamp: '2026-09-15T10:01:00.000Z', level: 'INFO', service: { name: 'gateway', version: '2.0' }, correlation_id: success, span_id: 'gw-s', message: 'request started', http: { method: 'POST', url: 'https://api.test/orders' }, attributes: { http: { request: { body: { orderId: 43, amount: 10, currency: 'EUR' } } } } }),
        JSON.stringify({ timestamp: '2026-09-15T10:01:00.100Z', level: 'INFO', service: { name: 'gateway', version: '2.0' }, correlation_id: success, span_id: 'gw-s', message: 'request completed', duration_ms: 100, http: { method: 'POST', route: '/orders', status_code: 201 }, attributes: { http: { response: { body: { id: 43 } } } } }),
      ].join('\n'), 'gateway-go.jsonl', 'file'), sourceId: 'gateway',
    }
    const orders = {
      ...fromText([
        `2026-09-15T10:00:00.500Z stdout F ${JSON.stringify({ level: 'WARN', service: 'orders', correlation_id: failed, trace_id: 'trace-f', span_id: 'orders-f', parent_span_id: 'gw-f', message: 'retry attempt 1' })}`,
        `2026-09-15T10:00:01.000Z stdout F ${JSON.stringify({ level: 'WARN', service: 'orders', correlation_id: failed, trace_id: 'trace-f', span_id: 'orders-f', parent_span_id: 'gw-f', message: 'retry attempt 2' })}`,
        `2026-09-15T10:00:02.000Z stdout F ${JSON.stringify({ level: 'ERROR', service: 'orders', correlation_id: failed, trace_id: 'trace-f', span_id: 'orders-f', parent_span_id: 'gw-f', message: 'currency validation failed', stack: 'panic: validation failed\nadomnia/internal/orders.Validate()\n\t/home/ci/app/internal/orders/validate.go:57 +0x2d4' })}`,
      ].join('\n'), 'orders-mixed.log', 'file'), sourceId: 'orders',
    }
    const payments = {
      ...fromText(JSON.stringify({ timestamp: '2026-09-15T10:00:01.500Z', level: 'INFO', service: 'payments', correlation_id: failed, trace_id: 'trace-f', span_id: 'pay-f', parent_span_id: 'orders-f', message: 'payment not called: missing currency' }), 'payments.jsonl', 'file'), sourceId: 'payments',
    }
    const inventory = {
      ...fromText([
        `prefix ${JSON.stringify({ timestamp: '2026-09-15T10:00:02.500Z', level: 'INFO', service: 'inventory', correlation_id: failed, message: 'reservation pending' })}`,
        `prefix ${JSON.stringify({ timestamp: '2026-09-15T10:00:02.000Z', level: 'WARN', service: 'inventory', correlation_id: failed, message: 'log output truncated' })}`,
      ].join('\n'), 'inventory-mixed.log', 'file'), sourceId: 'inventory', clockOffsetMs: 500,
    }

    const parsed = await parseLogSourcesInBackground([gateway, orders, payments, inventory])
    expect(parsed.sourceCount).toBe(4)
    expect(new Set(parsed.events.map((event) => event.service))).toEqual(new Set(['gateway', 'orders', 'payments', 'inventory']))

    const chain = correlateEvents(parsed.events, 'correlationId', failed)
    expect(chain.events.length).toBe(8)
    expect(chain.events.every(({ event }) => Boolean(event.sourceName) && event.line > 0)).toBe(true)

    const analysis = analyzeLog(parsed.events)
    const failedRequest = analysis.requests.find((request) => request.correlationId === failed)!
    const successfulRequest = analysis.requests.find((request) => request.correlationId === success)!
    expect(failedRequest.status).toBe('server-error')
    expect(successfulRequest.status).toBe('success')
    expect(failedRequest.retryCount).toBe(2)
    expect(failedRequest.integrity.map((issue) => issue.kind)).toEqual(expect.arrayContaining(['clock-skew', 'corrected-time', 'truncated-log', 'uncertain-correlation']))

    const failedBody = operationalContext(parsed.events.find((event) => event.correlationId === failed && operationalContext(event).requestBody !== null)!).requestBody
    const successBody = operationalContext(parsed.events.find((event) => event.correlationId === success && operationalContext(event).requestBody !== null)!).requestBody
    expect(diffPayloads(failedBody, successBody)).toContainEqual({ path: '$.currency', kind: 'missing-left', left: undefined, right: 'EUR' })

    const root = parsed.events.find((event) => event.correlationId === failed && operationalContext(event).requestBody !== null)!
    const draft = requestDraftFromEvent(parsed.events, root)
    expect(draft.request).toMatchObject({ method: 'POST', url: 'https://api.test/orders' })
    expect(draft.request.bodies[0].raw).toContain('"amount": 10')

    const stackEvent = parsed.events.find((event) => event.stack.includes('validate.go'))!
    expect(parseStackTrace(stackEvent.stack).sections[0].frames[0]).toMatchObject({ line: 57, origin: 'application' })

    const evidence = serializeEvidence(buildEvidenceBundle(chain.events.map(({ event }) => event), { filters: EMPTY_FILTERS, notes: 'currency differs', hiddenFields: [] }))
    expect(evidence).toContain('gateway-go.jsonl')
    expect(evidence).not.toContain('top-secret-token')
    expect(evidence).toContain('[redacted]')
  })
})
