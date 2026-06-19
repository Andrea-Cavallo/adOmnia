import { describe, expect, it } from 'vitest'
import { convertAiFlowToSavedDefinition, sanitizeAiFlowText, summarizeAiFlow, validateAiFlowModel, type AiFlowModel } from './aiFlow'
import { runApiFlow, validateFlowGraph } from './flowRunner'
import type { ResponseData } from './types'

function response(status: number, body: object): ResponseData {
  const raw = JSON.stringify(body)
  return { status, statusText: String(status), headers: {}, body: raw, contentType: 'application/json', ms: 1, size: raw.length }
}

describe('aiFlow', () => {
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
