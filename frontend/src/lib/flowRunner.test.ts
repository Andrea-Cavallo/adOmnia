import { describe, expect, it } from 'vitest'
import { DEFAULT_FLOW_SETTINGS, type FlowGraphDefinition } from './flowStorage'
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
})
