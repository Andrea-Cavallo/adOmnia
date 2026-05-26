import type { RequestAuth } from '@/lib/types'
import { serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { fetchOAuth2TokenManual } from '@/lib/sendRequest'

interface OAuthStartResponse {
  state: string
  redirectUri: string
}

interface OAuthStatusResponse {
  status: 'pending' | 'complete' | 'error'
  code?: string
  error?: string
}

export interface OAuthAuthorizationResult {
  auth: RequestAuth
  token: string
}

function base64Url(bytes: Uint8Array): string {
  let raw = ''
  bytes.forEach((byte) => { raw += String.fromCharCode(byte) })
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function randomValue(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Authorization cancelled.', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(new DOMException('Authorization cancelled.', 'AbortError'))
    }, { once: true })
  })
}

function openLoginBrowser(url: string): void {
  const runtime = (window as Window & { runtime?: { BrowserOpenURL?: (target: string) => void } }).runtime
  if (runtime?.BrowserOpenURL) {
    runtime.BrowserOpenURL(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export async function authorizeOAuth2Pkce(
  auth: RequestAuth,
  port: number | null,
  onStatus: (status: string) => void,
  signal?: AbortSignal,
): Promise<OAuthAuthorizationResult> {
  if (!port) throw new Error('Local OAuth callback service is not ready yet')
  if (!auth.oauth2AuthUrl) throw new Error('OAuth2 Authorization URL is required')
  if (!auth.oauth2TokenUrl) throw new Error('OAuth2 Token URL is required')
  if (!auth.oauth2ClientId) throw new Error('OAuth2 Client ID is required')

  const verifier = randomValue(48)
  const challenge = await pkceChallenge(verifier)
  const response = await sidecarFetch(serverUrl(port, '/oauth/start'), { method: 'POST' })
  if (!response.ok) throw new Error(await response.text() || 'Could not start OAuth authorization')
  const started = await response.json() as OAuthStartResponse

  const authorizationURL = new URL(auth.oauth2AuthUrl)
  authorizationURL.searchParams.set('response_type', 'code')
  authorizationURL.searchParams.set('client_id', auth.oauth2ClientId)
  authorizationURL.searchParams.set('redirect_uri', started.redirectUri)
  authorizationURL.searchParams.set('state', started.state)
  authorizationURL.searchParams.set('code_challenge', challenge)
  authorizationURL.searchParams.set('code_challenge_method', 'S256')
  if (auth.oauth2Scope) authorizationURL.searchParams.set('scope', auth.oauth2Scope)

  onStatus('Complete sign-in in your browser. Waiting for the secure callback...')
  openLoginBrowser(authorizationURL.toString())

  const deadline = Date.now() + 5 * 60 * 1000
  while (Date.now() < deadline) {
    await delay(500, signal)
    const statusResponse = await sidecarFetch(
      `${serverUrl(port, '/oauth/status')}?state=${encodeURIComponent(started.state)}`,
    )
    if (!statusResponse.ok) throw new Error(await statusResponse.text() || 'OAuth callback session expired')
    const status = await statusResponse.json() as OAuthStatusResponse
    if (status.status === 'pending') continue
    if (status.status === 'error') throw new Error(status.error || 'Authorization was rejected')
    if (!status.code) throw new Error('Authorization callback did not provide a code')

    onStatus('Authorization received. Exchanging code for an access token...')
    const completedAuth: RequestAuth = {
      ...auth,
      oauth2RedirectUri: started.redirectUri,
      oauth2AuthCode: status.code,
      oauth2CodeVerifier: verifier,
    }
    const token = await fetchOAuth2TokenManual(completedAuth)
    return {
      auth: {
        ...auth,
        oauth2RedirectUri: started.redirectUri,
        oauth2AuthCode: '',
        oauth2CodeVerifier: '',
        token,
      },
      token,
    }
  }

  throw new Error('OAuth authorization timed out after 5 minutes')
}
