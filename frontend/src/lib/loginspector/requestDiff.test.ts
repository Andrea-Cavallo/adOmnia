import { describe, expect, it } from 'vitest'
import { diffPayloads } from './requestDiff'

describe('request payload diff', () => {
  it('reports missing fields, type changes and values with copyable JSONPath', () => {
    const differences = diffPayloads(
      { timestamp: 'old', customer: { id: 1, enabled: true }, obsolete: 'x' },
      { timestamp: 'new', customer: { id: '1', enabled: false }, added: 'y' },
    )
    expect(differences).toEqual([
      { path: '$.added', kind: 'missing-left', left: undefined, right: 'y' },
      { path: '$.customer.enabled', kind: 'value', left: true, right: false },
      { path: '$.customer.id', kind: 'type', left: 1, right: '1' },
      { path: '$.obsolete', kind: 'missing-right', left: 'x', right: undefined },
    ])
  })
})
