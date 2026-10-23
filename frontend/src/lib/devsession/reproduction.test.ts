import { describe, expect, it } from 'vitest'
import type { RequestRun } from '@/lib/devsession-api'
import { buildReproduction, composeYaml, featureFlags, nonDeterministic, stripBody, stripHeaders, stripText, tablesIn, variablesIn } from './reproduction'

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
    // The names are sorted with localeCompare (reliable alphabetical order, S2871).
    expect(variablesIn('{{baseUrl}}/orders/{{ id }}', 'Bearer {{TOKEN}}')).toEqual(['baseUrl', 'id', 'TOKEN'])
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
      spans: [{ traceId: 't1', spanId: 's', name: 'GET /orders', kind: 'server', service: 'orders', startMs: 1, durationMs: 2, statusCode: 'OK', category: 'http', attributes: { 'url.full': 'http://x/?token=abc' } } as never],
      config: { profiles: ['.env'], counts: { ok: 1, missing: 1, unused: 0, partial: 0 }, keys: [
        { name: 'DB_URL', status: 'ok', values: { '.env': 'postgres://u:***@db/x' }, usedIn: [], definedIn: [], missingIn: [] },
        { name: 'API_TOKEN', status: 'missing', values: {}, usedIn: [], definedIn: [], missingIn: [] },
        { name: 'FEATURE_NEW_CHECKOUT', status: 'ok', values: { '.env': 'true' }, usedIn: [], definedIn: [], missingIn: [] },
      ] },
      datasources: [{ type: 'postgres' }, { type: 'kafka' }],
      dbSchema: 'postgres database "orders" (Database Studio connection "local"):\n- orders(id uuid, status text)',
    })
    expect(result.dir).toBe('repro/20261009-100500-post-orders')
    const names = result.files.map((file) => file.relativePath.slice(result.dir.length + 1)).sort((a, b) => a.localeCompare(b))
    expect(names).toEqual(['.env.example', 'config.md', 'db/tables.md', 'docker-compose.yml', 'flags.md', 'kafka/01-orders-created.kafka.json', 'logs.txt', 'queries.sql', 'README.md', 'repro_test.go', 'request.http', 'stack.txt', 'trace.json'])
    const file = (name: string) => result.files.find((item) => item.relativePath.endsWith(name))!.content
    expect(file('request.http')).toContain('Authorization: {{AUTHORIZATION}}')
    expect(file('request.http')).not.toContain('abc')
    expect(file('repro_test.go')).toContain('req.Header.Set("Authorization", expand("{{AUTHORIZATION}}"))')
    expect(file('repro_test.go')).toContain('func TestReproducePostOrders(t *testing.T)')
    expect(file('.env.example')).toBe('# Values the request needs (the captured ones are not written here)\nBASE_URL=\nAUTHORIZATION=\nbaseUrl=\n\n# Variables orders reads\nDB_URL=\nAPI_TOKEN=\nFEATURE_NEW_CHECKOUT=\n')
    expect(file('config.md')).toContain('| `DB_URL` | ok | `postgres://u:***@db/x` |')
    expect(file('config.md')).toContain('| `API_TOKEN` | missing | — |')
    expect(file('db/tables.md')).toContain('| `orders` | 1 |')
    expect(file('db/tables.md')).toContain('orders(id uuid, status text)')
    expect(file('flags.md')).toContain('| `FEATURE_NEW_CHECKOUT` | ok | `true` |')
    expect(file('flags.md')).not.toContain('DB_URL')
    expect(file('docker-compose.yml')).toContain('image: postgres:16-alpine')
    expect(file('docker-compose.yml')).toContain('image: apache/kafka:3.7.1')
    expect(file('docker-compose.yml')).toContain('POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}')
    expect(file('logs.txt')).toContain('token=<redacted>')
    expect(file('trace.json')).toContain('token=<redacted>')
    expect(file('README.md')).toContain('SQL NOW()')
    expect(file('README.md')).toMatch(/1\. Start orders[\s\S]*2\. Bring the dependencies up[\s\S]*3\. Bring the database[\s\S]*4\. If the flow starts from a message[\s\S]*5\. Set the feature flags[\s\S]*6\. Send `request\.http`/)
    expect(file('README.md')).toContain('2 secret value(s)')
    expect(result.secretsStripped).toBe(2)
  })

  it('extracts tables, flags and Compose dependencies', () => {
    expect(tablesIn([
      "SELECT * FROM orders o JOIN payments p ON p.id = o.id WHERE o.name = 'from fake'",
      'INSERT INTO audit_log(id) VALUES (1)',
      'UPDATE orders SET status = $1',
      'DELETE FROM sessions',
    ])).toEqual(['audit_log', 'orders', 'payments', 'sessions'])
    const config = { profiles: ['.env'], counts: { ok: 2, missing: 0, unused: 1, partial: 0 }, keys: [
      { name: 'FEATURE_NEW_CHECKOUT', status: 'ok', values: { '.env': 'true' }, usedIn: [], definedIn: [], missingIn: [] },
      { name: 'CHECKOUT_ENABLED', status: 'ok', values: { '.env': 'false' }, usedIn: [], definedIn: [], missingIn: [] },
      { name: 'DB_URL', status: 'ok', values: { '.env': 'x' }, usedIn: [], definedIn: [], missingIn: [] },
    ] } as unknown as Parameters<typeof featureFlags>[0]
    expect(featureFlags(config).map((key) => key.name)).toEqual(['FEATURE_NEW_CHECKOUT', 'CHECKOUT_ENABLED'])
    expect(composeYaml([{ type: 'postgres' }, { type: 'postgres' }, { type: 'redis' }, { type: 'unknown' }])).toContain('image: redis:7-alpine')
    expect(composeYaml([{ type: 'postgres' }, { type: 'redis' }])).not.toContain('image: apache/kafka')
    expect(composeYaml([{ type: 'unknown' }])).toBeUndefined()
    expect(composeYaml([])).toBeUndefined()
  })
})
