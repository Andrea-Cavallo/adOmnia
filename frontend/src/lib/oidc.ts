import { ExecuteHTTP } from '@/wailsjs/go/main/App'

export interface OidcDiscoveryDocument {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint?: string
  jwks_uri: string
  end_session_endpoint?: string
  scopes_supported?: string[]
  response_types_supported?: string[]
  code_challenge_methods_supported?: string[]
}

export interface NormalizedOidcDiscovery {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  userinfoEndpoint?: string
  jwksUri: string
  endSessionEndpoint?: string
  scopesSupported?: string[]
  responseTypesSupported?: string[]
  codeChallengeMethodsSupported?: string[]
}

export type OidcErrorCode =
  | 'DISCOVERY_UNAVAILABLE'
  | 'OIDC_CONFIG_INVALID'
  | 'TOKEN_EXPIRED'
  | 'ISSUER_INVALID'
  | 'AUDIENCE_INVALID'
  | 'SIGNATURE_INVALID'
  | 'JWKS_KEY_NOT_FOUND'
  | 'NONCE_INVALID'

export class OidcError extends Error {
  constructor(public code: OidcErrorCode, message: string) {
    super(message)
  }
}

export interface JwkKey {
  kid?: string
  kty: string
  alg?: string
  use?: string
  key_ops?: string[]
  n?: string
  e?: string
  crv?: string
  x?: string
  y?: string
}

export interface JwksDocument {
  keys: JwkKey[]
}

export interface JwtParts {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  signingInput: string
  signature: Uint8Array
}

export interface ValidateIdTokenOptions {
  idToken: string
  issuer: string
  clientId: string
  nonce?: string
  jwks: JwksDocument
  allowedAlgorithms?: string[]
  now?: number
  fetchJwks?: () => Promise<JwksDocument>
}

const DEFAULT_ALLOWED_ALGS = ['RS256', 'RS384', 'RS512']
const CLOCK_SKEW_SECONDS = 60

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function discoveryUrl(issuerUrl: string) {
  const issuer = trimTrailingSlash(issuerUrl.trim())
  if (!issuer) throw new OidcError('OIDC_CONFIG_INVALID', 'Issuer URL is required.')
  return `${issuer}/.well-known/openid-configuration`
}

async function defaultJsonGet<T>(url: string): Promise<T> {
  const response = await ExecuteHTTP(JSON.stringify({
    method: 'GET',
    url,
    headers: { Accept: 'application/json' },
    body: '',
    timeoutMs: 15000,
    followRedirects: true,
    skipTlsVerify: false,
  }))
  const parsed = JSON.parse(response) as { status: number; body: string; error?: { message: string } }
  if (parsed.error) throw new Error(parsed.error.message)
  if (parsed.status < 200 || parsed.status >= 300) throw new Error(`HTTP ${parsed.status}`)
  return JSON.parse(parsed.body) as T
}

export function normalizeOidcDiscovery(raw: OidcDiscoveryDocument): NormalizedOidcDiscovery {
  if (!raw.issuer || !raw.authorization_endpoint || !raw.token_endpoint || !raw.jwks_uri) {
    throw new OidcError('OIDC_CONFIG_INVALID', 'Discovery document is missing issuer, authorization_endpoint, token_endpoint, or jwks_uri.')
  }
  return {
    issuer: raw.issuer,
    authorizationEndpoint: raw.authorization_endpoint,
    tokenEndpoint: raw.token_endpoint,
    userinfoEndpoint: raw.userinfo_endpoint,
    jwksUri: raw.jwks_uri,
    endSessionEndpoint: raw.end_session_endpoint,
    scopesSupported: raw.scopes_supported,
    responseTypesSupported: raw.response_types_supported,
    codeChallengeMethodsSupported: raw.code_challenge_methods_supported,
  }
}

export async function discoverOidcProvider(
  issuerUrl: string,
  getJson: <T>(url: string) => Promise<T> = defaultJsonGet,
): Promise<NormalizedOidcDiscovery> {
  try {
    return normalizeOidcDiscovery(await getJson<OidcDiscoveryDocument>(discoveryUrl(issuerUrl)))
  } catch (error) {
    if (error instanceof OidcError) throw error
    throw new OidcError('DISCOVERY_UNAVAILABLE', `OIDC discovery is not available: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function fetchJwks(jwksUri: string, getJson: <T>(url: string) => Promise<T> = defaultJsonGet): Promise<JwksDocument> {
  try {
    const jwks = await getJson<JwksDocument>(jwksUri)
    if (!Array.isArray(jwks.keys)) throw new Error('keys is not an array')
    return jwks
  } catch (error) {
    throw new OidcError('DISCOVERY_UNAVAILABLE', `JWKS is not available: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function b64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=')
  if (typeof atob === 'function') {
    const raw = atob(padded)
    return Uint8Array.from(raw, (char) => char.charCodeAt(0))
  }
  throw new OidcError('OIDC_CONFIG_INVALID', 'Base64 decoder is not available in this runtime.')
}

function b64UrlJson(value: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64UrlToBytes(value))) as Record<string, unknown>
}

export function parseJwt(token: string): JwtParts {
  const parts = token.split('.')
  if (parts.length !== 3) throw new OidcError('OIDC_CONFIG_INVALID', 'ID token is not a compact JWT.')
  return {
    header: b64UrlJson(parts[0]),
    payload: b64UrlJson(parts[1]),
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: b64UrlToBytes(parts[2]),
  }
}

function algToHash(alg: string): AlgorithmIdentifier {
  if (alg === 'RS256') return 'SHA-256'
  if (alg === 'RS384') return 'SHA-384'
  if (alg === 'RS512') return 'SHA-512'
  throw new OidcError('OIDC_CONFIG_INVALID', `Unsupported ID token signing algorithm: ${alg}`)
}

async function importRsaKey(jwk: JwkKey, alg: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk as JsonWebKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: algToHash(alg) },
    false,
    ['verify'],
  )
}

function findKey(jwks: JwksDocument, kid: string | undefined, alg: string) {
  return jwks.keys.find((key) => {
    if (kid && key.kid !== kid) return false
    if (key.alg && key.alg !== alg) return false
    return key.kty === 'RSA'
  })
}

async function verifyJwtSignature(parts: JwtParts, jwks: JwksDocument, alg: string, fetchFreshJwks?: () => Promise<JwksDocument>) {
  const kid = typeof parts.header.kid === 'string' ? parts.header.kid : undefined
  let key = findKey(jwks, kid, alg)
  if (!key && fetchFreshJwks) {
    key = findKey(await fetchFreshJwks(), kid, alg)
  }
  if (!key) throw new OidcError('JWKS_KEY_NOT_FOUND', 'Public key for the ID token was not found in JWKS.')
  const cryptoKey = await importRsaKey(key, alg)
  const ok = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    cryptoKey,
    parts.signature.buffer.slice(parts.signature.byteOffset, parts.signature.byteOffset + parts.signature.byteLength) as ArrayBuffer,
    new TextEncoder().encode(parts.signingInput),
  )
  if (!ok) throw new OidcError('SIGNATURE_INVALID', 'ID token signature is invalid.')
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function audienceContains(aud: unknown, clientId: string): boolean {
  if (typeof aud === 'string') return aud === clientId
  return Array.isArray(aud) && aud.some((item) => item === clientId)
}

export async function validateIdToken(options: ValidateIdTokenOptions): Promise<Record<string, unknown>> {
  const parts = parseJwt(options.idToken)
  const alg = typeof parts.header.alg === 'string' ? parts.header.alg : ''
  const allowed = options.allowedAlgorithms ?? DEFAULT_ALLOWED_ALGS
  if (!allowed.includes(alg)) throw new OidcError('OIDC_CONFIG_INVALID', `ID token algorithm ${alg || '(missing)'} is not allowed.`)

  await verifyJwtSignature(parts, options.jwks, alg, options.fetchJwks)

  const now = options.now ?? Math.floor(Date.now() / 1000)
  if (parts.payload.iss !== options.issuer) throw new OidcError('ISSUER_INVALID', 'ID token issuer does not match the configured issuer.')
  if (!audienceContains(parts.payload.aud, options.clientId)) throw new OidcError('AUDIENCE_INVALID', 'ID token audience does not include this Client ID.')

  const exp = asNumber(parts.payload.exp)
  const iat = asNumber(parts.payload.iat)
  const nbf = asNumber(parts.payload.nbf)
  if (!exp || now > exp + CLOCK_SKEW_SECONDS) throw new OidcError('TOKEN_EXPIRED', 'ID token is expired.')
  if (!iat) throw new OidcError('OIDC_CONFIG_INVALID', 'ID token is missing iat.')
  if (iat > now + CLOCK_SKEW_SECONDS) throw new OidcError('OIDC_CONFIG_INVALID', 'ID token iat is in the future.')
  if (nbf && now + CLOCK_SKEW_SECONDS < nbf) throw new OidcError('TOKEN_EXPIRED', 'ID token is not valid yet.')
  if (options.nonce && parts.payload.nonce !== options.nonce) throw new OidcError('NONCE_INVALID', 'ID token nonce does not match the authorization request.')

  return parts.payload
}
