import { describe, expect, it } from 'vitest'
import { codeStudioCollectionExpressions } from './codeStudioCollectionInspector'

describe('Code Studio collection inspector', () => {
  it('uses only side-effect-free Go builtins for selected collections', () => {
    expect(codeStudioCollectionExpressions('slice', 'items')).toEqual([{ label: 'Len', expression: 'len(items)' }, { label: 'Cap', expression: 'cap(items)' }])
    expect(codeStudioCollectionExpressions('map', 'labels')).toEqual([{ label: 'Len', expression: 'len(labels)' }])
    expect(codeStudioCollectionExpressions('channel', 'jobs')).toEqual([{ label: 'Len', expression: 'len(jobs)' }, { label: 'Cap', expression: 'cap(jobs)' }])
  })

  it('does not attempt collection builtins for other Go runtime values', () => {
    expect(codeStudioCollectionExpressions('error', 'err')).toEqual([])
  })
})
