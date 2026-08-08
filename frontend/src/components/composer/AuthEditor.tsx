import { useEffect, useRef, useState } from 'react'
import type { RequestAuth } from '@/lib/types'
import { fetchOAuth2TokenDetailsManual } from '@/lib/sendRequest'
import { authorizeOAuth2Pkce } from '@/lib/oauth2Flow'
import { discoverOidcProvider, fetchJwks, validateIdToken, type NormalizedOidcDiscovery } from '@/lib/oidc'
import { useServerPort } from '@/lib/useServerPort'
import { useKnownUiTranslation, useUiTranslation, type UiMessage } from '@/lib/uiI18n'

interface AuthEditorProps {
  auth: RequestAuth
  onChange: (auth: RequestAuth) => void
}

const AUTH_TYPES = [
  { value: 'none', label: 'No Auth' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'apikey', label: 'API Key (header)' },
  { value: 'oauth2', label: 'OAuth 2.0' },
  { value: 'aws4', label: 'AWS Signature v4' },
  { value: 'digest', label: 'Digest Auth' },
] as const

const OAUTH2_GRANTS = [
  { value: 'client_credentials', label: 'Client Credentials' },
  { value: 'authorization_code_pkce', label: 'Authorization Code + PKCE' },
  { value: 'refresh_token', label: 'Refresh Token' },
  { value: 'password', label: 'Password' },
] as const

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3">
      <label className="w-28 text-xs text-text-3 shrink-0">{label}</label>
      {children}
    </div>
  )
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-text-1 text-xs placeholder:text-text-4 focus:border-accent outline-none ${props.className ?? ''}`}
    />
  )
}

export function AuthEditor({ auth, onChange }: AuthEditorProps) {
  const tr = useUiTranslation()
  const known = useKnownUiTranslation()
  const port = useServerPort()
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [fetchStatus, setFetchStatus] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const authController = useRef<AbortController | null>(null)

  useEffect(() => () => authController.current?.abort(), [])

  const validateOidcSession = async (nextAuth: RequestAuth): Promise<RequestAuth> => {
    if (!nextAuth.oidcIdToken || !nextAuth.oidcDiscovery || !nextAuth.oauth2ClientId) return nextAuth
    try {
      const jwks = await fetchJwks(nextAuth.oidcDiscovery.jwksUri)
      const claims = await validateIdToken({
        idToken: nextAuth.oidcIdToken,
        issuer: nextAuth.oidcDiscovery.issuer,
        clientId: nextAuth.oauth2ClientId,
        nonce: nextAuth.oidcNonce,
        jwks,
        fetchJwks: () => fetchJwks(nextAuth.oidcDiscovery!.jwksUri),
      })
      return {
        ...nextAuth,
        oidcUserClaims: claims,
        oidcSessionExpiresAt: typeof claims.exp === 'number' ? claims.exp * 1000 : nextAuth.oidcSessionExpiresAt,
        oidcValidationError: '',
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ...nextAuth, token: '', oidcValidationError: message }
    }
  }

  const handleFetchToken = async () => {
    authController.current?.abort()
    const controller = new AbortController()
    authController.current = controller
    setFetching(true)
    setFetchError('')
    setFetchStatus('')
    try {
      if (auth.oauth2GrantType === 'authorization_code_pkce') {
        const result = await authorizeOAuth2Pkce(auth, port, setFetchStatus, controller.signal)
        const validated = await validateOidcSession(result.auth)
        onChange(validated)
        if (validated.oidcValidationError) throw new Error(validated.oidcValidationError)
      } else {
        const token = await fetchOAuth2TokenDetailsManual(auth)
        const nextAuth = await validateOidcSession({
          ...auth,
          token: token.accessToken,
          oauth2RefreshToken: token.refreshToken ?? auth.oauth2RefreshToken,
          oauth2ExpiresAt: token.expiresAt,
          oidcIdToken: token.idToken,
        })
        onChange(nextAuth)
        if (nextAuth.oidcValidationError) throw new Error(nextAuth.oidcValidationError)
      }
      setFetchStatus('Access token received.')
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setFetchError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      if (authController.current === controller) {
        authController.current = null
        setFetching(false)
      }
    }
  }

  const handleDiscover = async () => {
    if (!auth.oidcIssuerUrl) return
    setDiscovering(true)
    setFetchError('')
    setFetchStatus('Discovering OIDC provider...')
    try {
      const discovery: NormalizedOidcDiscovery = await discoverOidcProvider(auth.oidcIssuerUrl)
      onChange({
        ...auth,
        oidcDiscoveryStatus: 'success',
        oidcDiscoveryError: '',
        oidcDiscovery: discovery,
        oauth2AuthUrl: discovery.authorizationEndpoint,
        oauth2TokenUrl: discovery.tokenEndpoint,
      })
      setFetchStatus('OIDC discovery complete.')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      onChange({ ...auth, oidcDiscoveryStatus: 'error', oidcDiscoveryError: message })
      setFetchError(message)
    } finally {
      setDiscovering(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 py-2">
      <Field label={tr('Type')}>
        <select
          value={auth.type}
          onChange={(e) => onChange({ ...auth, type: e.target.value as RequestAuth['type'] })}
          className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-text-1 text-xs focus:border-accent outline-none"
        >
          {AUTH_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {tr(t.label as UiMessage)}
            </option>
          ))}
        </select>
      </Field>

      {auth.type === 'bearer' && (
        <Field label={tr('Token')}>
          <Input
            value={auth.token}
            onChange={(e) => onChange({ ...auth, token: e.target.value })}
            placeholder="eyJhbGciOi…"
          />
        </Field>
      )}

      {auth.type === 'basic' && (
        <>
          <Field label={tr('Username')}>
            <Input value={auth.username} onChange={(e) => onChange({ ...auth, username: e.target.value })} />
          </Field>
          <Field label={tr('Password')}>
            <Input
              type="password"
              value={auth.password}
              onChange={(e) => onChange({ ...auth, password: e.target.value })}
            />
          </Field>
        </>
      )}

      {auth.type === 'apikey' && (
        <>
          <Field label={tr('Header name')}>
            <Input
              value={auth.username || 'X-API-Key'}
              onChange={(e) => onChange({ ...auth, username: e.target.value })}
            />
          </Field>
          <Field label={tr('Value')}>
            <Input value={auth.token} onChange={(e) => onChange({ ...auth, token: e.target.value })} />
          </Field>
        </>
      )}

      {auth.type === 'oauth2' && (
        <>
          <Field label={tr('Issuer URL')}>
            <div className="flex flex-1 gap-2">
              <Input
                value={auth.oidcIssuerUrl ?? ''}
                onChange={(e) => onChange({ ...auth, oidcIssuerUrl: e.target.value, oidcDiscoveryStatus: 'idle' })}
                placeholder="https://issuer.example.com"
              />
              <button
                onClick={handleDiscover}
                disabled={discovering || !auth.oidcIssuerUrl}
                className="h-7 rounded border border-border-2 bg-surface-2 px-2 text-[11px] font-semibold text-text-2 hover:bg-surface-3 disabled:opacity-50"
              >
                {discovering ? '...' : tr('Discover')}
              </button>
            </div>
          </Field>
          {auth.oidcDiscovery && (
            <div className="mx-3 rounded border border-border-1 bg-surface-1 px-3 py-2 text-[10px] text-text-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold text-success">{tr('Discovery ready')}</span>
                <span>{auth.oidcDiscovery.issuer}</span>
              </div>
              <div className="grid gap-1 font-mono">
                <span>authorize: {auth.oidcDiscovery.authorizationEndpoint}</span>
                <span>token: {auth.oidcDiscovery.tokenEndpoint}</span>
                <span>jwks: {auth.oidcDiscovery.jwksUri}</span>
                {auth.oidcDiscovery.userinfoEndpoint && <span>userinfo: {auth.oidcDiscovery.userinfoEndpoint}</span>}
                {auth.oidcDiscovery.endSessionEndpoint && <span>logout: {auth.oidcDiscovery.endSessionEndpoint}</span>}
              </div>
            </div>
          )}
          <Field label={tr('Grant')}>
            <select
              value={auth.oauth2GrantType || 'client_credentials'}
              onChange={(e) => onChange({ ...auth, oauth2GrantType: e.target.value })}
              className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-text-1 text-xs focus:border-accent outline-none"
            >
              {OAUTH2_GRANTS.map((grant) => (
                <option key={grant.value} value={grant.value}>
                  {tr(grant.label as UiMessage)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr('Token URL')}>
            <Input
              value={auth.oauth2TokenUrl ?? ''}
              onChange={(e) => onChange({ ...auth, oauth2TokenUrl: e.target.value })}
              placeholder="https://auth.your-domain.com/oauth/token"
            />
          </Field>
          <Field label={tr('Client ID')}>
            <Input
              value={auth.oauth2ClientId ?? ''}
              onChange={(e) => onChange({ ...auth, oauth2ClientId: e.target.value })}
            />
          </Field>
          <Field label={tr('Client Secret')}>
            <Input
              type="password"
              value={auth.oauth2ClientSecret ?? ''}
              onChange={(e) => onChange({ ...auth, oauth2ClientSecret: e.target.value })}
            />
          </Field>
          <Field label={tr('Scope')}>
            <Input
              value={auth.oauth2Scope ?? ''}
              onChange={(e) => onChange({ ...auth, oauth2Scope: e.target.value })}
              placeholder="openid profile"
            />
          </Field>
          {auth.oauth2GrantType === 'password' && (
            <>
              <Field label={tr('Username')}>
                <Input
                  value={auth.username ?? ''}
                  onChange={(e) => onChange({ ...auth, username: e.target.value })}
                />
              </Field>
              <Field label={tr('Password')}>
                <Input
                  type="password"
                  value={auth.password ?? ''}
                  onChange={(e) => onChange({ ...auth, password: e.target.value })}
                />
              </Field>
            </>
          )}
          {auth.oauth2GrantType === 'refresh_token' && (
            <Field label={tr('Refresh Token')}>
              <Input
                value={auth.oauth2RefreshToken ?? ''}
                onChange={(e) => onChange({ ...auth, oauth2RefreshToken: e.target.value })}
              />
            </Field>
          )}
          {auth.oauth2GrantType === 'authorization_code_pkce' && (
            <>
              <Field label={tr('Auth URL')}>
                <Input
                  value={auth.oauth2AuthUrl ?? ''}
                  onChange={(e) => onChange({ ...auth, oauth2AuthUrl: e.target.value })}
                  placeholder="https://auth.your-domain.com/oauth/authorize"
                />
              </Field>
              <div className="mx-3 rounded border border-border-1 bg-surface-1 px-3 py-2 text-[11px] text-text-3">
                {tr('adOmnia generates PKCE and listens on a temporary loopback callback. Register a redirect URI beginning with')}{' '}
                <span className="font-mono text-text-2">http://127.0.0.1</span> {tr('in your provider.')}
                {port && (
                  <div className="mt-1 font-mono text-[10px] text-accent">
                    http://127.0.0.1:{port}/oauth/callback
                  </div>
                )}
              </div>
            </>
          )}
          <div className="flex items-center gap-3 px-3">
            <span className="w-28 shrink-0" />
            <button
              onClick={handleFetchToken}
              disabled={fetching || !auth.oauth2TokenUrl || (auth.oauth2GrantType === 'authorization_code_pkce' && !port)}
              className="px-3 py-1 bg-accent text-white rounded text-xs font-medium disabled:opacity-50"
            >
              {fetching ? tr('Waiting...') : auth.oauth2GrantType === 'authorization_code_pkce' ? tr('Authorize & Fetch Token') : tr('Fetch Token')}
            </button>
            {fetching && auth.oauth2GrantType === 'authorization_code_pkce' && (
              <button
                onClick={() => authController.current?.abort()}
                className="px-2 py-1 rounded border border-border-2 text-xs text-text-3 hover:text-text-1"
              >
                {tr('Cancel')}
              </button>
            )}
            {fetchError && <span className="text-xs text-error">{known(fetchError)}</span>}
          </div>
          {fetchStatus && (
            <div className="px-3 pl-[132px] text-[11px] text-success">{known(fetchStatus)}</div>
          )}
          {auth.oidcValidationError && (
            <div className="mx-3 rounded border border-error/30 bg-error/10 px-3 py-2 text-[11px] text-error">
              {tr('ID token validation failed:')} {known(auth.oidcValidationError)}
            </div>
          )}
          {auth.token && (
            <Field label={tr('Access Token')}>
              <Input value={auth.token} readOnly className="opacity-70 cursor-default" />
            </Field>
          )}
          {auth.oidcUserClaims && (
            <div className="mx-3 rounded border border-border-1 bg-surface-1 px-3 py-2 text-[10px] text-text-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold text-text-2">{tr('OIDC user')}</span>
                {auth.oidcSessionExpiresAt && <span>{tr('expires')} {new Date(auth.oidcSessionExpiresAt).toLocaleString()}</span>}
              </div>
              <div className="grid grid-cols-2 gap-1">
                {['sub', 'name', 'email', 'preferred_username'].map((claim) => auth.oidcUserClaims?.[claim] ? (
                  <div key={claim} className="truncate"><span className="text-text-4">{claim}</span>: {String(auth.oidcUserClaims[claim])}</div>
                ) : null)}
              </div>
            </div>
          )}
        </>
      )}

      {auth.type === 'aws4' && (
        <>
          <Field label={tr('Access Key ID')}>
            <Input
              value={auth.awsAccessKeyId ?? ''}
              onChange={(e) => onChange({ ...auth, awsAccessKeyId: e.target.value })}
              placeholder="AKIA..."
            />
          </Field>
          <Field label={tr('Secret Key')}>
            <Input
              type="password"
              value={auth.awsSecretKey ?? ''}
              onChange={(e) => onChange({ ...auth, awsSecretKey: e.target.value })}
            />
          </Field>
          <Field label={tr('Region')}>
            <Input
              value={auth.awsRegion ?? ''}
              onChange={(e) => onChange({ ...auth, awsRegion: e.target.value })}
              placeholder="us-east-1"
            />
          </Field>
          <Field label={tr('Service')}>
            <Input
              value={auth.awsService ?? ''}
              onChange={(e) => onChange({ ...auth, awsService: e.target.value })}
              placeholder="execute-api"
            />
          </Field>
          <Field label={tr('Session Token')}>
            <Input
              value={auth.awsSessionToken ?? ''}
              onChange={(e) => onChange({ ...auth, awsSessionToken: e.target.value })}
              placeholder="optional"
            />
          </Field>
        </>
      )}

      {auth.type === 'digest' && (
        <>
          <Field label={tr('Username')}>
            <Input value={auth.username} onChange={(e) => onChange({ ...auth, username: e.target.value })} />
          </Field>
          <Field label={tr('Password')}>
            <Input
              type="password"
              value={auth.password}
              onChange={(e) => onChange({ ...auth, password: e.target.value })}
            />
          </Field>
        </>
      )}

      {auth.type === 'none' && (
        <p className="px-3 py-4 text-xs text-text-4 italic">{tr('No authentication will be added to this request.')}</p>
      )}
    </div>
  )
}
