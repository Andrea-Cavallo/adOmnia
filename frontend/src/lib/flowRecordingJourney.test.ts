import { afterEach, describe, expect, it } from 'vitest'
import { runApiFlow } from './flowRunner'
import { createRecordedFlowDefinition, normalizeFlowDefinitions } from './flowStorage'
import { blankRequest, type ResponseData } from './types'
import { useFlowRecorderStore } from '@/stores/flowRecorder'
import { substVars } from './substVars'
import { prepareRequestForCodegen } from './sendRequest'

function response(status = 200): ResponseData {
  return { status, statusText: String(status), headers: {}, body: '{"ok":true}', contentType: 'application/json', ms: 1, size: 11 }
}

describe('record → save → replay journey', () => {
  afterEach(() => useFlowRecorderStore.getState().cancel())

  it('rebinds an existing environment variable populated from a recorded response', async () => {
    const store = useFlowRecorderStore.getState()
    store.start()
    store.capture({ ...blankRequest('POST', 'Create'), url: 'http://localhost/create' }, null, { ...response(), body: '{"id":"original-id"}' })
    const next = { ...blankRequest('POST', 'Use ID'), url: 'http://localhost/use' }
    next.bodies[0] = { ...next.bodies[0], type: 'raw', raw: '{"id":"{{subscription_id}}"}' }
    store.capture(next, null, response(), { subscription_id: 'original-id' })
    const flow = createRecordedFlowDefinition('Variable demo', store.take())
    const sent: string[] = []
    await runApiFlow(flow.graph, { initialVars: { subscription_id: 'stale-value' }, execute: async (request, vars) => {
      if (request.name === 'Use ID') sent.push(substVars(request.bodies[0].raw, vars))
      return { response: { ...response(), body: '{"id":"fresh-id"}' }, vars, mutations: {}, scriptRuns: [] }
    } })
    expect(sent).toEqual(['{"id":"fresh-id"}'])
  })

  it('keeps numeric and object copies typed, escapes strings, and survives save/load', async () => {
    const store = useFlowRecorderStore.getState()
    store.start()
    const first = { ...blankRequest('POST', 'Producer'), url: 'http://localhost/producer' }
    const original = { items: [{ id: 42 }], address: { city: 'Roma' }, name: 'Original name' }
    store.capture(first, null, { ...response(), body: JSON.stringify(original) })
    const second = { ...blankRequest('POST', 'Consumer'), url: 'http://localhost/consumer' }
    second.bodies[0] = { ...second.bodies[0], type: 'raw', lang: 'json', raw: JSON.stringify({ owner: 42, shipping: original.address, display: original.name, password: 'do-not-save' }) }
    store.capture(second, null, response())
    const saved = createRecordedFlowDefinition('Typed demo', store.take())
    expect(JSON.stringify(saved)).not.toContain('do-not-save')
    const [loaded] = normalizeFlowDefinitions(JSON.parse(JSON.stringify([saved])))
    let sentBody = ''
    const fresh = { items: [{ id: 73 }], address: { city: 'Milano', zip: 20100 }, name: 'Ada "Demo"\nSecond line' }
    const result = await runApiFlow(loaded.graph, {
      initialVars: {},
      execute: async (request, vars) => {
        const resolved = await prepareRequestForCodegen(request, vars)
        if (request.name === 'Consumer') sentBody = resolved.bodies[0].raw
        return { response: { ...response(), body: JSON.stringify(fresh) }, vars, mutations: {}, scriptRuns: [] }
      },
    })
    expect(result.entries.every(entry => entry.status === 'success')).toBe(true)
    expect(JSON.parse(sentBody)).toEqual({ owner: 73, shipping: fresh.address, display: fresh.name, password: '' })
  })

  it('replays a copied response value using the new response, including bearer auth', async () => {
    const store = useFlowRecorderStore.getState()
    store.start()
    const login = { ...blankRequest('POST', 'Login'), url: 'http://localhost/login' }
    store.capture(login, null, { ...response(), body: '{"data":{"id":"user-original"},"access_token":"token-original"}' })
    const next = { ...blankRequest('POST', 'Create order'), url: 'http://localhost/orders' }
    next.auth = { ...next.auth, type: 'bearer', token: 'token-original' }
    next.bodies[0] = { ...next.bodies[0], type: 'raw', raw: '{"userId":"user-original"}' }
    store.capture(next, null, response())
    const flow = createRecordedFlowDefinition('Demo', store.take())
    expect(flow.graph.nodes.find(node => node.config.seq === 1)?.config.extractions).toHaveLength(2)
    expect(JSON.stringify(flow)).not.toContain('token-original')
    const replayed: string[] = []
    await runApiFlow(flow.graph, {
      initialVars: {},
      execute: async (request, vars) => {
        if (request.name === 'Create order') {
          replayed.push(substVars(request.bodies[0].raw, vars))
          replayed.push(substVars(request.auth.token, vars))
        }
        return { response: { ...response(), body: '{"data":{"id":"user-new"},"access_token":"token-new"}' }, vars, mutations: {}, scriptRuns: [] }
      },
    })
    expect(replayed).toEqual(['{"userId":"user-new"}', 'token-new'])
  })

  it('turns four Composer sends into four ordered, replayable request nodes', async () => {
    const store = useFlowRecorderStore.getState()
    store.start()
    ;['login', 'profile', 'update', 'logout'].forEach((name, index) => {
      const request = blankRequest(index === 0 ? 'POST' : 'GET', name)
      request.url = `{{baseUrl}}/${name}`
      request.bodies[0] = { ...request.bodies[0], type: 'raw', raw: JSON.stringify({ step: name }) }
      store.capture(request, { id: 'local', name: 'Local' }, response(index === 2 ? 204 : 200))
    })

    expect(useFlowRecorderStore.getState()).toMatchObject({ recording: true })
    expect(useFlowRecorderStore.getState().calls).toHaveLength(4)

    store.stop()
    const flow = createRecordedFlowDefinition('Recorded Flow', useFlowRecorderStore.getState().take())
    const recordedNodes = flow.graph.nodes.filter((node) => node.type === 'request')
    expect(recordedNodes.map((node) => node.config.seq)).toEqual([1, 2, 3, 4])
    expect(recordedNodes.map((node) => node.config.request?.bodies[0].raw)).toEqual([
      '{"step":"login"}', '{"step":"profile"}', '{"step":"update"}', '{"step":"logout"}',
    ])

    const replayed: string[] = []
    const result = await runApiFlow(flow.graph, {
      initialVars: { baseUrl: 'https://api.local' },
      execute: async (request, vars) => {
        replayed.push(request.name)
        return { response: response(), vars, mutations: {}, scriptRuns: [] }
      },
    })
    expect(replayed).toEqual(['login', 'profile', 'update', 'logout'])
    expect(result.entries.filter((entry) => entry.nodeId !== 'engine').every((entry) => entry.status === 'success')).toBe(true)
  })
})
