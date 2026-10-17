import { describe, expect, it } from 'vitest'
import { filterFilePickItems, pickGoIDEFile, useCodeStudioFilePickStore } from './codeStudioFilePicker'

const ITEMS = [
  { id: 'lib.go', name: 'lib.go', detail: 'lib.go' },
  { id: 'pkg/errors/errors.go', name: 'errors.go', detail: 'pkg/errors/errors.go' },
  { id: 'doc.go', name: 'doc.go', detail: 'doc.go' },
]

describe('filterFilePickItems', () => {
  it('keeps every file without a query and matches each term in name or path', () => {
    expect(filterFilePickItems(ITEMS, '')).toHaveLength(3)
    expect(filterFilePickItems(ITEMS, 'errors').map((item) => item.id)).toEqual(['pkg/errors/errors.go'])
    expect(filterFilePickItems(ITEMS, 'errors pkg').map((item) => item.id)).toEqual(['pkg/errors/errors.go'])
    expect(filterFilePickItems(ITEMS, 'missing')).toEqual([])
  })
})

describe('pickGoIDEFile', () => {
  it('settles with the chosen id and null when cancelled', async () => {
    const picked = pickGoIDEFile({ title: 'Files', items: ITEMS })
    expect(useCodeStudioFilePickStore.getState().open).toBe(true)
    useCodeStudioFilePickStore.getState().settle('doc.go')
    await expect(picked).resolves.toBe('doc.go')

    const cancelled = pickGoIDEFile({ title: 'Files', items: ITEMS })
    useCodeStudioFilePickStore.getState().settle(null)
    await expect(cancelled).resolves.toBeNull()
    expect(useCodeStudioFilePickStore.getState().open).toBe(false)
  })
})
