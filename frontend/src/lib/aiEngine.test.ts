import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({
  ai: {
    provider: 'openai',
    model: 'gpt-5.6-terra',
    apiKey: 'vault:encrypted-key',
    baseURL: '',
    credentialMode: 'auto',
  },
}))
const resolveSecretMock = vi.hoisted(() => vi.fn())

vi.mock('@/stores/settings', () => ({
  useSettingsStore: {
    getState: () => ({ settings }),
  },
}))

vi.mock('@/lib/vaultRefs', () => ({
  resolveSecret: resolveSecretMock,
}))

vi.mock('@/wailsjs/go/main/AIEngine', () => ({
  Configure: vi.fn(),
}))

import { withAIConfig } from './aiEngine'

describe('withAIConfig', () => {
  beforeEach(() => {
    settings.ai = {
      provider: 'openai',
      model: 'gpt-5.6-terra',
      apiKey: 'vault:encrypted-key',
      baseURL: '',
      credentialMode: 'auto',
    }
    resolveSecretMock.mockReset()
  })

  it('uses the automatic environment path without resolving the Vault', async () => {
    const operation = vi.fn(async (config: string) => config)

    const config = JSON.parse(await withAIConfig(operation)) as { apiKey: string; credentialMode: string }

    expect(config).toMatchObject({ apiKey: '', credentialMode: 'auto' })
    expect(resolveSecretMock).not.toHaveBeenCalled()
  })

  it('falls back to the Vault only after the backend reports no environment credential', async () => {
    resolveSecretMock.mockResolvedValue('vault-key')
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('AI environment credential is missing: set OPENAI_API_KEY'))
      .mockImplementationOnce(async (config: string) => config)

    const config = JSON.parse(await withAIConfig(operation)) as { apiKey: string; credentialMode: string }

    expect(operation).toHaveBeenCalledTimes(2)
    expect(config).toMatchObject({ apiKey: 'vault-key', credentialMode: 'vault' })
    expect(resolveSecretMock).toHaveBeenCalledWith('vault:encrypted-key')
  })
})
