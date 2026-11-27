import { describe, expect, it } from 'vitest'
import { applyCompletion, barCompletions } from './barComplete'

const fields = ['name', 'age', 'address.city']

describe('query bar completion', () => {
  it('suggests field names unquoted, dotted paths quoted', () => {
    const c = barCompletions('{ na', 4, 'filter', fields)
    expect(c?.items.map((i) => i.label)).toEqual(['name'])
    expect(c?.start).toBe(2)
    const d = barCompletions('{ addr', 6, 'filter', fields)
    expect(d?.items[0].label).toBe('"address.city"')
  })

  it('suggests operators after $ inside a field', () => {
    const c = barCompletions('{ age: { $g', 11, 'filter', fields)
    expect(c?.items.map((i) => i.label)).toEqual(['$gt', '$gte'])
  })

  it('inserts the label and a colon', () => {
    const c = barCompletions('{ na }', 4, 'filter', fields)!
    expect(applyCompletion('{ na }', 4, c, 'name')).toEqual({ text: '{ name:  }', caret: 8 })
  })

  it('stays silent in value position', () => {
    expect(barCompletions('{ name: na', 10, 'filter', fields)).toBeNull()
  })
})
