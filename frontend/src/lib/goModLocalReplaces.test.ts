import { describe, expect, it } from 'vitest'
import { activeLocalReplaces, isLocalReplaceTarget, syncLocalReplaces } from './goModLocalReplaces'

const base = `module example.com/app

go 1.22

require github.com/acme/lib v1.4.0

replace github.com/acme/lib => github.com/fork/lib v1.4.1
`

describe('go.mod local replaces', () => {
  it('recognises local paths on every platform', () => {
    for (const target of ['../lib', './lib', '/home/me/lib', 'C:\\src\\lib', 'D:/src/lib', '..']) expect(isLocalReplaceTarget(target)).toBe(true)
    for (const target of ['github.com/fork/lib', 'example.com/x']) expect(isLocalReplaceTarget(target)).toBe(false)
  })

  it('turns the real replace off while a local one exists and back on when it is removed', () => {
    const withLocal = `${base}replace github.com/acme/lib => ../lib\n`
    const synced = syncLocalReplaces(withLocal)
    expect(synced).toContain('// adomnia-off: replace github.com/acme/lib => github.com/fork/lib v1.4.1')
    expect(synced).toContain('replace github.com/acme/lib => ../lib')
    expect(syncLocalReplaces(synced)).toBe(synced)

    const removed = synced.replace('replace github.com/acme/lib => ../lib\n', '')
    expect(syncLocalReplaces(removed)).toBe(base)
  })

  it('handles replace blocks, keeps indentation and other modules, and keeps CRLF', () => {
    const text = 'module m\r\n\r\nreplace (\r\n\tgithub.com/acme/lib => github.com/fork/lib v1.4.1\r\n\tgithub.com/other/x => github.com/other/x v2.0.0\r\n\tgithub.com/acme/lib => ../lib\r\n)\r\n'
    const synced = syncLocalReplaces(text)
    expect(synced).toBe('module m\r\n\r\nreplace (\r\n\t// adomnia-off: github.com/acme/lib => github.com/fork/lib v1.4.1\r\n\tgithub.com/other/x => github.com/other/x v2.0.0\r\n\tgithub.com/acme/lib => ../lib\r\n)\r\n')
    expect(activeLocalReplaces(synced).map((entry) => entry.target)).toEqual(['../lib'])
  })

  it('leaves files without a local replace untouched', () => {
    expect(syncLocalReplaces(base)).toBe(base)
    expect(activeLocalReplaces(base)).toEqual([])
  })
})
