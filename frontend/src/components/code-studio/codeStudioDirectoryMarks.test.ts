import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDirectoryMarks, saveDirectoryMark } from './codeStudioDirectoryMarks'

describe('directory marks', () => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), clear: () => values.clear() })
  beforeEach(() => localStorage.clear())

  it('persists marks per project and removes them', () => {
    expect(saveDirectoryMark('C:/work/a', 'internal', 'sources')).toEqual({ internal: 'sources' })
    saveDirectoryMark('C:/work/a', 'testdata', 'tests')
    expect(loadDirectoryMarks('C:/work/a')).toEqual({ internal: 'sources', testdata: 'tests' })
    expect(loadDirectoryMarks('C:/work/b')).toEqual({})
    expect(saveDirectoryMark('C:/work/a', 'internal', null)).toEqual({ testdata: 'tests' })
  })
})
