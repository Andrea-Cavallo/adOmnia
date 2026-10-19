import { describe, expect, it } from 'vitest'
import { isStaleLinterError } from './staleLinter'

describe('isStaleLinterError', () => {
  it('recognizes golangci-lint built with an older Go', () => {
    expect(isStaleLinterError('golangci-lint fallito: Error: can\'t load config: the Go language version (go1.25) used to build golangci-lint is lower than the targeted Go version (1.26.5)')).toBe(true)
  })
  it('ignores other linter failures', () => {
    expect(isStaleLinterError('golangci-lint fallito: no go files to analyze')).toBe(false)
  })
})
