import { describe, expect, it } from 'vitest'
import { analyzeLog } from './analyze'
import { buildChainProposal, chainProposalToFlow, chainProposalToMockEndpoints } from './chainToFlow'
import { parseLogText } from './parse'

const CHAIN = [
  {
    correlation_id: 'chain-1', span_id: 'span-a', service: { name: 'gateway' }, message: 'login',
    http: { method: 'POST', url: 'https://api.test/auth/login', status_code: 200 },
    attributes: { http: { request: { body: { user: 'andrea' } }, response: { body: { orderToken: 'tok-9f8e7d6c', quantity: 2 } } } },
  },
  {
    correlation_id: 'chain-1', span_id: 'span-b', service: { name: 'orders' }, message: 'create order',
    http: { method: 'POST', url: 'https://api.test/orders', status_code: 201 },
    attributes: { http: { request: { body: { orderToken: 'tok-9f8e7d6c', quantity: 2 } }, response: { body: { orderId: 'ord-1234' } } } },
  },
].map((event) => JSON.stringify(event)).join('\n')

function proposal() {
  const events = parseLogText(CHAIN).events
  const request = analyzeLog(events).requests[0]
  return { events, proposal: buildChainProposal(events, request) }
}

describe('buildChainProposal', () => {
  it('produces one step per paired call in chronological order', () => {
    const { proposal: built } = proposal()
    expect(built.steps).toHaveLength(2)
    expect(built.steps.map((step) => step.url)).toEqual(['https://api.test/auth/login', 'https://api.test/orders'])
    expect(built.steps[1].status).toBe(201)
  })

  it('confirms a mapping when the field names align on a distinctive value', () => {
    const { proposal: built } = proposal()
    const confirmed = built.mappings.filter((mapping) => mapping.confidence === 'confirmed')
    expect(confirmed).toHaveLength(1)
    expect(confirmed[0]).toMatchObject({ fromPath: '$.orderToken', toPath: '$.orderToken' })
  })

  it('does not claim a dependency for a shared plain number', () => {
    const { proposal: built } = proposal()
    expect(built.mappings.some((mapping) => mapping.value === '2')).toBe(false)
  })
})

describe('chainProposalToFlow', () => {
  it('templates confirmed mappings and keeps coincidences as notes', () => {
    const { proposal: built } = proposal()
    const flow = chainProposalToFlow(built, 'Chain')
    const steps = flow.graph.nodes.filter((node) => node.type === 'request')
    expect(steps[0].config.extractions?.[0]).toMatchObject({ name: 'orderToken', path: 'orderToken' })
    expect(steps[1].config.request?.bodies[0].raw).toContain('{{orderToken}}')
    expect(flow.graph.edges).toHaveLength(3)
  })
})

describe('chainProposalToMockEndpoints', () => {
  it('creates a fixture per observed response', () => {
    const { proposal: built } = proposal()
    const endpoints = chainProposalToMockEndpoints(built)
    expect(endpoints.map((endpoint) => endpoint.path)).toEqual(['/auth/login', '/orders'])
    expect(endpoints[1].responses[0]).toMatchObject({ status: 201 })
    expect(endpoints[1].responses[0].body).toContain('ord-1234')
  })
})
