import { afterEach, describe, expect, it } from 'vitest'
import { runApiFlow } from './flowRunner'
import { createRecordedFlowDefinition } from './flowStorage'
import { blankRequest, type ResponseData } from './types'
import { useFlowRecorderStore } from '@/stores/flowRecorder'

function response(status = 200): ResponseData {
  return { status, statusText: String(status), headers: {}, body: '{"ok":true}', contentType: 'application/json', ms: 1, size: 11 }
}

describe('record → save → replay journey', () => {
  afterEach(() => useFlowRecorderStore.getState().cancel())

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
