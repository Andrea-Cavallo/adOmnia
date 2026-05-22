import { useState } from 'react'
import type { RequestAuth } from '@/lib/types'
import { fetchOAuth2TokenManual } from '@/lib/sendRequest'

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
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')

  const handleFetchToken = async () => {
    setFetching(true)
    setFetchError('')
    try {
      const token = await fetchOAuth2TokenManual(auth)
      onChange({ ...auth, token })
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e))
    } finally {
      setFetching(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 py-2">
      <Field label="Type">
        <select
          value={auth.type}
          onChange={(e) => onChange({ ...auth, type: e.target.value as RequestAuth['type'] })}
          className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-text-1 text-xs focus:border-accent outline-none"
        >
          {AUTH_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>

      {auth.type === 'bearer' && (
        <Field label="Token">
          <Input
            value={auth.token}
            onChange={(e) => onChange({ ...auth, token: e.target.value })}
            placeholder="eyJhbGciOi…"
          />
        </Field>
      )}

      {auth.type === 'basic' && (
        <>
          <Field label="Username">
            <Input value={auth.username} onChange={(e) => onChange({ ...auth, username: e.target.value })} />
          </Field>
          <Field label="Password">
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
          <Field label="Header name">
            <Input
              value={auth.username || 'X-API-Key'}
              onChange={(e) => onChange({ ...auth, username: e.target.value })}
            />
          </Field>
          <Field label="Value">
            <Input value={auth.token} onChange={(e) => onChange({ ...auth, token: e.target.value })} />
          </Field>
        </>
      )}

      {auth.type === 'oauth2' && (
        <>
          <Field label="Grant">
            <select
              value={auth.oauth2GrantType || 'client_credentials'}
              onChange={(e) => onChange({ ...auth, oauth2GrantType: e.target.value })}
              className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-text-1 text-xs focus:border-accent outline-none"
            >
              {OAUTH2_GRANTS.map((grant) => (
                <option key={grant.value} value={grant.value}>
                  {grant.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Token URL">
            <Input
              value={auth.oauth2TokenUrl ?? ''}
              onChange={(e) => onChange({ ...auth, oauth2TokenUrl: e.target.value })}
              placeholder="https://auth.your-domain.com/oauth/token"
            />
          </Field>
          <Field label="Client ID">
            <Input
              value={auth.oauth2ClientId ?? ''}
              onChange={(e) => onChange({ ...auth, oauth2ClientId: e.target.value })}
            />
          </Field>
          <Field label="Client Secret">
            <Input
              type="password"
              value={auth.oauth2ClientSecret ?? ''}
              onChange={(e) => onChange({ ...auth, oauth2ClientSecret: e.target.value })}
            />
          </Field>
          <Field label="Scope">
            <Input
              value={auth.oauth2Scope ?? ''}
              onChange={(e) => onChange({ ...auth, oauth2Scope: e.target.value })}
              placeholder="openid profile"
            />
          </Field>
          {auth.oauth2GrantType === 'password' && (
            <>
              <Field label="Username">
                <Input
                  value={auth.username ?? ''}
                  onChange={(e) => onChange({ ...auth, username: e.target.value })}
                />
              </Field>
              <Field label="Password">
                <Input
                  type="password"
                  value={auth.password ?? ''}
                  onChange={(e) => onChange({ ...auth, password: e.target.value })}
                />
              </Field>
            </>
          )}
          {auth.oauth2GrantType === 'refresh_token' && (
            <Field label="Refresh Token">
              <Input
                value={auth.oauth2RefreshToken ?? ''}
                onChange={(e) => onChange({ ...auth, oauth2RefreshToken: e.target.value })}
              />
            </Field>
          )}
          {auth.oauth2GrantType === 'authorization_code_pkce' && (
            <>
              <Field label="Auth URL">
                <Input
                  value={auth.oauth2AuthUrl ?? ''}
                  onChange={(e) => onChange({ ...auth, oauth2AuthUrl: e.target.value })}
                  placeholder="https://auth.your-domain.com/oauth/authorize"
                />
              </Field>
              <Field label="Redirect URI">
                <Input
                  value={auth.oauth2RedirectUri ?? ''}
                  onChange={(e) => onChange({ ...auth, oauth2RedirectUri: e.target.value })}
                  placeholder="http://localhost/callback"
                />
              </Field>
              <Field label="Auth Code">
                <Input
                  value={auth.oauth2AuthCode ?? ''}
                  onChange={(e) => onChange({ ...auth, oauth2AuthCode: e.target.value })}
                  placeholder="Paste the returned code"
                />
              </Field>
              <Field label="PKCE Verifier">
                <Input
                  value={auth.oauth2CodeVerifier ?? ''}
                  onChange={(e) => onChange({ ...auth, oauth2CodeVerifier: e.target.value })}
                  placeholder="Code verifier used for the authorization request"
                />
              </Field>
            </>
          )}
          <div className="flex items-center gap-3 px-3">
            <span className="w-28 shrink-0" />
            <button
              onClick={handleFetchToken}
              disabled={fetching || !auth.oauth2TokenUrl}
              className="px-3 py-1 bg-accent text-white rounded text-xs font-medium disabled:opacity-50"
            >
              {fetching ? 'Fetching…' : 'Fetch Token'}
            </button>
            {fetchError && <span className="text-xs text-error">{fetchError}</span>}
          </div>
          {auth.token && (
            <Field label="Access Token">
              <Input value={auth.token} readOnly className="opacity-70 cursor-default" />
            </Field>
          )}
        </>
      )}

      {auth.type === 'aws4' && (
        <>
          <Field label="Access Key ID">
            <Input
              value={auth.awsAccessKeyId ?? ''}
              onChange={(e) => onChange({ ...auth, awsAccessKeyId: e.target.value })}
              placeholder="AKIA..."
            />
          </Field>
          <Field label="Secret Key">
            <Input
              type="password"
              value={auth.awsSecretKey ?? ''}
              onChange={(e) => onChange({ ...auth, awsSecretKey: e.target.value })}
            />
          </Field>
          <Field label="Region">
            <Input
              value={auth.awsRegion ?? ''}
              onChange={(e) => onChange({ ...auth, awsRegion: e.target.value })}
              placeholder="us-east-1"
            />
          </Field>
          <Field label="Service">
            <Input
              value={auth.awsService ?? ''}
              onChange={(e) => onChange({ ...auth, awsService: e.target.value })}
              placeholder="execute-api"
            />
          </Field>
          <Field label="Session Token">
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
          <Field label="Username">
            <Input value={auth.username} onChange={(e) => onChange({ ...auth, username: e.target.value })} />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={auth.password}
              onChange={(e) => onChange({ ...auth, password: e.target.value })}
            />
          </Field>
        </>
      )}

      {auth.type === 'none' && (
        <p className="px-3 py-4 text-xs text-text-4 italic">No authentication will be added to this request.</p>
      )}
    </div>
  )
}
