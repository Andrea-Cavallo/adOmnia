import { describe, expect, it } from 'vitest'
import { breakpointSummary, draftFrom, hitConditionError, optionsFrom } from './goStudioBreakpoints'

describe('breakpoint options', () => {
  it('accepts only the hit counts Delve understands', () => {
    for (const value of ['', '3', '>= 5', '%10', '== 2']) expect(hitConditionError(value)).toBeNull()
    for (const value of ['three', '>= x', '3 times']) expect(hitConditionError(value)).toMatch(/number/)
  })

  it('round-trips the form and drops an empty log message', () => {
    const breakpoint = { line: 7, condition: 'i > 2', hitCondition: '3', logMessage: 'i={i}', disabled: true }
    expect({ line: 7, ...optionsFrom(draftFrom(breakpoint)) }).toEqual(breakpoint)
    expect(optionsFrom({ ...draftFrom(null), log: true, logMessage: '  ' })).toEqual({})
  })

  it('summarises the options', () => {
    expect(breakpointSummary({ condition: 'x > 1', hitCondition: '3', logMessage: 'v={v}' })).toBe('if x > 1 · hit 3 · log "v={v}"')
    expect(breakpointSummary({})).toBe('')
  })
})
