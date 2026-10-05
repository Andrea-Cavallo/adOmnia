import { describe, expect, it } from 'vitest'
import { errorFixChange, groupErrorFindings, offsetAt } from './goStudioErrorHandling'

const at = (line: number, column: number) => ({ relativePath: 'a.go', line, column })
const finding = (kind: string, severity: string, message = 'm') => ({ kind, severity, message, location: at(1, 1), end: at(1, 2) }) as any

describe('error handling helpers', () => {
  it('groups findings by rule, most severe first, with a filter', () => {
    const groups = groupErrorFindings([finding('panic', 'info'), finding('ignored', 'warning'), finding('ignored', 'warning', 'x'), finding('wrap-nonerror', 'error')])
    expect(groups.map((group) => [group.kind, group.findings.length])).toEqual([['wrap-nonerror', 1], ['ignored', 2], ['panic', 1]])
    expect(groupErrorFindings([finding('ignored', 'warning', 'Open failed')], 'open')[0].findings).toHaveLength(1)
    expect(groupErrorFindings([finding('ignored', 'warning', 'Open failed')], 'zzz')).toEqual([])
  })

  it('maps UTF-16 editor positions to offsets', () => {
    expect(offsetAt('ab\ncdè\nf', 2, 3)).toBe(5)
    expect(offsetAt('ab\ncd', 9, 1)).toBe(5)
  })

  it('applies a fix only to the text that was analyzed', () => {
    const fix = { label: 'Use errors.Is', edits: [{ range: { startLine: 2, startColumn: 9, endLine: 2, endColumn: 23 }, original: 'err == ErrGone', text: 'errors.Is(err, ErrGone)' }] }
    const buffer = 'func f() {\n\treturn err == ErrGone\n}\n'
    const change = errorFixChange(fix, 'a.go', buffer.replace(/\n/g, '\r\n'))
    expect(change?.files[0].newContent).toBe('func f() {\n\treturn errors.Is(err, ErrGone)\n}\n')
    expect(errorFixChange(fix, 'a.go', buffer.replace('ErrGone', 'ErrLost'))).toBeNull()
  })
})
