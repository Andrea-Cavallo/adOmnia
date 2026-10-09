import { describe, expect, it } from 'vitest'
import type { RequestRun } from '@/lib/devsession-api'
import { buildReproduction, nonDeterministic, stripBody, stripHeaders, stripText, variablesIn } from './reproduction'

const row = (key: string, value: string, enabled = true) => ({ id: key, key, value, enabled })
const run: RequestRun = {
  id: 'r1', sessionId: 's1', tabId: 't1', method: 'POST', url: 'http://localhost:8080/orders', correlationId: 'c-1', state: 'error',
  startedAt: '2026-10-09T10:00:00Z', status: 500, durationMs: 42, hits: [{ function: 'main.create', relativePath: 'orders.go', line: 31, at: '2026-10-09T10:00:00.010Z', confidence: 'likely', stack: [{ function: 'main.serve', relativePath: 'main.go', line: 12 }] }],
  logs: 1, queries: 1, messages: 1,
} as unknown as RequestRun

describe('reproduction', () => {
  it('strips secrets from headers, bodies and logs', () => {
    expect(stripHeaders([row('Authorization', 'Bearer abc'), row('X-Trace', '1'), row('Cookie', '{{COOKIE}}'), row('Off', 'x', false)])).toEqual([
      { key: 'Authorization', value: '{{AUTHORIZATION}}', secret: true },
      { key: 'X-Trace', value: '1', secret: false },
      { key: 'Cookie', value: '{{COOKIE}}', secret: false },
    ])
    expect(JSON.parse(stripBody('{"user":"a","password":"p","nested":{"apiKey":"k"}}'))).toEqual({ user: 'a', password: '<redacted>', nested: { apiKey: '<redacted>' } })
    expect(stripBody('user=a&password=p')).toBe('user=a&password=<redacted>')
    expect(stripText('auth Bearer eyJ.abc.def token=xyz ok')).toBe('auth Bearer <redacted> token=<redacted> ok')
  })

  it('finds env references and non-deterministic values', () => {
    expect(variablesIn('{{baseUrl}}/orders/{{ id }}', 'Bearer {{TOKEN}}')).toEqual(['TOKEN', 'baseUrl', 'id'])
    expect(nonDeterministic(['{"id":"4f2c1a9e-1d2b-4c3d-9e8f-0a1b2c3d4e5f","at":"2026-10-09T10:00:00Z","n":"{{$randomInt}}"}'], ['INSERT INTO t VALUES (now())'])).toEqual([
      'UUID 4f2c1a9e-1d2b-4c3d-9e8f-0a1b2c3d4e5f', 'timestamp 2026-10-09T10:00:00Z', 'generated value {{$randomInt}}', 'SQL NOW()',
    ])
  })

  it('builds the reproduction folder', () => {
    const result = buildReproduction({
      run, service: 'orders', createdAt: '2026-10-09T10:05:00.123Z',
      request: { method: 'POST', url: '{{baseUrl}}/orders', headers: [row('Authorization', 'Bearer abc'), row('Content-Type', 'application/json')], body: { id: 'b', name: 'b', type: 'raw', lang: 'json', raw: '{"sku":"A","password":"x"}', form: [] } },
      logs: [{ seq: 1, sessionId: 's1', at: '10:00:00', stream: 'stderr', text: 'panic: nil map token=abc', level: 'error' }],
      queries: [{ id: 'q', sessionId: 's1', at: '10:00:00', sql: 'INSERT INTO orders VALUES (now())', source: 'proxy', error: 'duplicate key' } as never],
      messages: [{ id: 'm', sessionId: 's1', at: '10:00:00', broker: 'kafka', topic: 'orders.created', partition: 0, offset: 7, key: 'o-1', preview: '{"id":1}' }],
    })
    expect(result.dir).toBe('repro/20261009-100500-post-orders')
    const names = result.files.map((file) => file.relativePath.slice(result.dir.length + 1)).sort()
    expect(names).toEqual(['.env.example', 'README.md', 'kafka/01-orders-created.kafka.json', 'logs.txt', 'queries.sql', 'repro_test.go', 'request.http', 'stack.txt'])
    const file = (name: string) => result.files.find((item) => item.relativePath.endsWith(name))!.content
    expect(file('request.http')).toContain('Authorization: {{AUTHORIZATION}}')
    expect(file('request.http')).not.toContain('abc')
    expect(file('repro_test.go')).toContain('req.Header.Set("Authorization", expand("{{AUTHORIZATION}}"))')
    expect(file('repro_test.go')).toContain('func TestReproducePostOrders(t *testing.T)')
    expect(file('.env.example')).toBe('# Values the request needs (the captured ones are not written here)\nBASE_URL=\nAUTHORIZATION=\nbaseUrl=\n')
    expect(file('logs.txt')).toContain('token=<redacted>')
    expect(file('README.md')).toContain('SQL NOW()')
    expect(file('README.md')).toMatch(/1\. Start orders[\s\S]*2\. Bring the database[\s\S]*3\. If the flow starts from a message[\s\S]*4\. Send `request\.http`/)
    expect(file('README.md')).toContain('2 secret value(s)')
    expect(result.secretsStripped).toBe(2)
  })
})
