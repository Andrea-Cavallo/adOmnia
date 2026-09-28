import { describe, expect, it } from 'vitest'
import { resolveConsolePath } from './goStudioConsolePaths'

describe('resolveConsolePath', () => {
  it('resolves compiler paths against the run working directory', () => {
    expect(resolveConsolePath('./main.go', '/home/dev/app/cmd/api')).toBe('/home/dev/app/cmd/api/main.go')
    expect(resolveConsolePath('../../internal/x.go', '/home/dev/app/cmd/api')).toBe('/home/dev/app/internal/x.go')
    expect(resolveConsolePath('pkg/y.go', '/home/dev/app/')).toBe('/home/dev/app/pkg/y.go')
  })

  it('keeps absolute paths from panics and stack traces', () => {
    expect(resolveConsolePath('/home/dev/app/main.go', '/tmp')).toBe('/home/dev/app/main.go')
    expect(resolveConsolePath('C:\\work\\app\\main.go', 'D:\\x')).toBe('C:/work/app/main.go')
  })

  it('supports Windows working directories', () => {
    expect(resolveConsolePath('.\\main.go', 'C:\\work\\app')).toBe('C:/work/app/main.go')
  })
})
