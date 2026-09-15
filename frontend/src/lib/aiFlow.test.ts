import { describe, expect, it } from 'vitest'
import { buildAiFlowPrompt, convertAiFlowToSavedDefinition, sanitizeAiFlowText, summarizeAiFlow, validateAiFlowModel, type AiFlowModel } from './aiFlow'
import { runApiFlow, validateFlowGraph } from './flowRunner'
import type { ResponseData } from './types'

function response(status: number, body: object): ResponseData {
  const raw = JSON.stringify(body)
  return { status, statusText: String(status), headers: {}, body: raw, contentType: 'application/json', ms: 1, size: raw.length }
}

describe('aiFlow', () => {
  it('teaches the model explicit data handoffs and request error recovery', () => {
    const prompt = buildAiFlowPrompt({ instructions: 'Call A, then B. Put A customer id in B. If B times out or returns 500 call D.', context: { collections: [], environments: [] } })
    expect(prompt.system).toContain('add extract: {variableName: "$.json.path"}')
    expect(prompt.system).toContain('HTTP 4xx/5xx')
    expect(prompt.user).toContain('{{customerId}}')
    expect(prompt.user).toContain('"condition": "error"')
  })

  it('executes A to B with an extracted value and takes D only when B fails', async () => {
    const model: AiFlowModel = {
      name: 'A B with fallback D',
      nodes: [
        { id: 'a', type: 'http-request', label: 'Call A', method: 'GET', url: '/a', extract: { customerId: '$.customer.id' } },
        { id: 'b', type: 'http-request', label: 'Call B', method: 'POST', url: '/b', body: { customerId: '{{customerId}}' } },
        { id: 'd', type: 'http-request', label: 'Call D', method: 'POST', url: '/d', body: { customerId: '{{customerId}}' } },
        { id: 'ok', type: 'end', state: 'success' },
        { id: 'recovered', type: 'end', state: 'success' },
      ],
      edges: [
        { from: 'a', to: 'b', condition: 'success' },
        { from: 'b', to: 'ok', condition: 'success' },
        { from: 'b', to: 'd', condition: '5xx' },
        { from: 'd', to: 'recovered', condition: 'success' },
      ],
    }

    expect(validateAiFlowModel(model)).toEqual([])
    const definition = convertAiFlowToSavedDefinition(model)
    const summary = summarizeAiFlow(definition, model, [])
    expect(summary.dataHandoffs).toEqual(expect.arrayContaining([
      'Call A.$.customer.id → {{customerId}} → Call B',
      'Call A.$.customer.id → {{customerId}} → Call D',
    ]))
    expect(summary.recoveryPaths).toContain('b failure → d')

    const executed: string[] = []
    const run = await runApiFlow(definition.graph, {
      initialVars: {},
      execute: async (request, vars) => {
        executed.push(`${request.name}:${vars.customerId ?? ''}`)
        if (request.name === 'Call A') return { response: response(200, { customer: { id: 'C-42' } }), vars, mutations: {}, scriptRuns: [] }
        if (request.name === 'Call B') return { response: response(500, { error: 'down' }), vars, mutations: {}, scriptRuns: [] }
        return { response: response(204, {}), vars, mutations: {}, scriptRuns: [] }
      },
    })
    expect(executed).toEqual(['Call A:', 'Call B:C-42', 'Call D:C-42'])
    expect(run.entries[run.entries.length - 1]?.status).toBe('success')

    const noResponse: string[] = []
    await runApiFlow(definition.graph, {
      initialVars: {},
      execute: async (request, vars) => {
        noResponse.push(request.name)
        if (request.name === 'Call A') return { response: response(200, { customer: { id: 'C-42' } }), vars, mutations: {}, scriptRuns: [] }
        if (request.name === 'Call B') return { response: { ...response(0, {}), error: { code: 'TIMEOUT', message: 'No response' } }, vars, mutations: {}, scriptRuns: [] }
        return { response: response(204, {}), vars, mutations: {}, scriptRuns: [] }
      },
    })
    expect(noResponse).toEqual(['Call A', 'Call B', 'Call D'])

    const success: string[] = []
    await runApiFlow(definition.graph, {
      initialVars: {},
      execute: async (request, vars) => {
        success.push(request.name)
        return { response: request.name === 'Call A' ? response(200, { customer: { id: 'C-42' } }) : response(200, {}), vars, mutations: {}, scriptRuns: [] }
      },
    })
    expect(success).toEqual(['Call A', 'Call B'])
  })

  it('converts a linear authenticated flow into an executable graph', async () => {
    const model: AiFlowModel = {
      name: 'Login and profile',
      description: 'Authenticate and load the current user',
      nodes: [
        { id: 'login', type: 'http-request', method: 'POST', url: '{{baseUrl}}/auth/login', body: { username: '{{username}}', password: '{{password}}' }, extract: { token: '$.access_token' } },
        { id: 'me', type: 'http-request', method: 'GET', url: '{{baseUrl}}/users/me', headers: { Authorization: 'Bearer {{token}}' }, expectedStatus: '200' },
        { id: 'done', type: 'end', state: 'success' },
      ],
      edges: [
        { from: 'login', to: 'me', condition: 'success' },
        { from: 'me', to: 'done', condition: 'success' },
      ],
    }

    expect(validateAiFlowModel(model)).toEqual([])
    const flow = convertAiFlowToSavedDefinition(model)
    expect(validateFlowGraph(flow.graph)).toEqual([])
    expect(flow.graph.nodes.find((node) => node.id === 'login')?.config.extractions?.[0]).toMatchObject({ name: 'token', path: 'access_token' })
    expect(flow.graph.nodes.find((node) => node.id === 'me')?.config.request?.headers).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'Authorization', value: 'Bearer {{token}}' })]))

    const executed: string[] = []
    const seenTokens: string[] = []
    const run = await runApiFlow(flow.graph, {
      initialVars: { baseUrl: 'https://api.local', username: 'u', password: 'p' },
      execute: async (request, vars) => {
        executed.push(request.url)
        seenTokens.push(vars.token ?? '')
        if (request.name === 'login') return { response: response(200, { access_token: 'abc' }), vars, mutations: {}, scriptRuns: [] }
        return { response: response(200, { active: true }), vars, mutations: {}, scriptRuns: [] }
      },
    })

    expect(executed).toEqual(['{{baseUrl}}/auth/login', '{{baseUrl}}/users/me'])
    expect(seenTokens).toEqual(['', 'abc'])
    expect(run.entries[run.entries.length - 1]?.status).toBe('success')
  })

  it('preserves explicit JSON bodies and creates conditions and assertions', () => {
    const body = '{\n  "customerId": "{{customerId}}",\n  "productCode": "ABC123",\n  "quantity": 2\n}'
    const model: AiFlowModel = {
      name: 'Order',
      nodes: [
        { id: 'order', type: 'http-request', method: 'POST', url: '/orders', bodyRaw: body, assertions: [{ target: 'statusCode', operator: 'eq', expected: '201' }], retry: 3, timeoutMs: 5000 },
        { id: 'active', type: 'condition', expression: 'order.status == 201' },
        { id: 'done', type: 'end', state: 'success' },
      ],
      edges: [{ from: 'order', to: 'active', condition: 'success' }, { from: 'active', to: 'done', condition: 'true' }],
    }
    const flow = convertAiFlowToSavedDefinition(model)
    const order = flow.graph.nodes.find((node) => node.id === 'order')

    expect(order?.config.request?.bodies[0].raw).toBe(body)
    expect(order?.config.retryCount).toBe(3)
    expect(order?.config.timeoutMs).toBe(5000)
    expect(order?.config.request?.assertions?.[0]).toMatchObject({ target: 'statusCode', operator: 'eq', expected: '201' })
    expect(flow.graph.nodes.find((node) => node.id === 'active')?.config.condition).toMatchObject({ path: 'order.status', operator: 'eq', value: '201' })
  })

  it('reports invalid output, missing variables, cycles, and sanitized secrets', () => {
    const bad: AiFlowModel = {
      name: 'Bad',
      nodes: [
        { id: 'a', type: 'http-request', method: 'POST', url: '/a', bodyRaw: '{' },
        { id: 'b', type: 'condition', expression: '' },
      ],
      edges: [{ from: 'a', to: 'missing' }, { from: 'b', to: 'a' }, { from: 'a', to: 'b' }],
    }

    expect(validateAiFlowModel(bad).join('\n')).toContain('invalid JSON bodyRaw')
    expect(validateAiFlowModel(bad).join('\n')).toContain('Edge target does not exist')
    expect(validateAiFlowModel(bad).join('\n')).toContain('Circular dependency')

    const sanitized = sanitizeAiFlowText('Authorization: Bearer abcdefghijklmnopqrstuvwxyz\nclient_secret=super-secret-value')
    expect(sanitized.text).toContain('{{ACCESS_TOKEN}}')
    expect(sanitized.text).toContain('{{CLIENT_SECRET}}')
  })

  it('summarizes parallel branch warnings instead of silently inventing parallel execution', () => {
    const model: AiFlowModel = {
      name: 'Parallel',
      nodes: [
        { id: 'profile', type: 'http-request', method: 'GET', url: '/profile' },
        { id: 'prefs', type: 'http-request', method: 'GET', url: '/prefs' },
        { id: 'start-api', type: 'http-request', method: 'GET', url: '/start' },
      ],
      edges: [{ from: 'start-api', to: 'profile' }, { from: 'start-api', to: 'prefs' }],
    }
    const flow = convertAiFlowToSavedDefinition(model)
    const summary = summarizeAiFlow(flow, model, [])
    expect(summary.warnings.join('\n')).toContain('current runner executes one path at a time')
  })
})
