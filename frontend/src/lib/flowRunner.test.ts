import { describe, expect, it } from 'vitest'
import { DEFAULT_FLOW_SETTINGS, createRecordedFlowDefinition, type FlowGraphDefinition } from './flowStorage'
import { runApiFlow, validateFlowGraph } from './flowRunner'
import { blankRequest, type RequestItem, type ResponseData } from './types'

function response(status: number, body = '{}'): ResponseData {
  return { status, statusText: String(status), headers: {}, body, contentType: 'application/json', ms: 1, size: body.length }
}

function request(name: string): RequestItem {
  return { ...blankRequest('GET', name), name, url: `https://api.local/${name}` }
}

describe('flowRunner', () => {
  it('executes request, condition, and true branch in order', async () => {
    const graph: FlowGraphDefinition = {
      settings: DEFAULT_FLOW_SETTINGS,
      nodes: [
        { id: 'a', type: 'request', label: 'Get User', x: 0, y: 0, mermaidKey: 'A', config: { request: request('user'), expectedStatus: '2xx' } },
        { id: 'b', type: 'condition', label: 'User is active?', x: 0, y: 0, mermaidKey: 'B', config: { condition: { source: 'body', path: 'active', operator: 'eq', value: 'true' } } },
        { id: 'c', type: 'request', label: 'Dashboard', x: 0, y: 0, mermaidKey: 'C', config: { request: request('dashboard'), expectedStatus: '2xx' } },
        { id: 'd', type: 'end', label: 'Stop', x: 0, y: 0, mermaidKey: 'D', config: { endState: 'failed' } },
        { id: 'e', type: 'end', label: 'Done', x: 0, y: 0, mermaidKey: 'E', config: { endState: 'success' } },
      ],
      edges: [
        { id: 'ab', source: 'a', target: 'b', branch: 'success' },
        { id: 'bc', source: 'b', target: 'c', branch: 'true' },
        { id: 'bd', source: 'b', target: 'd', branch: 'false' },
        { id: 'ce', source: 'c', target: 'e', branch: 'success' },
      ],
    }

    const called: string[] = []
    const result = await runApiFlow(graph, {
      initialVars: {},
      execute: async (req, vars) => {
        called.push(req.name)
        return {
          response: req.name === 'user' ? response(200, '{"active":true}') : response(200, '{"ok":true}'),
          vars,
          mutations: {},
          scriptRuns: [],
        }
      },
    })

    expect(called).toEqual(['user', 'dashboard'])
    expect(result.entries.map((entry) => entry.nodeLabel)).toEqual(['Get User', 'User is active?', 'Dashboard', 'Done'])
    expect(result.entries.every((entry) => entry.status === 'success')).toBe(true)
  })

  it('reports missing failure branches as readable run errors', async () => {
    const graph: FlowGraphDefinition = {
      settings: DEFAULT_FLOW_SETTINGS,
      nodes: [
        { id: 'a', type: 'request', label: 'Broken request', x: 0, y: 0, mermaidKey: 'A', config: { request: request('broken'), expectedStatus: '2xx' } },
      ],
      edges: [],
    }

    expect(validateFlowGraph(graph)).toEqual([])
    const result = await runApiFlow(graph, {
      initialVars: {},
      execute: async (_request, vars) => ({ response: response(500), vars, mutations: {}, scriptRuns: [] }),
    })

    expect(result.entries[result.entries.length - 1]?.error).toBe('No error branch is configured from Broken request.')
  })

  it('retries request nodes and records attempts', async () => {
    const graph: FlowGraphDefinition = {
      settings: DEFAULT_FLOW_SETTINGS,
      nodes: [
        { id: 'a', type: 'request', label: 'Retry request', x: 0, y: 0, mermaidKey: 'A', config: { request: request('retry'), expectedStatus: '2xx', retryCount: 2 } },
      ],
      edges: [],
    }

    let calls = 0
    const result = await runApiFlow(graph, {
      initialVars: {},
      execute: async (_request, vars) => {
        calls += 1
        return { response: response(calls < 3 ? 500 : 200), vars, mutations: {}, scriptRuns: [] }
      },
    })

    expect(calls).toBe(3)
    expect(result.entries[0]).toMatchObject({ status: 'success', attempts: 3 })
  })

  it('continues down the success branch when a node disables stop on failure', async () => {
    const graph: FlowGraphDefinition = {
      settings: DEFAULT_FLOW_SETTINGS,
      nodes: [
        { id: 'first', type: 'request', label: 'Non blocking', x: 0, y: 0, config: { request: request('first'), stopOnFailure: false } },
        { id: 'second', type: 'request', label: 'Follow-up', x: 0, y: 0, config: { request: request('second') } },
      ],
      edges: [{ id: 'next', source: 'first', target: 'second', branch: 'success' }],
    }
    const called: string[] = []
    await runApiFlow(graph, {
      initialVars: {},
      execute: async (current, vars) => {
        called.push(current.name)
        return { response: response(current.name === 'first' ? 500 : 200), vars, mutations: {}, scriptRuns: [] }
      },
    })
    expect(called).toEqual(['first', 'second'])
  })

  it('honours Stop Execution before invoking another request', async () => {
    const controller = new AbortController()
    controller.abort()
    const graph: FlowGraphDefinition = {
      settings: DEFAULT_FLOW_SETTINGS,
      nodes: [{ id: 'a', type: 'request', label: 'Never sent', x: 0, y: 0, config: { request: request('never') } }],
      edges: [],
    }
    const result = await runApiFlow(graph, {
      initialVars: {},
      signal: controller.signal,
      execute: async () => { throw new Error('must not execute') },
    })
    expect(result.entries[0]).toMatchObject({ nodeLabel: 'Execution stopped', status: 'skipped' })
  })

  it('passes a response extraction to the following recorded request', async () => {
    const login = request('login')
    login.method = 'POST'
    const profile = request('profile')
    profile.headers = [{ id: 'auth', key: 'Authorization', value: 'Bearer {{token}}', enabled: true }]
    const saved = createRecordedFlowDefinition('Login then profile', [
      { id: 'one', seq: 1, recordedAt: '2026-01-01T00:00:00Z', sourceRequestId: login.id, environmentId: null, environmentName: null, request: login, execution: { method: 'POST', urlTemplate: login.url } },
      { id: 'two', seq: 2, recordedAt: '2026-01-01T00:00:01Z', sourceRequestId: profile.id, environmentId: null, environmentName: null, request: profile, execution: { method: 'GET', urlTemplate: profile.url } },
    ])
    const loginNode = saved.graph.nodes.find((node) => node.config.request?.name === 'login')!
    loginNode.config.extractions = [{ id: 'token', name: 'token', source: 'body', path: 'access_token' }]
    const varsSeen: Array<Record<string, string>> = []

    await runApiFlow(saved.graph, {
      initialVars: {},
      execute: async (current, vars) => {
        varsSeen.push({ ...vars })
        return { response: current.name === 'login' ? response(200, '{"access_token":"abc"}') : response(200), vars, mutations: {}, scriptRuns: [] }
      },
    })
    expect(varsSeen[1]).toMatchObject({ token: 'abc' })
  })
})
