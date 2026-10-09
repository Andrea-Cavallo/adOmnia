import { describe, expect, it } from 'vitest'
import type { GoIDEArchitecture } from '@/lib/goide-api'
import { lineContext, moduleOnLine, testAt } from './lineContext'

const site = (line: number, relativePath = 'orders.go') => ({ relativePath, line, column: 1 })
const report = {
  functions: [
    { id: 'a', name: 'main', package: 'm', site: site(10) },
    { id: 'b', name: 'createOrder', package: 'm', site: site(30) },
    { id: 'c', name: 'Store.Save', package: 'm', site: site(60) },
  ],
  entries: [
    { kind: 'http', name: 'POST /orders', package: 'm', site: site(15), handler: 'createOrder', handlerSite: site(30) },
    { kind: 'kafka-producer', name: 'orders', package: 'm', topics: ['orders.created'], site: site(45) },
    { kind: 'kafka-consumer', name: 'billing', package: 'm', topics: ['orders.created'], site: site(70) },
  ],
  queries: [{ library: 'database/sql', operation: 'insert', method: 'Exec', sql: 'INSERT INTO orders', tables: ['orders'], function: 'Store.Save', package: 'm', site: site(62) }],
  interfaces: [{ name: 'Saver', package: 'm', site: site(5), methods: ['Save'], embeds: [], implementations: [{ type: 'Store', package: 'm', pointer: true, site: site(55) }], users: [], userCount: 0, methodUses: [], nearMisses: [], hints: [] }],
} as unknown as GoIDEArchitecture

describe('line context', () => {
  it('finds the route a handler serves and what it publishes', () => {
    const context = lineContext(report, 'orders.go', 40)
    expect(context.fn?.name).toBe('createOrder')
    expect(context.routes.map((route) => route.name)).toEqual(['POST /orders'])
    expect(context.kafka.map((entry) => entry.kind)).toEqual(['kafka-producer'])
    expect(context.queries).toEqual([])
  })
  it('finds the route on its registration line, queries and consumers by function', () => {
    expect(lineContext(report, 'orders.go', 15).routes).toHaveLength(1)
    const save = lineContext(report, 'orders.go', 63)
    expect(save.queries.map((query) => query.sql)).toEqual(['INSERT INTO orders'])
    expect(save.kafka.map((entry) => entry.kind)).toEqual(['kafka-consumer'])
  })
  it('knows interfaces, implementations, goroutines, tests and modules', () => {
    expect(lineContext(report, 'orders.go', 5).iface?.name).toBe('Saver')
    expect(lineContext(report, 'orders.go', 55).implemented.map((item) => item.name)).toEqual(['Saver'])
    expect(lineContext(report, 'orders.go', 41, '\tgo func() { served++ }()').goroutine).toBe(true)
    expect(lineContext(report, 'orders.go', 41, '\tlog.Println("go home")').goroutine).toBe(false)
    expect(testAt('orders_test.go', ['package m', 'func TestCreate(t *testing.T) {', '\tx := 1'], 3)).toBe('TestCreate')
    expect(testAt('orders_test.go', ['func helper() {', '\tx := 1'], 2)).toBeUndefined()
    expect(moduleOnLine('\tgithub.com/segmentio/kafka-go v0.4.47 // indirect')).toBe('github.com/segmentio/kafka-go')
    expect(lineContext(null, 'go.mod', 3, 'require golang.org/x/net v0.30.0').module).toBe('golang.org/x/net')
  })
})
