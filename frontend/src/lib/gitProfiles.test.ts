import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearManagedSecretSession } from './managedSecrets'
import { loadGitProfiles, saveGitProfile } from './gitProfiles'

const values = new Map<string, string>()

beforeEach(() => {
  values.clear()
  clearManagedSecretSession()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  })
})

describe('Git profile credentials', () => {
  it('migrates a legacy plaintext token to session-only storage', () => {
    values.set('adomnia.git.profiles', JSON.stringify([{
      id: 'legacy', label: 'Legacy', name: '', email: '', hostPattern: 'github.com',
      autoApply: true, provider: 'github', baseURL: '', username: '', tokenRef: 'plain-token',
    }]))

    expect(loadGitProfiles()[0].tokenRef).toBe('plain-token')
    expect(values.get('adomnia.git.profiles')).not.toContain('plain-token')
  })

  it('stores a Vault reference but never a newly entered plaintext token', () => {
    const base = { label: 'GitHub', name: '', email: '', hostPattern: 'github.com', autoApply: true, provider: 'github' as const, baseURL: '', username: '' }
    saveGitProfile([], { ...base, tokenRef: 'plain-token' })
    expect(values.get('adomnia.git.profiles')).not.toContain('plain-token')

    saveGitProfile([], { ...base, tokenRef: 'vault:ciphertext' })
    expect(values.get('adomnia.git.profiles')).toContain('vault:ciphertext')
  })
})
