import { describe, expect, it } from 'vitest'
import { DEFAULT_MERMAID_FLOW, graphFromMermaid, type ApiCatalogRequest } from './flowMermaid'
import { runApiFlow, validateFlowGraph } from './flowRunner'
import { blankRequest, type HttpMethod, type ResponseData } from './types'

function catalog(label: string, method: HttpMethod, url: string): ApiCatalogRequest {
  return {
    id: label,
    label,
    source: 'smoke',
    request: { ...blankRequest(method, label), name: label, url },
  }
}

function jsonResponse(status: number, body: object): ResponseData {
  const raw = JSON.stringify(body)
  return {
    status,
    statusText: String(status),
    headers: { 'Content-Type': 'application/json' },
    body: raw,
    contentType: 'application/json',
    ms: 4,
    size: raw.length,
  }
}

describe('Flow smoke workflow', () => {
  it('creates the default Mermaid flow, links catalog APIs, and runs the success branch', async () => {
    const graph = graphFromMermaid(DEFAULT_MERMAID_FLOW, [
      catalog('Login API', 'POST', 'https://api.local/login'),
      catalog('Get User Profile', 'GET', 'https://api.local/me'),
      catalog('Get Dashboard Data', 'GET', 'https://api.local/dashboard'),
    ])

    expect(validateFlowGraph(graph)).toEqual([])
    expect(graph.nodes.filter((node) => node.type === 'request').map((node) => node.config.request?.url)).toEqual([
      'https://api.local/login',
      'https://api.local/me',
      'https://api.local/dashboard',
    ])

    const executed: string[] = []
    const run = await runApiFlow(graph, {
      initialVars: {},
      execute: async (request, vars) => {
        executed.push(request.url)
        const body = request.url.endsWith('/me')
          ? { active: true }
          : { ok: true }
        return { response: jsonResponse(200, body), vars, mutations: {}, scriptRuns: [] }
      },
    })

    expect(executed).toEqual([
      'https://api.local/login',
      'https://api.local/me',
      'https://api.local/dashboard',
    ])
    expect(run.entries.map((entry) => `${entry.nodeLabel}:${entry.status}`)).toEqual([
      'Login API:success',
      'Get User Profile:success',
      'User is active?:success',
      'Get Dashboard Data:success',
    ])
  })
})
