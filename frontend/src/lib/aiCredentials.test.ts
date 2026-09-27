import { describe, expect, it } from 'vitest'
import { findAIWorkspaceCredential, providerCredentialKeys } from './aiCredentials'
import type { Environment } from './types'

const environments: Environment[] = [
  { id: 'secondary', name: 'Shared', variables: [{ id: '1', key: 'DEEPSEEK_API_KEY', value: 'shared-key', enabled: true, type: 'secret' }] },
  { id: 'active', name: 'Local .env', variables: [{ id: '2', key: 'DEEPSEEK_API_KEY', value: 'active-key', enabled: true, type: 'secret' }] },
]

describe('AI workspace credential discovery', () => {
  it('recognises the native DeepSeek key', () => {
    expect(providerCredentialKeys('deepseek')).toContain('DEEPSEEK_API_KEY')
  })

  it('prefers the active adOmnia Environment and never returns unrelated values', () => {
    expect(findAIWorkspaceCredential('deepseek', environments, 'active')).toEqual({
      key: 'DEEPSEEK_API_KEY',
      value: 'active-key',
      environmentName: 'Local .env',
    })
  })

  it('ignores disabled credentials', () => {
    const disabled: Environment[] = [{
      id: 'active', name: 'Disabled', variables: [{ id: '3', key: 'OPENAI_API_KEY', value: 'nope', enabled: false }],
    }]
    expect(findAIWorkspaceCredential('openai', disabled, 'active')).toBeNull()
  })
})
