import { beforeEach, describe, expect, it } from 'vitest'
import { blankRequest } from '@/lib/types'
import { useFlowRecorderStore } from './flowRecorder'

describe('flow recorder', () => {
  beforeEach(() => useFlowRecorderStore.getState().cancel())

  it('leaves ambiguous values and existing references alone and clears response sources between sessions', () => {
    const store = useFlowRecorderStore.getState()
    const request = blankRequest('POST', 'Ambiguous')
    request.bodies[0] = { ...request.bodies[0], type: 'raw', raw: '{"id":"duplicate","name":"{{name}}"}' }
    const response = { status: 200, statusText: 'OK', headers: {}, body: '{"a":"duplicate","b":"duplicate","name":"Unique name"}', contentType: '', ms: 1, size: 0 }
    store.start()
    store.capture(blankRequest(), null, response)
    store.capture(request, null, response)
    expect(store.take()[1].request.bodies[0].raw).toBe(request.bodies[0].raw)
    store.start()
    request.bodies[0].raw = '{"name":"Unique name"}'
    store.capture(request, null, response)
    expect(store.take()[0].request.bodies[0].raw).toBe(request.bodies[0].raw)
  })

  it('captures every completed send in sequence and does not persist direct secrets', () => {
    const request = blankRequest('POST', 'Login')
    request.url = '{{baseUrl}}/login'
    request.auth = { ...request.auth, type: 'bearer', token: 'plaintext-token' }
    request.headers = [{ id: 'header', key: 'Authorization', value: 'Bearer plaintext-token', enabled: true }]
    request.cookies = [{ id: 'cookie', key: 'sid', value: 'plaintext-cookie', enabled: true }]
    request.bodies[0] = { ...request.bodies[0], type: 'raw', raw: '{"password":"plaintext-password","name":"Ada"}' }
    const store = useFlowRecorderStore.getState()
    store.start()
    store.capture(request, { id: 'env', name: 'Local' }, { status: 401, statusText: 'Unauthorized', headers: {}, body: '', contentType: '', ms: 12, size: 0 })
    store.capture(request, { id: 'env', name: 'Local' }, { status: 200, statusText: 'OK', headers: {}, body: '', contentType: '', ms: 3, size: 0 })

    const calls = useFlowRecorderStore.getState().calls
    expect(calls.map((call) => call.seq)).toEqual([1, 2])
    expect(calls[0].execution.status).toBe(401)
    expect(calls[0].request.url).toBe('{{baseUrl}}/login')
    expect(calls[0].request.auth.token).toBe('')
    expect(calls[0].request.headers[0].value).toBe('')
    expect(calls[0].request.cookies?.[0].value).toBe('')
    expect(calls[0].request.bodies[0].raw).toBe('{"password":"","name":"Ada"}')
  })

  it('retains variable and vault references needed for replay', () => {
    const request = blankRequest('GET', 'Profile')
    request.auth = { ...request.auth, type: 'bearer', token: '{{token}}' }
    request.headers = [{ id: 'key', key: 'X-API-Key', value: 'vault:api-key', enabled: true }]
    const store = useFlowRecorderStore.getState()
    store.start()
    store.capture(request, null, { status: 200, statusText: 'OK', headers: {}, body: '', contentType: '', ms: 1, size: 0 })
    const saved = useFlowRecorderStore.getState().calls[0].request
    expect(saved.auth.token).toBe('{{token}}')
    expect(saved.headers[0].value).toBe('vault:api-key')
  })

  it('redacts secrets in non-JSON raw bodies as well', () => {
    const request = blankRequest('POST', 'Legacy login')
    request.bodies[0] = { ...request.bodies[0], type: 'raw', lang: 'xml', raw: '<login><password>plaintext-password</password><token>{{sessionToken}}</token></login>' }
    const store = useFlowRecorderStore.getState()
    store.start()
    store.capture(request, null, { status: 200, statusText: 'OK', headers: {}, body: '', contentType: '', ms: 1, size: 0 })
    expect(useFlowRecorderStore.getState().calls[0].request.bodies[0].raw).toBe('<login><password></password><token>{{sessionToken}}</token></login>')
  })
})
