import { describe, expect, it } from 'vitest'
import { goStudioUnwrapExpression, isNilGoStudioDebugValue } from './goStudioErrorChain'

describe('Go Studio error chain inspector', () => {
  it('uses an explicit interface assertion for one Unwrap level', () => {
    expect(goStudioUnwrapExpression('requestErr')).toBe('(requestErr).(interface{ Unwrap() error }).Unwrap()')
  })

  it('stops on both nil renderings emitted by Delve', () => {
    expect(isNilGoStudioDebugValue('<nil>')).toBe(true)
    expect(isNilGoStudioDebugValue(' nil ')).toBe(true)
    expect(isNilGoStudioDebugValue('errors.errorString "missing"')).toBe(false)
  })
})
