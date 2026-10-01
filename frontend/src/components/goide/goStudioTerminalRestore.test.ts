import { describe, expect, it, vi } from 'vitest'

const values = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
import { readSavedTerminals, snapshotTerminals, writeSavedTerminals } from './goStudioTerminalRestore'

describe('terminal restore', () => {
  it('saves project-relative metadata and keeps known profiles', () => {
    const snapshot = snapshotTerminals(
      [
        { id: 'a', name: 'api', workingDirectory: 'C:\\proj\\cmd\\api' },
        { id: 'b', name: 'outside', workingDirectory: 'D:\\elsewhere' },
      ],
      new Map([['a', 'pwsh']]),
      [{ id: 'b', name: 'old', profile: 'bash', workingDirectory: '' }],
      ['C:\\proj'],
    )
    expect(snapshot).toEqual([
      { id: 'a', name: 'api', profile: 'pwsh', workingDirectory: 'cmd/api' },
      { id: 'b', name: 'outside', profile: 'bash', workingDirectory: '' },
    ])
    writeSavedTerminals('/p', snapshot)
    expect(readSavedTerminals('/p')).toEqual(snapshot)
  })

  it('ignores corrupt storage', () => {
    localStorage.setItem('adomnia.goide.terminals:/bad', '{nope')
    expect(readSavedTerminals('/bad')).toEqual([])
    localStorage.setItem('adomnia.goide.terminals:/bad', JSON.stringify([{ name: 1 }, null]))
    expect(readSavedTerminals('/bad')).toEqual([])
  })
})
