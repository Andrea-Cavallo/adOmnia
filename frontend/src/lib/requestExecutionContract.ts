import type { HttpMethod, RequestAssertion, RequestItem, PSD2RequestConfig } from '@/lib/types'

export interface ResolvedHostMapEntry {
  host: string
  ip: string
  enabled: boolean
}

export interface ResolvedRequestScriptPlan {
  pre?: string
  post?: string
  tests?: string
}

export interface ResolvedRequestSourceMetadata {
  requestId: string
  requestName: string
  openapiPath?: string
  openapiResponses?: RequestItem['_openapiResponses']
  openapiSecurity?: RequestItem['_openapiSecurity']
  xExtensions?: RequestItem['_xExtensions']
}

export interface ResolvedRequest {
  id: string
  sourceRequestId: string
  method: HttpMethod
  url: string
  headers: Record<string, string>
  body: string
  timeoutMs: number
  followRedirects: boolean
  maxRedirects: number
  stripAuthOnRedirect: boolean
  skipTlsVerify: boolean
  clientCertPem: string
  clientCertPassphrase: string
  hostsMap: ResolvedHostMapEntry[]
  assertionPlan: RequestAssertion[]
  scriptPlan: ResolvedRequestScriptPlan
  sourceMetadata: ResolvedRequestSourceMetadata
  psd2?: PSD2RequestConfig & { qwacPassword: string; qsealPassword: string }
}

export interface HTTPExecPayload {
  id: string
  method: HttpMethod
  url: string
  headers: Record<string, string>
  body: string
  timeoutMs: number
  followRedirects: boolean
  maxRedirects: number
  stripAuthOnRedirect: boolean
  skipTlsVerify: boolean
  clientCertPem: string
  clientCertPassphrase: string
  hostsMap: ResolvedHostMapEntry[]
  psd2?: ResolvedRequest['psd2']
}

export function toHTTPExecPayload(request: ResolvedRequest): HTTPExecPayload {
  return {
    id: request.id,
    method: request.method,
    url: request.url,
    headers: request.headers,
    body: request.body,
    timeoutMs: request.timeoutMs,
    followRedirects: request.followRedirects,
    maxRedirects: request.maxRedirects,
    stripAuthOnRedirect: request.stripAuthOnRedirect,
    skipTlsVerify: request.skipTlsVerify,
    clientCertPem: request.clientCertPem,
    clientCertPassphrase: request.clientCertPassphrase,
    hostsMap: request.hostsMap,
    psd2: request.psd2,
  }
}
