import { describe, expect, it } from 'vitest'
import { substVars, varNameAtIndex } from './substVars'

describe('substVars', () => {
  it('keeps JSON types after environment substitution', () => {
    const result = substVars(`{
      "price": {{PRICE}},
      "quantity": {{QUANTITY}},
      "enabled": {{ENABLED}},
      "archived": {{ARCHIVED}},
      "optional": {{OPTIONAL}},
      "name": "{{NAME}}"
    }`, {
      PRICE: '0',
      QUANTITY: '12.5',
      ENABLED: 'true',
      ARCHIVED: 'false',
      OPTIONAL: 'null',
      NAME: 'Mario Rossi',
    })

    expect(JSON.parse(result)).toEqual({
      price: 0,
      quantity: 12.5,
      enabled: true,
      archived: false,
      optional: null,
      name: 'Mario Rossi',
    })
  })
})

describe('varNameAtIndex', () => {
  const body = '{\n  "plan_id": "{{PLAN_ID}}",\n  "customer_id": "{{customer_id}}"\n}'

  it('finds the token under the caret', () => {
    expect(varNameAtIndex(body, body.indexOf('PLAN_ID'))).toBe('PLAN_ID')
    expect(varNameAtIndex(body, body.indexOf('{{customer_id}}'))).toBe('customer_id')
  })

  it('trims padded names and ignores positions outside a token', () => {
    expect(varNameAtIndex('a {{ SPACED }} b', 5)).toBe('SPACED')
    expect(varNameAtIndex(body, 0)).toBeNull()
    expect(varNameAtIndex('no vars here', 4)).toBeNull()
  })
})
