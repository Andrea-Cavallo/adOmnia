import { describe, expect, it } from 'vitest'
import { flowScopeVars } from './flowScopeVars'
import type { FlowGraphDefinition } from './flowStorage'

const graph = {
  nodes: [
    { id: 'a', label: '1. Login', config: { extractions: [{ id: 'x', name: 'token', source: 'body', path: 'access_token' }] } },
    { id: 'b', label: '2. Me', config: { extractions: [{ id: 'y', name: 'self', source: 'body', path: 'id' }] } },
  ],
  edges: [],
} as unknown as FlowGraphDefinition

describe('flowScopeVars', () => {
  it('defines vars extracted by other steps, not by the step itself', () => {
    const scope = flowScopeVars(graph, 'b', {})
    expect(scope.token).toBe('‹extracted by 1. Login›')
    expect(scope.self).toBeUndefined()
  })

  it('prefers the last run value', () => {
    expect(flowScopeVars(graph, 'b', { token: 'abc' }).token).toBe('abc')
  })
})
