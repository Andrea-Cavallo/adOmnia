import { expect, it } from 'vitest'
import { changedDebugValues } from './debugVariableChanges'

it('marks changed locals, watches and nested values without marking first observations', () => {
  const before = new Map([['Locals:n', '1'], ['Locals:user.Name', '"old"'], ['watch:len(items)', '2']])
  const after = new Map([['Locals:n', '1'], ['Locals:user.Name', '"new"'], ['watch:len(items)', '3'], ['Locals:newValue', '0']])
  expect([...changedDebugValues(before, after)]).toEqual(['Locals:user.Name', 'watch:len(items)'])
})

it('does not treat missing or lazily unloaded values as changed', () => {
  expect([...changedDebugValues(new Map([['Locals:n', '1']]), new Map())]).toEqual([])
  expect([...changedDebugValues(new Map(), new Map([['Locals:n', '1']]))]).toEqual([])
})
