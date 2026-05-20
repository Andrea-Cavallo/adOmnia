import type { Collection, Environment, HttpMethod, RequestAuth, RequestBody, RequestItem, KVRow } from './types'

let seq = 0
const id = (prefix: string) => `${prefix}-${++seq}`

function kv(key: string, value: string, enabled = true): KVRow {
  return { id: id('kv'), key, value, enabled }
}

function auth(): RequestAuth {
  return { type: 'none', token: '', username: '', password: '' }
}

function body(raw = '', type: RequestBody['type'] = raw ? 'raw' : 'none'): RequestBody {
  return { id: id('body'), name: 'Body 1', type, raw, lang: 'json', form: [] }
}

function req(name: string, method: HttpMethod, url: string, rawBody = '', headers: KVRow[] = []): RequestItem {
  return {
    id: id('req'),
    name,
    type: 'request',
    method,
    url,
    params: [],
    headers: headers.length > 0 ? headers : [kv('', '', false)],
    bodies: [body(rawBody)],
    activeBodyIdx: 0,
    auth: auth(),
  }
}

export function createAdomniaLabWorkspace(sidecarBase = 'http://localhost:34115'): {
  collections: Collection[]
  environments: Environment[]
  activeEnvId: string
} {
  seq = 0

  const envId = 'env-adomnia-lab'
  const jsonHeader = [kv('Content-Type', 'application/json')]

  const collections: Collection[] = [
    {
      id: 'col-adomnia-sidecar',
      name: 'adOmnia Sidecar Control',
      children: [
        {
          id: 'folder-mock',
          name: 'Mock Server',
          type: 'folder',
          children: [
            req('Mock status', 'GET', '{{sidecarBase}}/mock/status'),
            req('Start mock server', 'POST', '{{sidecarBase}}/mock/start', JSON.stringify({
              port: 9090,
              password: '',
              endpoints: [
                {
                  id: 'hello',
                  path: '/api/hello',
                  method: 'GET',
                  mode: 'first_active',
                  responses: [
                    {
                      id: 'ok',
                      name: '200 hello',
                      status: 200,
                      headers: { 'Content-Type': 'application/json' },
                      body: '{"ok":true,"service":"adomnia-mock"}',
                      delayMs: 0,
                      isActive: true,
                    },
                  ],
                },
              ],
            }, null, 2), jsonHeader),
            req('Mock hits', 'GET', '{{sidecarBase}}/mock/hits'),
            req('Record lab API as mock', 'POST', '{{sidecarBase}}/mock/record', JSON.stringify({
              url: '{{mockApiBase}}/json',
              method: 'GET',
              mockPath: '/recorded/json',
              mockMethod: 'GET',
              headers: {},
            }, null, 2), jsonHeader),
          ],
        },
        {
          id: 'folder-kafka',
          name: 'Kafka',
          type: 'folder',
          children: [
            req('List Kafka topics', 'POST', '{{sidecarBase}}/kafka/topics', JSON.stringify({
              brokers: ['{{kafkaBroker}}'],
              topic: '{{kafkaTopic}}',
              clientId: 'adomnia-lab',
            }, null, 2), jsonHeader),
            req('Produce Kafka message', 'POST', '{{sidecarBase}}/kafka/produce', JSON.stringify({
              config: {
                brokers: ['{{kafkaBroker}}'],
                topic: '{{kafkaTopic}}',
                clientId: 'adomnia-lab',
                tls: false,
              },
              key: 'demo-key',
              value: '{"source":"adomnia","event":"hello"}',
              headers: { demo: 'true' },
            }, null, 2), jsonHeader),
            req('Consume Kafka messages', 'POST', '{{sidecarBase}}/kafka/consume', JSON.stringify({
              config: {
                brokers: ['{{kafkaBroker}}'],
                topic: '{{kafkaTopic}}',
                groupId: 'adomnia-lab-group',
                clientId: 'adomnia-lab',
                tls: false,
              },
              maxWait: 5,
              maxMsgs: 10,
              fromStart: true,
            }, null, 2), jsonHeader),
          ],
        },
        {
          id: 'folder-proxy',
          name: 'Proxy',
          type: 'folder',
          children: [
            req('Proxy traffic', 'GET', '{{sidecarBase}}/proxy/traffic'),
            req('Set proxy rules', 'PUT', '{{sidecarBase}}/proxy/rules', JSON.stringify({
              action: 'set',
              rules: [
                { id: 'lab-localhost', type: 'intercept', target: 'localhost', enabled: true, note: 'Lab traffic' },
                { id: 'lab-private', type: 'allow', target: '127.0.0.0/8', enabled: true, note: 'Loopback' },
              ],
            }, null, 2), jsonHeader),
            req('Test proxy rule', 'GET', '{{sidecarBase}}/proxy/rules/test?target=localhost'),
            req('Proxy CA status', 'GET', '{{sidecarBase}}/proxy/ca/status'),
          ],
        },
        {
          id: 'folder-storage-vault',
          name: 'Storage and Vault',
          type: 'folder',
          children: [
            req('Storage status', 'GET', '{{sidecarBase}}/storage/status'),
            req('Search storage', 'GET', '{{sidecarBase}}/storage/search?q=adomnia'),
            req('Vault encrypt sample', 'POST', '{{sidecarBase}}/vault/encrypt', JSON.stringify({
              plaintext: 'secret-from-adomnia-lab',
              passphrase: '{{vaultPassphrase}}',
            }, null, 2), jsonHeader),
          ],
        },
        {
          id: 'folder-load-json',
          name: 'Load Test and JSON Tools',
          type: 'folder',
          children: [
            req('Run load test against lab API', 'POST', '{{sidecarBase}}/loadtest', JSON.stringify({
              url: '{{mockApiBase}}/json',
              method: 'GET',
              concurrency: 5,
              totalReqs: 50,
              timeoutMs: 5000,
              warmupReqs: 5,
            }, null, 2), jsonHeader),
            req('JSON query', 'POST', '{{sidecarBase}}/json/query', JSON.stringify({
              json: '{"data":{"items":[{"name":"alpha"},{"name":"beta"}]}}',
              path: 'data.items.0.name',
            }, null, 2), jsonHeader),
            req('JSON diff', 'POST', '{{sidecarBase}}/json/diff', JSON.stringify({
              left: { ok: true, version: 1 },
              right: { ok: true, version: 2 },
            }, null, 2), jsonHeader),
          ],
        },
      ],
    },
    {
      id: 'col-docker-lab',
      name: 'Docker Lab Services',
      children: [
        req('Lab API health', 'GET', '{{mockApiBase}}/health'),
        req('Lab API JSON', 'GET', '{{mockApiBase}}/json'),
        req('Lab API echo POST', 'POST', '{{mockApiBase}}/echo', JSON.stringify({
          from: 'adomnia',
          message: 'hello docker lab',
        }, null, 2), jsonHeader),
      ],
    },
  ]

  const environments: Environment[] = [
    {
      id: envId,
      name: 'adOmnia Local Lab',
      variables: [
        kv('sidecarBase', sidecarBase),
        kv('mockApiBase', 'http://localhost:18080'),
        kv('kafkaBroker', 'localhost:19092'),
        kv('kafkaTopic', 'adomnia.lab.events'),
        kv('vaultPassphrase', 'change-me-local-only'),
      ],
    },
  ]

  return { collections, environments, activeEnvId: envId }
}
