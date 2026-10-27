import { describe, expect, it } from 'vitest'
import type { SpringIndex } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/languages/java/models'
import { buildBeanGraph, edgePath, shortType } from './beanGraph'

const bean = (type: string, kind: string, extra: Record<string, unknown> = {}) => ({ name: shortType(type).toLowerCase(), type, kind, ...extra })
const inject = (owner: string, type: string, extra: Record<string, unknown> = {}) => ({ kind: 'constructor', class: owner, type, required: true, ...extra })

const index = {
  beans: [bean('com.acme.OrderController', 'controller'), bean('com.acme.OrderService', 'service'), bean('com.acme.OrderRepository', 'repository'), bean('com.acme.Orphan', 'component')],
  injections: [
    inject('com.acme.OrderController', 'OrderService'),
    inject('com.acme.OrderService', 'OrderRepository'),
    inject('com.acme.OrderService', 'OrderRepository'),
    inject('com.acme.OrderService', 'Mailer'),
  ],
} as unknown as SpringIndex

describe('buildBeanGraph', () => {
  const graph = buildBeanGraph(index)
  it('links the injecting bean to the injected one, once per pair', () => {
    expect(graph.edges.map((edge) => `${shortType(edge.from.split('|')[0])}>${shortType(edge.to.split('|')[0])}`)).toEqual(['OrderController>OrderService', 'OrderService>OrderRepository'])
  })
  it('layers controller, service, repository left to right', () => {
    const level = (name: string) => graph.nodes.find((node) => node.bean.type.endsWith(name))?.level
    expect([level('OrderController'), level('OrderService'), level('OrderRepository'), level('Orphan')]).toEqual([0, 1, 2, 0])
    expect(graph.width).toBeGreaterThan(graph.nodes[0].x)
  })
  it('reports injections nobody satisfies', () => {
    expect(graph.unresolved.map((item) => item.type)).toEqual(['Mailer'])
  })
  it('survives a dependency cycle', () => {
    const cyclic = { beans: [bean('a.A', 'service'), bean('a.B', 'service')], injections: [inject('a.A', 'B'), inject('a.B', 'A')] } as unknown as SpringIndex
    const result = buildBeanGraph(cyclic)
    expect(result.nodes).toHaveLength(2)
    expect(result.edges).toHaveLength(2)
  })
  it('draws a curve between two nodes', () => {
    expect(edgePath(graph.nodes[0], graph.nodes[1])).toMatch(/^M [\d.]+ [\d.]+ C /)
  })
})
