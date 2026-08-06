import { describe, expect, it } from 'vitest'
import { substVars } from './substVars'

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
