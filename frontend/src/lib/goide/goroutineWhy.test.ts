import { describe, expect, it } from 'vitest'
import { cancellationPath, contextType, goroutineOrigin } from './goroutineWhy'

describe('goroutineWhy', () => {
  it('finds the route and the consumer a goroutine serves', () => {
    const routes = [{ label: 'GET /orders', attrs: { declName: 'ListOrders' } }]
    const entries = [{ kind: 'kafka-consumer', function: 'Bill', topics: ['orders.created'] }]
    const request = goroutineOrigin([{ name: 'example.com/app/store.Find' }, { name: 'example.com/app/api.ListOrders' }, { name: 'net/http.HandlerFunc.ServeHTTP' }, { name: 'net/http.(*conn).serve' }], routes, entries)
    expect(request.request).toEqual({ route: 'GET /orders', handler: 'ListOrders' })
    expect(request.message).toBeNull()
    const message = goroutineOrigin([{ name: 'encoding/json.Unmarshal' }, { name: 'example.com/app/billing.Bill' }], routes, entries)
    expect(message).toEqual({ request: null, message: { topics: ['orders.created'], consumer: 'Bill' } })
  })

  it('reads context types and how they can be cancelled', () => {
    expect(contextType({ type: 'context.Context', value: 'context.Context(*context.timerCtx) 0xc000123' })).toBe('*context.timerCtx')
    expect(contextType({ type: 'int', value: '3' })).toBeNull()
    expect(cancellationPath([{ type: '*context.timerCtx', deadline: '2026-10-11 10:00:05' }, { type: '*context.cancelCtx' }, { type: 'context.backgroundCtx' }])).toEqual([
      'its deadline (2026-10-11 10:00:05) expires', 'someone calls its cancel function (WithCancel), or the request or shutdown that owns it ends',
    ])
    expect(cancellationPath([{ type: 'context.backgroundCtx' }])[0]).toContain('never')
  })
})
