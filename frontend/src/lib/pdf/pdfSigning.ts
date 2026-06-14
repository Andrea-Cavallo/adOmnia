import {
  SignPdfDocumentBase64,
  VerifyPdfSignatureBase64,
  InspectSigningCertificateBase64,
} from '@/wailsjs/go/main/App'
import { base64ToBytes, bytesToBase64 } from './pdfProjects'

export type PdfCredentialSource = 'pem' | 'keystore'
export type PdfKeystoreType = 'p12' | 'jks'

export interface PdfDigitalSignatureRequest {
  pdfBase64: string
  certificatePem: string
  privateKeyPem: string
  credentialSource: PdfCredentialSource
  keystoreBase64?: string
  keystorePassword?: string
  keystoreType?: PdfKeystoreType
  tsaUrl?: string
  tsaUsername?: string
  tsaPassword?: string
  enableLtv?: boolean
  name: string
  location: string
  reason: string
  contactInfo: string
  visible: boolean
  page: number
  x: number
  y: number
  w: number
  h: number
  appearanceBase64?: string
}

export interface PdfSigningCertificateInfo {
  subject: string
  issuer: string
  serialNumber: string
  notBefore: string
  notAfter: string
  chainLength: number
  hasPrivateKey: boolean
}

export interface PdfDigitalSignatureResult {
  pdfBase64: string
  size: number
}

export interface PdfSignatureVerification {
  Error?: string
  Signers?: Array<{
    name?: string
    reason?: string
    location?: string
    contact_info?: string
    valid_signature?: boolean
    trusted_issuer?: boolean
    revoked_certificate?: boolean
    timestamp_status?: string
    timestamp_trusted?: boolean
    time_source?: string
    time_warnings?: string[]
  }>
}

export async function signPdfDocument(
  bytes: Uint8Array,
  request: Omit<PdfDigitalSignatureRequest, 'pdfBase64'>,
): Promise<{ bytes: Uint8Array; result: PdfDigitalSignatureResult }> {
  const raw = await SignPdfDocumentBase64(JSON.stringify({ ...request, pdfBase64: bytesToBase64(bytes) }))
  const result = JSON.parse(raw) as PdfDigitalSignatureResult
  return { bytes: base64ToBytes(result.pdfBase64), result }
}

export async function verifyPdfSignature(bytes: Uint8Array): Promise<PdfSignatureVerification> {
  const raw = await VerifyPdfSignatureBase64(bytesToBase64(bytes))
  return JSON.parse(raw) as PdfSignatureVerification
}

/**
 * Resolves the signing credential (PEM or keystore) in the backend and returns
 * only the certificate metadata. The private key is never returned to the UI.
 */
export async function inspectSigningCertificate(
  request: Pick<
    PdfDigitalSignatureRequest,
    | 'certificatePem'
    | 'privateKeyPem'
    | 'credentialSource'
    | 'keystoreBase64'
    | 'keystorePassword'
    | 'keystoreType'
  >,
): Promise<PdfSigningCertificateInfo> {
  const raw = await InspectSigningCertificateBase64(JSON.stringify(request))
  return JSON.parse(raw) as PdfSigningCertificateInfo
}
