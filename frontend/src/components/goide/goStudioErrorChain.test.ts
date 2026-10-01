import { describe, expect, it } from 'vitest'
import { goStudioUnwrapCandidates, goStudioUnwrapExpression, isNilGoStudioDebugValue } from './goStudioErrorChain'

describe('Go Studio error chain inspector', () => {
  it('uses an explicit interface assertion for one Unwrap level', () => {
    expect(goStudioUnwrapExpression('requestErr')).toBe('(requestErr).(interface{ Unwrap() error }).Unwrap()')
  })

  it('tries the fmt.wrapError field before calling Unwrap()', () => {
    expect(goStudioUnwrapCandidates('err')).toEqual(['(err).(*fmt.wrapError).err', '(err).(interface{ Unwrap() error }).Unwrap()'])
  })

  it('stops on both nil renderings emitted by Delve', () => {
    expect(isNilGoStudioDebugValue('<nil>')).toBe(true)
    expect(isNilGoStudioDebugValue(' nil ')).toBe(true)
    expect(isNilGoStudioDebugValue('errors.errorString "missing"')).toBe(false)
  })
})
