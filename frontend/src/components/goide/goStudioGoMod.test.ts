import { describe, expect, it } from 'vitest'
import { goModActionNeedsConfirmation, goModCommandLine, goModLenses, parseGoMod } from './goStudioGoMod'

const GO_MOD = `// header comment
module example.com/app

go 1.23

require github.com/single/dep v1.0.0

require (
\tgithub.com/pkg/errors v0.9.1
\tgolang.org/x/text v0.14.0 // indirect
)

replace github.com/pkg/errors => ../errors

replace (
\tgolang.org/x/text v0.14.0 => golang.org/x/text v0.15.0
)
`

describe('parseGoMod', () => {
  it('finds module, single and block requires and replaces with their lines', () => {
    const outline = parseGoMod(GO_MOD)
    expect(outline.moduleLine).toBe(2)
    expect(outline.requirements).toEqual([
      { line: 6, path: 'github.com/single/dep', version: 'v1.0.0', indirect: false },
      { line: 9, path: 'github.com/pkg/errors', version: 'v0.9.1', indirect: false },
      { line: 10, path: 'golang.org/x/text', version: 'v0.14.0', indirect: true },
    ])
    expect(outline.replacements).toEqual([
      { line: 13, path: 'github.com/pkg/errors', target: '../errors' },
      { line: 16, path: 'golang.org/x/text', target: 'golang.org/x/text v0.15.0' },
    ])
  })

  it('tolerates an empty or partial go.mod', () => {
    expect(parseGoMod('')).toEqual({ moduleLine: 1, requirements: [], replacements: [] })
    expect(parseGoMod('require (\n\tbroken\n').requirements).toEqual([])
  })
})

describe('goModLenses', () => {
  it('puts module-wide actions on the module line and per-dependency actions on each require', () => {
    const lenses = goModLenses(parseGoMod(GO_MOD))
    expect(lenses.filter((lens) => lens.line === 2).map((lens) => lens.action)).toEqual(['updateall', 'updatepatch', 'tidy', 'download', 'verify'])
    expect(lenses.filter((lens) => lens.line === 6).map((lens) => lens.action)).toEqual(['update', 'replace', 'remove'])
    expect(lenses.filter((lens) => lens.line === 9).map((lens) => lens.action)).toEqual(['update', 'dropreplace', 'remove'])
    expect(lenses.find((lens) => lens.line === 13)).toMatchObject({ action: 'dropreplace', modulePath: 'github.com/pkg/errors' })
  })

  it('shows the exact command that will run', () => {
    expect(goModCommandLine('replace', 'github.com/a/b', '/home/me/b')).toBe('go mod edit -replace=github.com/a/b=/home/me/b')
    expect(goModCommandLine('remove', 'github.com/a/b')).toBe('go get github.com/a/b@none')
    expect(goModCommandLine('updatepatch')).toBe('go get -u=patch ./...')
  })

  it('asks confirmation only for actions that may reach the network', () => {
    expect(goModActionNeedsConfirmation('updateall')).toBe(true)
    expect(goModActionNeedsConfirmation('remove')).toBe(true)
    expect(goModActionNeedsConfirmation('dropreplace')).toBe(false)
    expect(goModActionNeedsConfirmation('verify')).toBe(false)
  })
})
