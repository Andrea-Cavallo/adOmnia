import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearManagedSecretSession,
  hydrateManagedSecret,
  persistManagedSecret,
} from './managedSecrets'

describe('managed secrets', () => {
  beforeEach(clearManagedSecretSession)

  it('keeps plaintext only in the current renderer session', () => {
    expect(persistManagedSecret('database:one:password', 'plain-secret')).toBe('')
    expect(hydrateManagedSecret('database:one:password', '')).toBe('plain-secret')
  })

  it('persists encrypted Vault references unchanged', () => {
    const ref = 'vault:encrypted-payload'
    expect(persistManagedSecret('git:one:token', ref)).toBe(ref)
    expect(hydrateManagedSecret('git:one:token', ref)).toBe(ref)
  })

  it('forgets a session secret when the credential is cleared', () => {
    persistManagedSecret('broker:mqtt:password', 'temporary')
    persistManagedSecret('broker:mqtt:password', '')
    expect(hydrateManagedSecret('broker:mqtt:password', '')).toBe('')
  })
})
