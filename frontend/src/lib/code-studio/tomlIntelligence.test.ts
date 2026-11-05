import { describe, expect, it } from 'vitest'
import { tomlCompletions, tomlDiagnosticFromError } from './tomlIntelligence'

describe('TOML local intelligence', () => {
  it('suggests table headers and the tables already in the file', () => {
    const source = '[package]\nname = "app"\n\n[profile.release]\nlto = true\n'
    const suggestions = tomlCompletions(source, 1, 2)
    expect(suggestions).toContain('dependencies')
    expect(suggestions).toContain('package')
    expect(suggestions).toContain('profile.release')
  })

  it('suggests the keys declared in the current table', () => {
    const source = '[package]\nname = "app"\nversion = "1.0.0"\n'
    const suggestions = tomlCompletions(source, 3, 1)
    expect(suggestions).toContain('name')
    expect(suggestions).toContain('version')
    expect(suggestions).not.toContain('workspace')
  })

  it('suggests values after the equals sign', () => {
    expect(tomlCompletions('[package]\nname = ', 2, 9)).toEqual(['true', 'false', '""', '[]', '{}'])
  })

  it('keeps the parser position and drops the source excerpt', () => {
    const diagnostic = tomlDiagnosticFromError('TOML: TOML parse error at line 4, column 7\n  |\n4 | name = \n  |       ^\nmissing value')
    expect(diagnostic).toMatchObject({ line: 4, column: 7 })
    expect(diagnostic?.message).not.toContain('\n')
  })
})
