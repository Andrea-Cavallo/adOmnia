import { describe, expect, it } from 'vitest'
import { goName, jsonToGo } from './jsonToGo'

describe('jsonToGo', () => {
  it('names fields like Go does', () => {
    expect(goName('order_id')).toBe('OrderID')
    expect(goName('customerUrl')).toBe('CustomerURL')
    expect(goName('first-name')).toBe('FirstName')
    expect(goName('2fa')).toBe('F2fa')
    expect(goName('type')).toBe('Type')
  })

  it('builds nested structs, slices, optional and time fields', () => {
    const go = jsonToGo(JSON.stringify({
      order_id: 7,
      total: 9.5,
      created_at: '2026-10-09T06:00:00Z',
      customer: { id: 'c1', vip: true },
      items: [{ sku: 'A', qty: 1 }, { sku: 'B', qty: 2, note: 'gift' }],
      tags: ['x'],
      coupon: null,
    }), 'OrderCreated')
    expect(go).toBe(`import "time"

type OrderCreated struct {
\tOrderID   int64     \`json:"order_id"\`
\tTotal     float64   \`json:"total"\`
\tCreatedAt time.Time \`json:"created_at"\`
\tCustomer  Customer  \`json:"customer"\`
\tItems     []Item    \`json:"items"\`
\tTags      []string  \`json:"tags"\`
\tCoupon    any       \`json:"coupon"\`
}

type Customer struct {
\tID  string \`json:"id"\`
\tVip bool   \`json:"vip"\`
}

type Item struct {
\tSKU  string \`json:"sku"\`
\tQty  int64  \`json:"qty"\`
\tNote string \`json:"note,omitempty"\`
}
`)
  })

  it('handles arrays at the root, mixed numbers and name clashes', () => {
    const go = jsonToGo('[{"n":1,"user":{"a":1}},{"n":2.5,"user":{"a":2}}]', 'Batch')
    expect(go).toContain('type Batch []BatchItem')
    expect(go).toContain('N    float64')
    expect(go).toContain('type User struct')
    expect(jsonToGo('{"user":{"x":1},"meta":{"user":{"y":2}}}')).toContain('type User2 struct')
  })

  it('rejects invalid JSON', () => {
    expect(() => jsonToGo('{nope')).toThrow()
  })
})
