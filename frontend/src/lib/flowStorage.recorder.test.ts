import { describe, expect, it } from 'vitest'
import { blankRequest } from './types'
import { createBlankFlowGraph, createRecordedFlowDefinition, normalizeFlowDefinitions } from './flowStorage'
import type { RecordedApiCall } from '@/stores/flowRecorder'

function call(seq: number): RecordedApiCall {
  const request = blankRequest(seq === 1 ? 'POST' : 'GET', `Request ${seq}`)
  request.url = `{{baseUrl}}/step-${seq}`
  return {
    id: `call-${seq}`, seq, recordedAt: '2026-01-01T00:00:00.000Z', sourceRequestId: `request-${seq}`,
    environmentId: 'env', environmentName: 'Test', request,
    execution: { method: request.method, urlTemplate: request.url, status: 200, durationMs: seq },
  }
}

describe('recorded flow persistence', () => {
  it('creates a linear, ordered, replayable graph', () => {
    const flow = createRecordedFlowDefinition('Recorded', [call(2), call(1)])
    const requests = flow.graph.nodes.filter((node) => node.type === 'request')
    expect(requests.map((node) => node.config.seq)).toEqual([1, 2])
    expect(requests.map((node) => node.config.request?.url)).toEqual(['{{baseUrl}}/step-1', '{{baseUrl}}/step-2'])
    expect(flow.graph.edges).toHaveLength(3)
    expect(flow.schemaVersion).toBe(4)
  })

  it('migrates v3 flow data without losing a graph', () => {
    const legacy = normalizeFlowDefinitions([{ id: 'old', name: 'Old flow', version: 3, graph: createRecordedFlowDefinition('x', [call(1)]).graph }])
    expect(legacy[0].version).toBe(4)
    expect(legacy[0].schemaVersion).toBe(4)
    expect(legacy[0].graph.nodes.some((node) => node.type === 'request')).toBe(true)
  })

  it('creates a real empty canvas with Start and Stop connected', () => {
    const graph = createBlankFlowGraph()
    expect(graph.nodes.map((node) => node.type)).toEqual(['start', 'end'])
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]).toMatchObject({ source: graph.nodes[0].id, target: graph.nodes[1].id })
  })
})
