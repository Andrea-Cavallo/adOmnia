import { describe, expect, it } from 'vitest'
import { codeStudioUnwrapCandidates, codeStudioUnwrapExpression, isNilCodeStudioDebugValue } from './codeStudioErrorChain'

describe('Code Studio error chain inspector', () => {
  it('uses an explicit interface assertion for one Unwrap level', () => {
    expect(codeStudioUnwrapExpression('requestErr')).toBe('(requestErr).(interface{ Unwrap() error }).Unwrap()')
  })

  it('tries the fmt.wrapError field before calling Unwrap()', () => {
    expect(codeStudioUnwrapCandidates('err')).toEqual(['(err).(*fmt.wrapError).err', '(err).(interface{ Unwrap() error }).Unwrap()'])
  })

  it('stops on both nil renderings emitted by Delve', () => {
    expect(isNilCodeStudioDebugValue('<nil>')).toBe(true)
    expect(isNilCodeStudioDebugValue(' nil ')).toBe(true)
    expect(isNilCodeStudioDebugValue('errors.errorString "missing"')).toBe(false)
  })
})
