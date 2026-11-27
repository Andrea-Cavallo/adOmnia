import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLiveTemplates } from './codeStudioLiveTemplates'

const item = (id: string, body = '$END$') => ({ id, abbreviation: id, description: id, body, languages: ['python'] })

describe('local template imports', () => {
  beforeEach(() => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: vi.fn((key: string, value: string) => { data.set(key, value) }) })
    useLiveTemplates.setState({ templates: [] })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('merges ids while keeping unrelated custom templates', () => {
    useLiveTemplates.getState().replace(JSON.stringify([item('a'), item('b')]))
    useLiveTemplates.getState().replace(JSON.stringify([item('a', 'print($VALUE$)')]))
    expect(useLiveTemplates.getState().templates).toEqual([item('a', 'print($VALUE$)'), item('b')])
    expect(JSON.parse(localStorage.getItem('adomnia.codestudio.liveTemplates.v1')!)).toHaveLength(2)
  })

  it('keeps the previous templates on invalid data or storage failure', () => {
    useLiveTemplates.getState().replace(JSON.stringify([item('a')]))
    expect(() => useLiveTemplates.getState().replace('[{}]')).toThrow()
    expect(useLiveTemplates.getState().templates).toEqual([item('a')])
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('full') })
    try {
      expect(() => useLiveTemplates.getState().replace(JSON.stringify([item('b')]))).toThrow('full')
      expect(useLiveTemplates.getState().templates).toEqual([item('a')])
    } finally { spy.mockRestore() }
  })
})
