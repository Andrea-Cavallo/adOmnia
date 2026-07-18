import { BuildPSD2Headers, InspectPSD2Certificate, SelectPSD2Certificate } from '@/wailsjs/go/main/App'
import type { PSD2Operation } from '@/lib/types'

export interface PSD2CertificateInfo {
  subject: string
  issuer: string
  serialNumber: string
  organizationIdentifier: string
  pspRoles: string[]
  ncaName: string
  ncaId: string
  notBefore: string
  notAfter: string
  validNow: boolean
  hasPrivateKey: boolean
}

export interface PSD2HeaderResult {
  headers: Record<string, string>
  required: string[]
  conditional: string[]
  missing: string[]
}

export async function selectPSD2Certificate(): Promise<string> {
  return SelectPSD2Certificate()
}

export async function inspectPSD2Certificate(path: string, password: string): Promise<PSD2CertificateInfo> {
  return JSON.parse(await InspectPSD2Certificate(path, password)) as PSD2CertificateInfo
}

export async function buildPSD2Headers(operation: PSD2Operation, headers: Record<string, string>): Promise<PSD2HeaderResult> {
  return JSON.parse(await BuildPSD2Headers(JSON.stringify({ operation, headers }))) as PSD2HeaderResult
}
