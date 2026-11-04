import { describe, expect, it } from 'vitest'
import { checkingOffReason } from './CodeStudioInspectionWidget'

describe('checkingOffReason', () => {
  it('allows the green state only when the language server really checks the file', () => {
    expect(checkingOffReason({ osgiJavaFile: false, serverReady: true })).toBeNull()
  })

  it('explains a server that is not running', () => {
    expect(checkingOffReason({ osgiJavaFile: false, serverReady: false })).toContain('not running')
  })

  it('never trusts the server on an OSGi bundle, and points to the build', () => {
    expect(checkingOffReason({ osgiJavaFile: true, serverReady: true })).toContain('Build OSGi Bundles')
  })
})
