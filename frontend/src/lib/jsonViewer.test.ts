import { describe, expect, it } from 'vitest'
import {
  buildExpandedJsonPaths,
  diffJsonViewerContent,
  formatJsonViewerContent,
  minifyJsonViewerContent,
  sortJsonViewerContent,
  summarizeJsonViewerContent,
} from './jsonViewer'

describe('jsonViewer helpers', () => {
  it('formats JSON without rounding large numbers', () => {
    const formatted = formatJsonViewerContent('{"id":9223372036854775807,"items":[{"name":"a"}]}')

    expect(formatted).toContain('9223372036854775807')
    expect(formatted).toContain('\n  "items": [')
  })

  it('minifies JSON while preserving string whitespace and numeric spellings', () => {
    const minified = minifyJsonViewerContent('{\n  "label": "a b",\n  "n": 1.2300e-10\n}')

    expect(minified).toBe('{"label":"a b","n":1.2300e-10}')
  })

  it('sorts object keys alphabetically without rounding long numbers', () => {
    const sorted = sortJsonViewerContent('{"z":9223372036854775807,"a":{"b":2,"a":1}}')

    expect(sorted.indexOf('"a"')).toBeLessThan(sorted.indexOf('"z"'))
    expect(sorted).toContain('9223372036854775807')
    expect(sorted).not.toContain('9223372036854776000')
  })

  it('diffs JSON values without normalizing long numbers', () => {
    const diff = diffJsonViewerContent(
      '{"id":9223372036854775807,"name":"a"}',
      '{"id":9223372036854775808,"name":"a","extra":true}',
    )

    expect(diff.rows).toContainEqual({ path: '$.id', left: '9223372036854775807', right: '9223372036854775808', status: 'changed' })
    expect(diff.rows).toContainEqual({ path: '$.extra', left: '', right: 'true', status: 'added' })
  })

  it('builds expansion paths for nested objects and arrays', () => {
    expect(buildExpandedJsonPaths({ user: { roles: ['admin'] } })).toEqual(['$', '$.user', '$.user.roles'])
  })

  it('summarizes invalid JSON with diagnostics count', () => {
    const summary = summarizeJsonViewerContent('{"id":}')

    expect(summary.valid).toBe(false)
    expect(summary.errorCount).toBeGreaterThan(0)
    expect(summary.rootType).toBe('empty')
  })
})
