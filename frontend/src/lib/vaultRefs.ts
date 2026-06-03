import { GetServerPort } from '@/wailsjs/go/main/App'
import { serverUrl, sidecarFetch } from '@/lib/useServerPort'

const VAULT_REF_PREFIX = 'vault:'

export function isVaultRef(value: string): boolean {
  return value.trim().startsWith(VAULT_REF_PREFIX)
}

function unwrapVaultRef(value: string): string {
  return value.trim().slice(VAULT_REF_PREFIX.length).trim()
}

async function decryptVaultRef(value: string): Promise<string> {
  let port = 0
  try {
    port = await GetServerPort()
  } catch {
    port = 0
  }
  const url = serverUrl(port || null, '/vault/decrypt')
  if (!url) throw new Error('Vault backend is not available')
  const ciphertext = unwrapVaultRef(value)
  if (!ciphertext) throw new Error('Vault reference is empty')
  const res = await sidecarFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ciphertext }),
  })
  const text = await res.text()
  if (!res.ok) {
    const reason = res.status === 423 ? 'Unlock Vault before sending requests that use vault: references.' : text || res.statusText
    throw new Error(reason)
  }
  const parsed = text ? JSON.parse(text) as { plaintext?: string } : {}
  return parsed.plaintext ?? ''
}

export async function resolveVaultReferences(vars: Record<string, string>): Promise<Record<string, string>> {
  const entries = await Promise.all(Object.entries(vars).map(async ([key, value]) => {
    if (!isVaultRef(value)) return [key, value] as const
    return [key, await decryptVaultRef(value)] as const
  }))
  return Object.fromEntries(entries)
}

/**
 * Resolve a single value that may be a `vault:` reference to its plaintext.
 * Plain (non-reference) values are returned unchanged. Requires the Vault to be
 * unlocked when the value is a reference.
 */
export async function resolveSecret(value: string): Promise<string> {
  if (!isVaultRef(value)) return value
  return decryptVaultRef(value)
}

/**
 * Encrypt a plaintext secret with the given Vault passphrase and return it as a
 * `vault:<ciphertext>` reference suitable for storing at rest (settings, env).
 * The plaintext is never persisted by the caller.
 */
export async function encryptToVaultRef(plaintext: string, passphrase: string): Promise<string> {
  if (!plaintext) throw new Error('Nothing to encrypt')
  if (!passphrase) throw new Error('Vault passphrase is required to encrypt the secret')
  let port = 0
  try {
    port = await GetServerPort()
  } catch {
    port = 0
  }
  const url = serverUrl(port || null, '/vault/encrypt')
  if (!url) throw new Error('Vault backend is not available')
  const res = await sidecarFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plaintext, passphrase }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(text || res.statusText)
  const parsed = text ? JSON.parse(text) as { ciphertext?: string } : {}
  if (!parsed.ciphertext) throw new Error('Vault returned no ciphertext')
  return `${VAULT_REF_PREFIX}${parsed.ciphertext}`
}
