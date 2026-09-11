import { describe, expect, it } from 'vitest'
import { DEFAULT_FLOW_SETTINGS, type FlowGraphDefinition } from './flowStorage'
import { DEFAULT_STRESS_CONFIG, runFlowStress, validateStressConfig, type FlowStressConfig, type RunFlowStressOptions } from './flowStress'
import { blankRequest, type RequestItem, type ResponseData } from './types'

const response = (status: number, body = '{}'): ResponseData => ({ status, statusText: String(status), headers: {}, body, contentType: 'application/json', ms: 4, size: body.length })
const request = (name: string): RequestItem => ({ ...blankRequest('GET', name), name, url: `https://api.local/${name}` })
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const graph: FlowGraphDefinition = {
  settings: DEFAULT_FLOW_SETTINGS,
  nodes: [
    { id: 'login', type: 'request', label: 'Login', x: 0, y: 0, config: { request: request('login'), extractions: [{ id: 't', name: 'token', source: 'body', path: 'token' }] } },
    { id: 'me', type: 'request', label: 'Me', x: 0, y: 0, config: { request: request('me') } },
  ],
  edges: [{ id: 'e', source: 'login', target: 'me', branch: 'next' }],
}

function fakeServer(delayMs = 0) {
  let issued = 0
  const seenTokens: string[] = []
  const execute: RunFlowStressOptions['execute'] = async (req, vars) => {
    if (delayMs) await wait(delayMs * (1 + (issued % 3)))
    if (req.name === 'login') return { response: response(200, JSON.stringify({ token: `t${issued++}` })), vars, mutations: {}, scriptRuns: [] }
    seenTokens.push(vars.token)
    return { response: response(200), vars, mutations: {}, scriptRuns: [] }
  }
  return { execute, seenTokens, issued: () => issued }
}

const config = (patch: Partial<FlowStressConfig>): FlowStressConfig => ({ ...DEFAULT_STRESS_CONFIG, ...patch })

describe('runFlowStress', () => {
  it('runs exactly the requested iterations across VUs', async () => {
    const server = fakeServer()
    const progress: number[] = []
    const run = await runFlowStress(graph, config({ vus: 3, iterations: 7 }), { initialVars: {}, execute: server.execute, onProgress: (p) => progress.push(p.iterationsDone) })
    expect(server.issued()).toBe(7)
    expect(run.status).toBe('completed')
    expect(run.stats).toMatchObject({ iterationsOk: 7, iterationsFailed: 0, totalRequests: 14 })
    expect(run.samples).toHaveLength(14)
    expect(new Set(run.samples.map((s) => s.iteration))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]))
    expect(run.samples[0].latencyMs).toBe(4)
    expect(progress[progress.length - 1]).toBe(7)
  })

  it('keeps extracted variables private to each iteration', async () => {
    const server = fakeServer(2)
    await runFlowStress(graph, config({ vus: 5, iterations: 20 }), { initialVars: { base: 'x' }, execute: server.execute })
    expect(server.seenTokens).toHaveLength(20)
    expect(new Set(server.seenTokens).size).toBe(20)
  })

  it('stops on user abort and reports it', async () => {
    const server = fakeServer(3)
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 40)
    const run = await runFlowStress(graph, config({ vus: 2, iterations: 100_000 }), { initialVars: {}, execute: server.execute, signal: controller.signal })
    expect(run.status).toBe('stopped')
    expect(run.stats.iterationsOk).toBeLessThan(100_000)
    expect(run.samples.every((s) => s.status === 'success')).toBe(true)
  })

  it('ends a duration run at the deadline', async () => {
    const server = fakeServer(5)
    const started = Date.now()
    const run = await runFlowStress(graph, config({ vus: 2, mode: 'duration', durationS: 1 }), { initialVars: {}, execute: server.execute })
    expect(Date.now() - started).toBeGreaterThanOrEqual(950)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(run.status).toBe('completed')
    expect(run.stats.iterationsOk).toBeGreaterThan(0)
  })

  it('staggers VU start with ramp-up', async () => {
    const server = fakeServer(10)
    const run = await runFlowStress(graph, config({ vus: 2, rampUpS: 0.2, iterations: 20 }), { initialVars: {}, execute: server.execute })
    const firstOf = (vu: number) => Math.min(...run.samples.filter((s) => s.vu === vu).map((s) => s.t))
    expect(firstOf(1)).toBeGreaterThanOrEqual(90)
    expect(firstOf(0)).toBeLessThan(firstOf(1))
  })

  it('caps raw samples but keeps full stats', async () => {
    const run = await runFlowStress(graph, config({ vus: 1, iterations: 5 }), { initialVars: {}, execute: fakeServer().execute, sampleCap: 3 })
    expect(run.samples).toHaveLength(3)
    expect(run.truncated).toBe(true)
    expect(run.stats.totalRequests).toBe(10)
  })

  it('rejects out-of-range configs', async () => {
    expect(validateStressConfig(config({ vus: 26 }))).toHaveLength(1)
    expect(validateStressConfig(config({ mode: 'duration', durationS: 0 }))).toHaveLength(1)
    expect(validateStressConfig(DEFAULT_STRESS_CONFIG)).toEqual([])
    await expect(runFlowStress(graph, config({ vus: 0 }), { initialVars: {} })).rejects.toThrow('Virtual users')
  })
})
