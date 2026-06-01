import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MERMAID_FLOW,
  expectedStatusMatches,
  graphFromMermaid,
  matchCatalogRequest,
  type ApiCatalogRequest,
} from './flowMermaid'
import { blankRequest, type HttpMethod } from './types'

function catalogRequest(label: string, method: HttpMethod = 'GET', url = `https://api.local/${label.toLowerCase().replace(/\s+/g, '-')}`): ApiCatalogRequest {
  return {
    id: label,
    label,
    source: 'test',
    request: { ...blankRequest(method, label), name: label, url },
  }
}

describe('flowMermaid', () => {
  it('converts Mermaid nodes, branches, and conditions into an executable graph', () => {
    const graph = graphFromMermaid(`
flowchart TD
  A[Login API] --> B[Get User Profile]
  B --> C{User is active?}
  C -->|Yes| D[Get Dashboard Data]
  C -->|No| E[Show Error / Stop Flow]
`, [
      catalogRequest('Login API', 'POST', 'https://api.local/login'),
      catalogRequest('Get User Profile'),
      catalogRequest('Get Dashboard Data'),
    ])

    expect(graph.nodes.map((node) => node.label)).toEqual([
      'Login API',
      'Get User Profile',
      'User is active?',
      'Get Dashboard Data',
      'Show Error / Stop Flow',
    ])
    expect(graph.nodes.find((node) => node.label === 'User is active?')?.type).toBe('condition')
    expect(graph.edges.filter((edge) => edge.source === graph.nodes[2].id).map((edge) => edge.branch).sort()).toEqual(['false', 'true'])
    expect(graph.nodes.find((node) => node.label === 'Login API')?.config.request?.method).toBe('POST')
  })

  it('ships a New Flow template that generates a usable graph', () => {
    const graph = graphFromMermaid(DEFAULT_MERMAID_FLOW, [
      catalogRequest('Login API', 'POST', 'https://api.local/login'),
      catalogRequest('Get User Profile'),
      catalogRequest('Get Dashboard Data'),
    ])

    expect(graph.nodes.length).toBeGreaterThanOrEqual(5)
    expect(graph.nodes.some((node) => node.type === 'condition')).toBe(true)
    expect(graph.nodes.filter((node) => node.type === 'request').every((node) => Boolean(node.config.request?.url))).toBe(true)
  })

  it('matches catalog requests by label and url tokens', () => {
    const request = matchCatalogRequest('profile', [
      catalogRequest('Login API', 'POST', 'https://api.local/auth/login'),
      catalogRequest('Get User Profile', 'GET', 'https://api.local/users/me'),
    ])

    expect(request?.label).toBe('Get User Profile')
  })

  it('preserves Mermaid node keys when labels repeat', () => {
    const graph = graphFromMermaid(`
flowchart TD
  A[Retry] --> B[Retry]
`)

    expect(graph.nodes.map((node) => node.label)).toEqual(['Retry', 'Retry'])
    expect(graph.nodes.map((node) => node.mermaidKey)).toEqual(['A', 'B'])
    expect(graph.nodes[0].id).not.toBe(graph.nodes[1].id)
  })

  it('evaluates status patterns and ranges', () => {
    expect(expectedStatusMatches('2xx', 204)).toBe(true)
    expect(expectedStatusMatches('200,201', 201)).toBe(true)
    expect(expectedStatusMatches('400-499', 404)).toBe(true)
    expect(expectedStatusMatches('2xx', 500)).toBe(false)
  })
})
