import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addCustomTool, readCustomTools, removeCustomTool, splitArguments } from './goStudioExtraToolList'

describe('goStudioExtraTools', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
  })

  it('splits arguments like a shell would, without a shell', () => {
    expect(splitArguments('-source=a.go -destination="mocks/a mock.go"  ./...')).toEqual(['-source=a.go', '-destination=mocks/a mock.go', './...'])
  })

  it('validates and stores custom tools', () => {
    expect(addCustomTool({ binary: '../x', module: '', purpose: '', defaultArgs: '' })).toMatch(/Binary/)
    expect(addCustomTool({ binary: 'air', module: 'github.com/air-verse/air', purpose: '', defaultArgs: '' })).toMatch(/Module/)
    expect(addCustomTool({ binary: 'stringer', module: '', purpose: '', defaultArgs: '' })).toMatch(/already/)
    expect(addCustomTool({ binary: 'air', module: 'github.com/air-verse/air@latest', purpose: 'reload', defaultArgs: '' })).toBeNull()
    expect(readCustomTools()).toMatchObject([{ binary: 'air', custom: true }])
    removeCustomTool('air')
    expect(readCustomTools()).toEqual([])
  })
})
