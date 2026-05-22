import type { RequestItem, ResponseData, RequestAuth } from '@/lib/types'
import { substVars } from '@/lib/substVars'
import { useSettingsStore } from '@/stores/settings'
import { ExecuteHTTP } from '../wailsjs/go/main/App'

export async function sendRequest(
  request: RequestItem,
  vars: Record<string, string>
): Promise<ResponseData> {
  const url = substVars(request.url, vars)
  const headers: Record<string, string> = {}
  const requestSettings = useSettingsStore.getState().settings.requests

  for (const h of request.headers) {
    if (h.enabled && h.key) {
      headers[substVars(h.key, vars)] = substVars(h.value, vars)
    }
  }

  let enabledParams = request.params.filter((p) => p.enabled && p.key)
  const usp = new URLSearchParams()
  for (const p of enabledParams) {
    usp.append(substVars(p.key, vars), substVars(p.value, vars))
  }
  const queryString = enabledParams.length ? usp.toString() : ''
  const fullUrl = queryString ? (url.includes('?') ? `${url}&${queryString}` : `${url}?${queryString}`) : url

  const rawBody = getBody(request, vars, headers)

  // FormData (file uploads) still needs browser fetch; Go binding handles strings only.
  if (rawBody instanceof FormData) {
    try {
      await applyAuth(request, headers, vars, fullUrl, rawBody)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return errResp('AUTH_ERR', msg)
    }
    return sendViaBrowserFetch(request.method, fullUrl, headers, rawBody, requestSettings, request.timeout, request.followRedirects)
  }

  // Serialize body to string for Go transport
  let bodyStr = ''
  if (rawBody instanceof URLSearchParams) {
    bodyStr = rawBody.toString()
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }
  } else if (typeof rawBody === 'string') {
    bodyStr = rawBody
  }

  try {
    await applyAuth(request, headers, vars, fullUrl, rawBody)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errResp('AUTH_ERR', msg)
  }

  const timeoutMs = request.timeout && request.timeout > 0
    ? request.timeout
    : requestSettings.defaultTimeoutMs

  const execReq = {
    method: request.method,
    url: fullUrl,
    headers,
    body: bodyStr,
    timeoutMs: timeoutMs > 0 ? timeoutMs : 30000,
    followRedirects: request.followRedirects ?? requestSettings.followRedirects,
    skipTlsVerify: requestSettings.skipCertVerify ?? false,
  }

  try {
    const respJSON = await ExecuteHTTP(JSON.stringify(execReq))
    const resp = JSON.parse(respJSON) as GoHTTPResponse
    if (resp.error) {
      return { status: 0, statusText: '', headers: {}, body: '', contentType: '', ms: resp.ms ?? 0, size: 0, error: resp.error }
    }
    return {
      status: resp.status,
      statusText: resp.statusText,
      headers: resp.headers ?? {},
      body: resp.body ?? '',
      contentType: resp.contentType ?? '',
      ms: resp.ms ?? 0,
      size: resp.size ?? 0,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errResp('ERR', msg)
  }
}

// --- Auth ---

async function applyAuth(
  request: RequestItem,
  headers: Record<string, string>,
  vars: Record<string, string>,
  fullUrl: string,
  body: string | URLSearchParams | FormData | undefined
) {
  const auth = request.auth
  switch (auth.type) {
    case 'bearer':
      if (auth.token) headers['Authorization'] = `Bearer ${substVars(auth.token, vars)}`
      break
    case 'basic': {
      const user = substVars(auth.username, vars)
      const pass = substVars(auth.password, vars)
      headers['Authorization'] = `Basic ${btoa(`${user}:${pass}`)}`
      break
    }
    case 'apikey': {
      const headerName = substVars(auth.username || 'X-API-Key', vars)
      headers[headerName] = substVars(auth.token, vars)
      break
    }
    case 'oauth2': {
      const token = await fetchOAuth2Token(auth)
      headers['Authorization'] = `Bearer ${token}`
      break
    }
    case 'aws4': {
      await applyAWS4Signature(auth, request.method, fullUrl, headers, body)
      break
    }
  }
}

// OAuth2 token fetch routes through Go to avoid browser CORS on token endpoints
async function fetchOAuth2Token(auth: RequestAuth): Promise<string> {
  if (!auth.oauth2TokenUrl) throw new Error('OAuth2 Token URL is required')
  const bodyParams = new URLSearchParams({ grant_type: 'client_credentials' })
  if (auth.oauth2ClientId) bodyParams.append('client_id', auth.oauth2ClientId)
  if (auth.oauth2ClientSecret) bodyParams.append('client_secret', auth.oauth2ClientSecret)
  if (auth.oauth2Scope) bodyParams.append('scope', auth.oauth2Scope)

  const execReq = {
    method: 'POST',
    url: auth.oauth2TokenUrl,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: bodyParams.toString(),
    timeoutMs: 15000,
    followRedirects: true,
    skipTlsVerify: false,
  }

  const respJSON = await ExecuteHTTP(JSON.stringify(execReq))
  const resp = JSON.parse(respJSON) as GoHTTPResponse
  if (resp.error) throw new Error(resp.error.message)
  const data = JSON.parse(resp.body) as Record<string, unknown>
  if (typeof data.access_token === 'string') return data.access_token
  const errMsg = typeof data.error_description === 'string' ? data.error_description
    : typeof data.error === 'string' ? data.error
    : 'Failed to fetch OAuth2 token'
  throw new Error(errMsg)
}

export async function fetchOAuth2TokenManual(auth: RequestAuth): Promise<string> {
  return fetchOAuth2Token(auth)
}

// --- Browser fetch fallback (FormData / file uploads) ---

async function sendViaBrowserFetch(
  method: string,
  fullUrl: string,
  headers: Record<string, string>,
  body: FormData | undefined,
  requestSettings: ReturnType<typeof useSettingsStore.getState>['settings']['requests'],
  timeout: number | undefined,
  followRedirects: boolean | undefined
): Promise<ResponseData> {
  const start = performance.now()
  const controller = new AbortController()
  const timeoutMs = timeout && timeout > 0 ? timeout : requestSettings.defaultTimeoutMs
  let timer: ReturnType<typeof setTimeout> | undefined
  if (timeoutMs > 0) timer = setTimeout(() => controller.abort(), timeoutMs)

  const redirectOption: RequestRedirect = (followRedirects ?? requestSettings.followRedirects) ? 'follow' : 'manual'

  try {
    const resp = await fetch(fullUrl, { method, headers, body, signal: controller.signal, redirect: redirectOption })
    if (timer) clearTimeout(timer)
    const ms = Math.round(performance.now() - start)
    const respBody = await resp.text()
    const respHeaders: Record<string, string> = {}
    resp.headers.forEach((v, k) => { respHeaders[k] = v })
    return {
      status: resp.status, statusText: resp.statusText,
      headers: respHeaders, body: respBody,
      contentType: resp.headers.get('content-type') ?? '',
      ms, size: new Blob([respBody]).size,
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return errResp('TIMEOUT', 'Request timed out', Math.round(performance.now() - start))
    }
    const ms = Math.round(performance.now() - start)
    const msg = e instanceof Error ? e.message : String(e)
    if (!fullUrl || fullUrl.trim() === '' || fullUrl === '?') return errResp('NO_URL', 'No URL specified', ms)
    try { new URL(fullUrl) } catch { return errResp('INVALID_URL', `Invalid URL: ${fullUrl}`, ms) }
    if (msg === 'Failed to fetch' || msg.toLowerCase().includes('networkerror') || msg.toLowerCase().includes('network error')) {
      return errResp('CONN_ERR', `Cannot connect to ${fullUrl}`, ms)
    }
    return errResp('ERR', msg, ms)
  }
}

// --- Body builder ---

function applyBodyContentType(body: import('./types').RequestBody, headers: Record<string, string>) {
  if (body.type === 'raw') {
    if (!headers['Content-Type'] && !headers['content-type']) {
      if (body.lang === 'json') headers['Content-Type'] = 'application/json'
      else if (body.lang === 'xml') headers['Content-Type'] = 'application/xml'
      else if (body.lang === 'html') headers['Content-Type'] = 'text/html'
      else if (body.lang === 'javascript') headers['Content-Type'] = 'application/javascript'
      else headers['Content-Type'] = 'text/plain'
    }
  } else if (body.type === 'graphql') {
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json'
    }
  }
}

function getBody(
  request: RequestItem,
  vars: Record<string, string>,
  headers: Record<string, string>
): string | URLSearchParams | FormData | undefined {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return undefined
  const bodies = request.bodies ?? []
  const activeBody = bodies[request.activeBodyIdx] ?? bodies[0]
  if (!activeBody || activeBody.type === 'none') return undefined

  if (activeBody.type === 'raw') {
    applyBodyContentType(activeBody, headers)
    return substVars(activeBody.raw, vars)
  }

  if (activeBody.type === 'graphql') {
    applyBodyContentType(activeBody, headers)
    let variables: unknown = undefined
    if (activeBody.graphqlVariables?.trim()) {
      try { variables = JSON.parse(activeBody.graphqlVariables) } catch { /* ignore */ }
    }
    return JSON.stringify({ query: substVars(activeBody.raw, vars), variables })
  }

  if (activeBody.type === 'urlencoded') {
    const params = new URLSearchParams()
    for (const f of activeBody.form) {
      if (f.enabled && f.key) params.append(substVars(f.key, vars), substVars(f.value, vars))
    }
    return params
  }

  if (activeBody.type === 'formdata') {
    const fd = new FormData()
    for (const f of activeBody.form) {
      if (f.enabled && f.key) fd.append(substVars(f.key, vars), substVars(f.value, vars))
    }
    return fd
  }

  return undefined
}

// --- Helpers ---

interface GoHTTPResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  contentType: string
  ms: number
  size: number
  error?: { code: string; message: string }
}

function errResp(code: string, message: string, ms = 0): ResponseData {
  return { status: 0, statusText: '', headers: {}, body: '', contentType: '', ms, size: 0, error: { code, message } }
}

// --- AWS Signature Version 4 (unchanged, runs in renderer for HMAC-SHA256) ---

function toBytes(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer
}

async function hmacSHA256(key: ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', cryptoKey, toBytes(data))
}

async function sha256hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', toBytes(data))
  return toHex(buf)
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function getSigningDate(): { dateOnly: string; dateTime: string } {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const dateOnly = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`
  const dateTime = `${dateOnly}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  return { dateOnly, dateTime }
}

async function getSigningKey(secret: string, dateOnly: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmacSHA256(toBytes(`AWS4${secret}`), dateOnly)
  const kRegion = await hmacSHA256(kDate, region)
  const kService = await hmacSHA256(kRegion, service)
  return hmacSHA256(kService, 'aws4_request')
}

async function applyAWS4Signature(
  auth: RequestAuth,
  method: string,
  fullUrl: string,
  headers: Record<string, string>,
  body: string | URLSearchParams | FormData | undefined
) {
  const accessKeyId = auth.awsAccessKeyId ?? ''
  const secretKey = auth.awsSecretKey ?? ''
  const region = auth.awsRegion ?? 'us-east-1'
  const service = auth.awsService ?? 'execute-api'
  if (!accessKeyId || !secretKey) return

  const { dateOnly, dateTime } = getSigningDate()

  const parsedUrl = new URL(fullUrl)
  const canonicalUri = parsedUrl.pathname || '/'

  const sortedParams = Array.from(parsedUrl.searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
  const canonicalQueryString = sortedParams
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  headers['x-amz-date'] = dateTime
  headers['host'] = parsedUrl.hostname
  if (auth.awsSessionToken) headers['x-amz-security-token'] = auth.awsSessionToken

  const bodyStr = body instanceof URLSearchParams ? body.toString() : body instanceof FormData ? '' : (body ?? '')
  const payloadHash = await sha256hex(bodyStr)
  headers['x-amz-content-sha256'] = payloadHash

  const signedHeaderNames = Object.keys(headers).map(k => k.toLowerCase()).sort()
  const canonicalHeaders = signedHeaderNames
    .map(k => `${k}:${(headers[Object.keys(headers).find(h => h.toLowerCase() === k) ?? k] ?? '').trim()}`)
    .join('\n') + '\n'
  const signedHeadersStr = signedHeaderNames.join(';')

  const canonicalRequest = [method.toUpperCase(), canonicalUri, canonicalQueryString, canonicalHeaders, signedHeadersStr, payloadHash].join('\n')
  const canonicalRequestHash = await sha256hex(canonicalRequest)

  const credentialScope = `${dateOnly}/${region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', dateTime, credentialScope, canonicalRequestHash].join('\n')

  const signingKey = await getSigningKey(secretKey, dateOnly, region, service)
  const signature = toHex(await hmacSHA256(signingKey, stringToSign))

  headers['Authorization'] = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`
}
