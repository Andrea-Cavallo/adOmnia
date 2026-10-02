import { describe, expect, it } from 'vitest'
import { createAIRedactor } from './aiRedaction'

describe('createAIRedactor', () => {
  it('hides secrets in Go code and restores them in the AI answer', () => {
    const redactor = createAIRedactor()
    const source = [
      'const apiKey = "AKIAABCDEFGHIJKLMNOP"',
      'password := "hunter22"',
      'dsn := "postgres://app:s3cr3t@db:5432/app"',
      'token := "ghp_' + 'a'.repeat(36) + '"',
      'name := "gopher"',
    ].join('\n')
    const sent = redactor.redact(source)
    expect(sent).not.toMatch(/AKIA|hunter22|s3cr3t|ghp_/)
    expect(sent).toContain('postgres://app:ADOMNIA_REDACTED_')
    expect(sent).toContain('name := "gopher"')
    expect(redactor.count()).toBe(4)
    expect(redactor.restore(sent)).toBe(source)
  })

  it('shares placeholders across files and keeps unknown placeholders', () => {
    const redactor = createAIRedactor()
    const a = redactor.redact('secret := "same-value"')
    const b = redactor.redact('var clientSecret = "same-value"')
    expect(a.match(/ADOMNIA_REDACTED_\d+/)?.[0]).toBe(b.match(/ADOMNIA_REDACTED_\d+/)?.[0])
    expect(redactor.restore('x := ADOMNIA_REDACTED_99')).toBe('x := ADOMNIA_REDACTED_99')
  })

  it('redacts a whole PEM private key block', () => {
    const redactor = createAIRedactor()
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----'
    expect(redactor.redact(`key := \`${pem}\``)).not.toContain('MIIabc')
  })
})
