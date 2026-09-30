import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/goide-api', () => ({}))
vi.mock('@/lib/confirmDialog', () => ({ confirm: vi.fn() }))
vi.mock('@/stores/goide', () => ({ useGoIDEStore: { getState: vi.fn(), setState: vi.fn() } }))

import { absolutePath, duplicateName, packageNameForDirectory, parentOf } from './goStudioFileActions'

describe('goStudioFileActions helpers', () => {
  it('derives parents, copies and package names', () => {
    expect(parentOf('a/b/c.go')).toBe('a/b')
    expect(parentOf('c.go')).toBe('')
    expect(duplicateName('main.go')).toBe('main_copy.go')
    expect(duplicateName('internal')).toBe('internal_copy')
    expect(packageNameForDirectory('')).toBe('main')
    expect(packageNameForDirectory('internal/http-api')).toBe('httpapi')
    expect(packageNameForDirectory('v2')).toBe('v2')
    expect(packageNameForDirectory('x/2fa')).toBe('pkg2fa')
  })

  it('builds absolute paths with the root separator', () => {
    expect(absolutePath('C:\\work\\app', 'cmd/main.go')).toBe('C:\\work\\app\\cmd\\main.go')
    expect(absolutePath('/home/u/app/', 'cmd/main.go')).toBe('/home/u/app/cmd/main.go')
    expect(absolutePath('/home/u/app', '')).toBe('/home/u/app')
  })
})
