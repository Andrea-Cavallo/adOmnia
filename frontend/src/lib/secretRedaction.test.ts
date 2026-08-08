import { describe, expect, it } from 'vitest'
import { redactSensitiveData } from './secretRedaction'
import { maskSecretValues } from './secretScanner'

describe('secret redaction', () => {
  it('redacts nested credentials and credential-bearing URLs', () => {
    const redacted = redactSensitiveData({
      password: 'database-secret',
      config: { url: 'amqp://guest:rabbit-secret@localhost:5672/' },
      headers: [{ key: 'Authorization', value: 'Bearer token-value' }],
    })
    const text = JSON.stringify(redacted)
    expect(text).not.toContain('database-secret')
    expect(text).not.toContain('rabbit-secret')
    expect(text).not.toContain('token-value')
  })

  it('preserves encrypted Vault references', () => {
    expect(redactSensitiveData({ password: 'vault:ciphertext' })).toEqual({ password: 'vault:ciphertext' })
    expect(maskSecretValues({ password: 'vault:ciphertext' })).toEqual({ password: 'vault:ciphertext' })
  })
})
