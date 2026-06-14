import { describe, it, expect, vi, beforeEach } from 'vitest'

const signMock = vi.fn(async (_json: string) => JSON.stringify({ pdfBase64: '', size: 0 }))
const verifyMock = vi.fn(async (_b64: string) => JSON.stringify({ Signers: [] }))
const inspectMock = vi.fn(async (_json: string) =>
  JSON.stringify({
    subject: 'CN=Test',
    issuer: 'CN=Test',
    serialNumber: '42',
    notBefore: '2026-01-01T00:00:00Z',
    notAfter: '2027-01-01T00:00:00Z',
    chainLength: 1,
    hasPrivateKey: true,
  }),
)

vi.mock('@/wailsjs/go/main/App', () => ({
  SignPdfDocumentBase64: (json: string) => signMock(json),
  VerifyPdfSignatureBase64: (b64: string) => verifyMock(b64),
  InspectSigningCertificateBase64: (json: string) => inspectMock(json),
}))

import { signPdfDocument, inspectSigningCertificate } from './pdfSigning'

describe('pdfSigning request shaping', () => {
  beforeEach(() => {
    signMock.mockClear()
    inspectMock.mockClear()
  })

  it('forwards keystore fields and pdf bytes for keystore signing', async () => {
    await signPdfDocument(new Uint8Array([37, 80, 68, 70]), {
      credentialSource: 'keystore',
      certificatePem: '',
      privateKeyPem: '',
      keystoreBase64: 'AAAA',
      keystoreType: 'p12',
      keystorePassword: 'secret',
      tsaUrl: 'https://tsa.example',
      enableLtv: true,
      name: 'Jane',
      location: '',
      reason: 'approval',
      contactInfo: '',
      visible: true,
      page: 1,
      x: 1,
      y: 2,
      w: 3,
      h: 4,
    })
    expect(signMock).toHaveBeenCalledOnce()
    const payload = JSON.parse(signMock.mock.calls[0][0])
    expect(payload.credentialSource).toBe('keystore')
    expect(payload.keystoreType).toBe('p12')
    expect(payload.keystorePassword).toBe('secret')
    expect(payload.enableLtv).toBe(true)
    expect(payload.tsaUrl).toBe('https://tsa.example')
    expect(typeof payload.pdfBase64).toBe('string')
    expect(payload.pdfBase64.length).toBeGreaterThan(0)
  })

  it('sends only credential fields when inspecting (no pdf bytes)', async () => {
    const info = await inspectSigningCertificate({
      credentialSource: 'pem',
      certificatePem: '-----BEGIN CERTIFICATE-----',
      privateKeyPem: '-----BEGIN PRIVATE KEY-----',
    })
    expect(inspectMock).toHaveBeenCalledOnce()
    const payload = JSON.parse(inspectMock.mock.calls[0][0])
    expect(payload.pdfBase64).toBeUndefined()
    expect(payload.credentialSource).toBe('pem')
    expect(info.subject).toBe('CN=Test')
    expect(info.hasPrivateKey).toBe(true)
  })
})
