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
