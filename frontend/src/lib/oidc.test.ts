import { describe, expect, it } from 'vitest'
import { discoverOidcProvider, OidcError, validateIdToken, type JwksDocument } from './oidc'

function b64Url(value: string | ArrayBuffer) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)
  let raw = ''
  bytes.forEach((byte) => { raw += String.fromCharCode(byte) })
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function signedJwt(payload: Record<string, unknown>, kid = 'kid-1') {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const header = { alg: 'RS256', typ: 'JWT', kid }
  const signingInput = `${b64Url(JSON.stringify(header))}.${b64Url(JSON.stringify(payload))}`
  const signature = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, pair.privateKey, new TextEncoder().encode(signingInput))
  return {
    token: `${signingInput}.${b64Url(signature)}`,
    jwks: { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] } as JwksDocument,
  }
}

describe('oidc', () => {
  it('loads and normalizes discovery', async () => {
    const discovery = await discoverOidcProvider('https://issuer.local/', async <T>(url: string) => {
      expect(url).toBe('https://issuer.local/.well-known/openid-configuration')
      return {
        issuer: 'https://issuer.local',
        authorization_endpoint: 'https://issuer.local/auth',
        token_endpoint: 'https://issuer.local/token',
        userinfo_endpoint: 'https://issuer.local/userinfo',
        jwks_uri: 'https://issuer.local/jwks',
        response_types_supported: ['code'],
      } as T
    })

    expect(discovery.authorizationEndpoint).toBe('https://issuer.local/auth')
    expect(discovery.jwksUri).toBe('https://issuer.local/jwks')
  })

  it('validates a signed ID token', async () => {
    const now = 1_700_000_000
    const { token, jwks } = await signedJwt({
      iss: 'https://issuer.local',
      aud: ['client-a'],
      exp: now + 300,
      iat: now,
      nonce: 'nonce-1',
      sub: 'user-1',
    })

    const claims = await validateIdToken({
      idToken: token,
      issuer: 'https://issuer.local',
      clientId: 'client-a',
      nonce: 'nonce-1',
      jwks,
      now,
    })

    expect(claims.sub).toBe('user-1')
  })

  it('rejects invalid issuer, audience, expiry, nonce, and signature', async () => {
    const now = 1_700_000_000
    const { token, jwks } = await signedJwt({ iss: 'https://issuer.local', aud: 'client-a', exp: now + 300, iat: now, nonce: 'nonce-1' })

    await expect(validateIdToken({ idToken: token, issuer: 'https://other.local', clientId: 'client-a', jwks, now })).rejects.toMatchObject({ code: 'ISSUER_INVALID' })
    await expect(validateIdToken({ idToken: token, issuer: 'https://issuer.local', clientId: 'client-b', jwks, now })).rejects.toMatchObject({ code: 'AUDIENCE_INVALID' })
    await expect(validateIdToken({ idToken: token, issuer: 'https://issuer.local', clientId: 'client-a', nonce: 'other', jwks, now })).rejects.toMatchObject({ code: 'NONCE_INVALID' })

    const expired = await signedJwt({ iss: 'https://issuer.local', aud: 'client-a', exp: now - 120, iat: now - 300 })
    await expect(validateIdToken({ idToken: expired.token, issuer: 'https://issuer.local', clientId: 'client-a', jwks: expired.jwks, now })).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' })

    const tampered = token.replace(/\.[^.]+$/, `.${b64Url('bad-signature')}`)
    await expect(validateIdToken({ idToken: tampered, issuer: 'https://issuer.local', clientId: 'client-a', jwks, now })).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' })
  })

  it('uses refreshed JWKS when the key rotated', async () => {
    const now = 1_700_000_000
    const { token, jwks } = await signedJwt({ iss: 'https://issuer.local', aud: 'client-a', exp: now + 300, iat: now }, 'new-key')

    await expect(validateIdToken({
      idToken: token,
      issuer: 'https://issuer.local',
      clientId: 'client-a',
      jwks: { keys: [] },
      now,
      fetchJwks: async () => jwks,
    })).resolves.toMatchObject({ iss: 'https://issuer.local' })
  })

  it('classifies discovery failures', async () => {
    await expect(discoverOidcProvider('https://issuer.local', async () => { throw new Error('offline') }))
      .rejects.toBeInstanceOf(OidcError)
  })
})
