import { describe, expect, it } from 'vitest'
import { certificateValidity, distinguishedName, isCertificateDocument } from './certificateDocument'

const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n'

describe('certificate documents', () => {
  it('opens PEM text files decoded and leaves binary or unrelated files alone', () => {
    expect(isCertificateDocument('certs/server.pem', PEM)).toBe(true)
    expect(isCertificateDocument('tls/client.key', '-----BEGIN ENCRYPTED PRIVATE KEY-----\n')).toBe(true)
    expect(isCertificateDocument('ca.cer', '0\u0082\u0003')).toBe(false)
    expect(isCertificateDocument('notes.md', PEM)).toBe(false)
  })

  it('tells expired, future and expiring certificates apart', () => {
    expect(certificateValidity({ isExpired: true, isNotYetValid: false, daysRemaining: -3 })).toBe('expired')
    expect(certificateValidity({ isExpired: false, isNotYetValid: true, daysRemaining: 400 })).toBe('not-yet-valid')
    expect(certificateValidity({ isExpired: false, isNotYetValid: false, daysRemaining: 12 })).toBe('expiring')
    expect(certificateValidity({ isExpired: false, isNotYetValid: false, daysRemaining: 200 })).toBe('valid')
  })

  it('formats distinguished names like a browser', () => {
    expect(distinguishedName({ cn: 'api.example.test', o: 'adOmnia', c: 'IT' })).toBe('CN=api.example.test, O=adOmnia, C=IT')
    expect(distinguishedName({})).toBe('')
  })
})
