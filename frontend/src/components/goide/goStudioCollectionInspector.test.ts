import { describe, expect, it } from 'vitest'
import { goStudioCollectionExpressions } from './goStudioCollectionInspector'

describe('Go Studio collection inspector', () => {
  it('uses only side-effect-free Go builtins for selected collections', () => {
    expect(goStudioCollectionExpressions('slice', 'items')).toEqual([{ label: 'Len', expression: 'len(items)' }, { label: 'Cap', expression: 'cap(items)' }])
    expect(goStudioCollectionExpressions('map', 'labels')).toEqual([{ label: 'Len', expression: 'len(labels)' }])
    expect(goStudioCollectionExpressions('channel', 'jobs')).toEqual([{ label: 'Len', expression: 'len(jobs)' }, { label: 'Cap', expression: 'cap(jobs)' }])
  })

  it('does not attempt collection builtins for other Go runtime values', () => {
    expect(goStudioCollectionExpressions('error', 'err')).toEqual([])
  })
})
