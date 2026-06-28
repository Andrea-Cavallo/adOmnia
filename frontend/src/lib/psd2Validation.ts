import type { RequestItem } from '@/lib/types'
import { isVaultRef } from '@/lib/vaultRefs'

export interface PSD2ValidationIssue {
  field: string
  message: string
}

function enabledHeader(request: RequestItem, name: string): string {
  return request.headers.find((header) => header.enabled && header.key.toLowerCase() === name.toLowerCase())?.value.trim() ?? ''
}

function activeBodyValue(request: RequestItem): string {
  const body = request.bodies[request.activeBodyIdx] ?? request.bodies[0]
  if (!body || body.type === 'none') return ''
  if (body.type === 'raw' || body.type === 'graphql') return body.raw.trim()
  return body.form.some((row) => row.enabled && row.key.trim()) ? 'structured-body' : ''
}

export function validatePSD2Request(request: RequestItem): PSD2ValidationIssue[] {
  const config = request.psd2
  if (!config?.enabled) return []

  const issues: PSD2ValidationIssue[] = []
  if (!config.qwacPath.trim()) issues.push({ field: 'qwacPath', message: 'Select a QWAC certificate for mTLS.' })
  if (config.qwacPasswordRef && !isVaultRef(config.qwacPasswordRef)) issues.push({ field: 'qwacPasswordRef', message: 'QWAC password must be an encrypted vault: reference.' })

  if (config.sign) {
    if (!config.qsealPath.trim()) issues.push({ field: 'qsealPath', message: 'Select a QSEAL certificate for request signing.' })
    if (config.qsealPasswordRef && !isVaultRef(config.qsealPasswordRef)) issues.push({ field: 'qsealPasswordRef', message: 'QSEAL password must be an encrypted vault: reference.' })
    if (!activeBodyValue(request)) issues.push({ field: 'body', message: 'A non-empty body is required when PSD2 signing is enabled.' })
  }

  if (config.operation !== 'fcs-confirmation' && !enabledHeader(request, 'PSU-IP-Address')) {
    issues.push({ field: 'PSU-IP-Address', message: 'PSU-IP-Address is required for this operation.' })
  }
  return issues
}
