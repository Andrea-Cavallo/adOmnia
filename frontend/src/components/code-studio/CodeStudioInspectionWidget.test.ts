import { describe, expect, it } from 'vitest'
import { checkingOffReason } from './CodeStudioInspectionWidget'

describe('checkingOffReason', () => {
  it('allows the green state only when the language server really checks the file', () => {
    expect(checkingOffReason({ osgiJavaFile: false, serverReady: true })).toBeNull()
  })

  it('explains a server that is not running', () => {
    expect(checkingOffReason({ osgiJavaFile: false, serverReady: false })).toContain('not running')
  })

  it('trusts the server on an OSGi bundle once it runs on the target, and explains the target when it does not', () => {
    expect(checkingOffReason({ osgiJavaFile: true, serverReady: true })).toBeNull()
    expect(checkingOffReason({ osgiJavaFile: true, serverReady: false })).toContain('target platform')
  })
})
