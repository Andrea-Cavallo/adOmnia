import { describe, expect, it } from 'vitest'
import { detectFormat, stripAnsi } from './detect'
import { parseLogText, parseLogTextChunked } from './parse'
import { LOG_SAMPLES } from './samples'
import { loadFromFile, looksBinary } from './sources'

const ESC = String.fromCharCode(27)

describe('format detection', () => {
  it('recognizes a single JSON object', () => {
    expect(detectFormat('{"level":"info","msg":"hi"}')).toBe('json')
  })

  it('recognizes a JSON array', () => {
    expect(detectFormat('[{"level":"info"},{"level":"warn"}]')).toBe('json-array')
  })

  it('recognizes JSON Lines', () => {
    expect(detectFormat('{"a":1}\n{"a":2}\n{"a":3}')).toBe('jsonl')
  })

  it('recognizes prefixed / mixed logs', () => {
    expect(detectFormat('2026-03-11T09:00:00Z stdout F {"a":1}\nplain line')).toBe('mixed')
  })

  it('recognizes plain text', () => {
    expect(detectFormat('nothing structured here\nsecond line')).toBe('text')
  })

  it('treats blank input as empty', () => {
    expect(detectFormat('   \n  ')).toBe('empty')
  })
})

describe('JSON inputs', () => {
  it('parses a single object and promotes aliased fields', () => {
    const { events, summary } = parseLogText(
      '{"@timestamp":"2026-03-11T09:14:02.481Z","severity":"WARNING","application":"payments","podName":"pay-1","msg":"slow"}',
    )
    expect(summary.valid).toBe(1)
    expect(events[0].level).toBe('warn')
    expect(events[0].service).toBe('payments')
    expect(events[0].pod).toBe('pay-1')
    expect(events[0].message).toBe('slow')
    expect(events[0].ts).toBe(Date.parse('2026-03-11T09:14:02.481Z'))
  })

  it('parses an array of objects into separate events', () => {
    const { events } = parseLogText('[{"level":"info","msg":"a"},{"level":"error","msg":"b"}]')
    expect(events.map((e) => e.message)).toEqual(['a', 'b'])
    expect(events[1].level).toBe('error')
  })

  it('parses JSON Lines and keeps the source line number', () => {
    const { events, summary } = parseLogText('{"msg":"a"}\n{"msg":"b"}\n{"msg":"c"}')
    expect(events).toHaveLength(3)
    expect(events[2].line).toBe(3)
    expect(summary.format).toBe('jsonl')
  })

  it('keeps unrecognized keys in extra and the original payload in json', () => {
    const { events } = parseLogText('{"msg":"x","merchantId":"M-1","http":{"status":502}}')
    expect(events[0].extra).toEqual({ merchantId: 'M-1', http: { status: 502 } })
    expect(events[0].json).toEqual({ msg: 'x', merchantId: 'M-1', http: { status: 502 } })
  })
})

describe('malformed input', () => {
  it('flags a broken line without dropping the others', () => {
    const { events, summary } = parseLogText('{"msg":"ok"}\n{"msg":"broken"\n{"msg":"after"}')
    expect(events).toHaveLength(3)
    expect(events[0].parseError).toBe('')
    expect(events[1].parseError).not.toBe('')
    expect(events[2].message).toBe('after')
    expect(summary.invalid).toBe(1)
    expect(summary.valid).toBe(2)
  })

  it('never reports an unparsable line as an application error level', () => {
    const { events } = parseLogText('{"msg":"broken"')
    expect(events[0].level).toBe('unknown')
    expect(events[0].levelRaw).toBe('unparsed')
  })
})

describe('stack traces', () => {
  it('attaches a Java stack trace to the event above it', () => {
    const { events } = parseLogText(LOG_SAMPLES.find((s) => s.id === 'java-stack')!.text)
    const failure = events.find((e) => e.stack)
    expect(failure).toBeDefined()
    expect(failure!.stack).toContain('at com.acme.payments.clearing.ClearingClient.submit')
    expect(failure!.stack).toContain('Caused by: java.net.SocketTimeoutException')
    expect(failure!.stack).toContain('... 14 more')
    // The line that follows the trace must start a new event.
    expect(events[events.length - 1].message).toContain('Returning 502 to caller')
  })

  it('aggregates a Go panic including its blank line and goroutine dump', () => {
    const { events } = parseLogText(LOG_SAMPLES.find((s) => s.id === 'go-panic')!.text)
    const panic = events.find((e) => e.message.startsWith('panic:'))
    expect(panic).toBeDefined()
    expect(panic!.level).toBe('fatal')
    expect(panic!.stack).toContain('goroutine 42 [running]:')
    expect(panic!.stack).toContain('/src/cmd/worker/main.go:57 +0x2d4')
    expect(panic!.stack).toContain('exit status 2')
    expect(events[events.length - 1].message).toContain('restarting ledger-worker')
  })
})

describe('OpenShift mixed logs', () => {
  const sample = LOG_SAMPLES.find((s) => s.id === 'openshift')!.text

  it('strips the CRI prefix and parses the JSON payload', () => {
    const { events } = parseLogText(sample)
    const debug = events.find((e) => e.message === 'Loading merchant profile')!
    expect(debug.level).toBe('debug')
    expect(debug.pod).toBe('payments-api-7d9f5c8b46-x2kzq')
    expect(debug.namespace).toBe('prod-payments')
    expect(debug.container).toBe('payments-api')
    expect(debug.correlationId).toBe('c8f1e2a4')
  })

  it('keeps the plain banner lines as text events', () => {
    const { events } = parseLogText(sample)
    expect(events[0].message).toContain('Starting Acme Payments API')
    expect(events[0].json).toBeNull()
  })

  it('attaches Java frames that carry their own CRI prefix to the error event', () => {
    const { events } = parseLogText(sample)
    const failure = events.find((e) => e.message.startsWith('Settlement rejected'))!
    expect(failure.level).toBe('error')
    expect(failure.stack).toContain('java.lang.IllegalStateException')
    expect(failure.stack).toContain('ClearingClient.submit(ClearingClient.java:118)')
    expect(failure.lineCount).toBe(4)
  })

  it('flags the truncated JSON line and still parses the line after it', () => {
    const { events, summary } = parseLogText(sample)
    expect(summary.invalid).toBe(1)
    expect(events[events.length - 1].message).toBe('Shutdown hook registered')
  })
})

describe('ANSI escape codes', () => {
  it('removes colour codes from the value', () => {
    expect(stripAnsi(`${ESC}[32mINFO${ESC}[0m ready`)).toBe('INFO ready')
  })

  it('parses a coloured line as a normal event', () => {
    const { events } = parseLogText(`${ESC}[31mERROR${ESC}[0m boom`)
    expect(events[0].level).toBe('error')
    expect(events[0].raw).not.toContain(ESC)
  })
})

describe('timestamps', () => {
  const cases: [string, string][] = [
    ['ISO with nanoseconds', '2026-03-11T09:14:02.481774331Z'],
    ['ISO with offset', '2026-03-11T10:14:02.481+01:00'],
    ['Java space separated', '2026-03-11 09:14:02,481'],
    ['epoch seconds', '1773220442'],
    ['epoch milliseconds', '1773220442481'],
    ['CLF', '11/Mar/2026:09:14:02 +0000'],
  ]

  for (const [label, value] of cases) {
    it(`understands ${label}`, () => {
      const { events } = parseLogText(JSON.stringify({ timestamp: value, msg: 'x' }))
      expect(events[0].ts, label).not.toBeNull()
    })
  }

  it('extracts a leading timestamp out of a plain text line', () => {
    const { events } = parseLogText('2026-03-11 09:14:02.481 INFO started')
    expect(events[0].ts).not.toBeNull()
    expect(events[0].message).toBe('INFO started')
  })

  it('warns but keeps events without any timestamp', () => {
    const { events, summary } = parseLogText('{"msg":"no clock here"}')
    expect(events[0].ts).toBeNull()
    expect(summary.warningCount).toBe(1)
  })
})

describe('field aliases', () => {
  it('matches an alias whatever its casing and separators', () => {
    const line = JSON.stringify({
      Timestamp: '2026-03-11T09:14:02.481Z',
      SEVERITY: 'ERROR',
      Msg: 'boom',
      'SERVICE-NAME': 'payments',
    })
    const { events } = parseLogText(line)
    expect(events[0].level).toBe('error')
    expect(events[0].message).toBe('boom')
    expect(events[0].service).toBe('payments')
    expect(events[0].ts).not.toBeNull()
  })

  it('promotes header-style correlation identifiers', () => {
    const line = JSON.stringify({
      msg: 'charge',
      'X-Correlation-Id': 'corr-1',
      'X-Request-Id': 'req-1',
      'X-B3-TraceId': 'trace-1',
    })
    const { events } = parseLogText(line)
    expect(events[0].correlationId).toBe('corr-1')
    expect(events[0].requestId).toBe('req-1')
    expect(events[0].traceId).toBe('trace-1')
  })

  it('treats an idempotency key as the request identifier', () => {
    const { events } = parseLogText(JSON.stringify({ msg: 'retry', 'X-Idempotency-Key': 'idem-77' }))
    expect(events[0].requestId).toBe('idem-77')
  })

  it('reads ECS and OpenTelemetry dotted fields', () => {
    const line = JSON.stringify({
      '@timestamp': '2026-03-11T09:14:02.481Z',
      log: { level: 'warn', logger: 'com.acme.Clearing' },
      service: { name: 'payments-api' },
      trace: { id: 'abc123' },
    })
    const { events } = parseLogText(line)
    expect(events[0].level).toBe('warn')
    expect(events[0].service).toBe('payments-api')
    expect(events[0].traceId).toBe('abc123')
    expect(events[0].logger).toBe('com.acme.Clearing')
  })

  it('reads OpenShift project and node aliases', () => {
    const line = JSON.stringify({ msg: 'x', project: 'prod-payments', nodeName: 'worker-3' })
    const { events } = parseLogText(line)
    expect(events[0].namespace).toBe('prod-payments')
    expect(events[0].pod).toBe('worker-3')
  })

  it('reads Serilog compact fields', () => {
    const { events } = parseLogText(JSON.stringify({ '@t': '2026-03-11T09:14:02.481Z', '@l': 'Error', '@m': 'failed' }))
    expect(events[0].level).toBe('error')
    expect(events[0].message).toBe('failed')
    expect(events[0].ts).not.toBeNull()
  })
})

describe('nested JSON in string fields', () => {
  it('decodes an escaped JSON message and lifts its inner message', () => {
    const line = JSON.stringify({ level: 'info', message: JSON.stringify({ event: 'upstream.request', message: 'calling clearing house' }) })
    const { events } = parseLogText(line)
    expect(events[0].decoded.message).toMatchObject({ event: 'upstream.request' })
    expect(events[0].message).toBe('calling clearing house')
  })

  it('decodes body / payload / response fields', () => {
    const line = JSON.stringify({ msg: 'call', body: '{"a":1}', response: '{"b":2}' })
    const { events } = parseLogText(line)
    expect(events[0].decoded.body).toEqual({ a: 1 })
    expect(events[0].decoded.response).toEqual({ b: 2 })
    expect(events[0].message).toBe('call')
  })

  it('leaves plain strings alone', () => {
    const { events } = parseLogText('{"msg":"not json {at all"}')
    expect(events[0].decoded).toEqual({})
  })
})

describe('dropping a file of any kind', () => {
  const JSONL_BODY = '{"level":"info","msg":"a"}\n{"level":"error","msg":"b"}'

  it('detects the format from the content, whatever the extension says', () => {
    // Same bytes, four different names — the parser must not care.
    for (const name of ['pod.txt', 'app.log', 'dump.json', 'no-extension']) {
      const { events, summary } = parseLogText(JSONL_BODY)
      expect(summary.format, name).toBe('jsonl')
      expect(events, name).toHaveLength(2)
    }
  })

  it('reads a .txt file that actually contains JSON Lines', async () => {
    const source = await loadFromFile(new File([JSONL_BODY], 'pod-logs.txt', { type: 'text/plain' }))
    const { events, summary } = parseLogText(source.text)
    expect(source.name).toBe('pod-logs.txt')
    expect(summary.format).toBe('jsonl')
    expect(events[1].level).toBe('error')
  })

  it('reads a file with no extension at all', async () => {
    const source = await loadFromFile(new File(['2026-03-11 09:14:02 ERROR boom'], 'oc-logs-output'))
    expect(parseLogText(source.text).events[0].level).toBe('error')
  })

  it('refuses a binary file instead of showing mojibake', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0xff, 0x00])
    await expect(loadFromFile(new File([bytes], 'archive.zip'))).rejects.toThrow(/binary/i)
    expect(looksBinary('plain text log line')).toBe(false)
  })
})

describe('limits and large inputs', () => {
  it('stops at maxEvents and reports truncation', () => {
    const text = Array.from({ length: 500 }, (_, i) => `{"msg":"m${i}"}`).join('\n')
    const { events, summary } = parseLogText(text, { maxEvents: 100 })
    expect(events).toHaveLength(100)
    expect(summary.truncated).toBe(true)
  })

  it('parses 100k JSONL events', () => {
    const text = Array.from(
      { length: 100_000 },
      (_, i) => `{"time":${1773220442000 + i},"level":"${i % 100 === 0 ? 'error' : 'info'}","service":"svc-${i % 5}","msg":"event ${i}"}`,
    ).join('\n')
    const { events, summary } = parseLogText(text)
    expect(events).toHaveLength(100_000)
    expect(summary.invalid).toBe(0)
    expect(events[99_999].message).toBe('event 99999')
  })

  it('can be cancelled mid-import and returns the partial batch', async () => {
    const text = Array.from({ length: 20_000 }, (_, i) => `{"msg":"m${i}"}`).join('\n')
    let chunks = 0
    const result = await parseLogTextChunked(text, {}, {
      chunkLines: 1000,
      shouldAbort: () => ++chunks >= 2,
    })
    expect(result.aborted).toBe(true)
    expect(result.events.length).toBeGreaterThan(0)
    expect(result.events.length).toBeLessThan(20_000)
  })

  it('reports progress while parsing', async () => {
    const text = Array.from({ length: 5000 }, (_, i) => `{"msg":"m${i}"}`).join('\n')
    const seen: number[] = []
    await parseLogTextChunked(text, {}, { chunkLines: 1000, onProgress: (done) => seen.push(done) })
    expect(seen.length).toBeGreaterThan(1)
    expect(seen[seen.length - 1]).toBe(5000)
  })
})

describe('Go structured enterprise logs', () => {
  it('promotes nested service and Kubernetes identity fields', () => {
    const line = JSON.stringify({
      timestamp: '2026-09-09T10:00:00Z',
      level: 'INFO',
      message: 'request',
      service: { name: 'maul-transaction-ms' },
      k8s: { pod: { name: 'maul-1' }, namespace: { name: 'backend-euro-digitale' } },
      correlation_id: 'APPP-123',
      request_id: 'req-123',
    })
    const event = parseLogText(line).events[0]
    expect(event.service).toBe('maul-transaction-ms')
    expect(event.pod).toBe('maul-1')
    expect(event.namespace).toBe('backend-euro-digitale')
    expect(event.correlationId).toBe('APPP-123')
    expect(event.requestId).toBe('req-123')
  })
})
