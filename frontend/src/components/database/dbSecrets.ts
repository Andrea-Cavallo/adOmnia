import {
  clearManagedSecretsWithPrefix,
  hasPlaintextSecret,
  hydrateManagedSecret,
  persistManagedSecret,
} from '@/lib/managedSecrets'
import { isVaultRef, resolveVaultReferences } from '@/lib/vaultRefs'
import { substVars } from '@/lib/substVars'
import { useEnvironmentsStore } from '@/stores/environments'
import type { DbConnection } from './dbShared'
import { getServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'

export async function sealDatabaseConnection(connection: DbConnection, extraPassphrase?: string): Promise<DbConnection> {
  const port = await getServerPort()
  if (!port) throw new Error('Backend not ready; credentials have not been saved')
  const res = await sidecarFetch(serverUrl(port, '/database/seal'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...connection, ...(extraPassphrase ? { extraPassphrase } : {}) }) })
  if (!res.ok) throw new Error((await res.text()).trim() || 'Could not encrypt database credentials')
  const data = await res.json() as { connection: DbConnection; fallback: boolean }
  if (data.fallback) data.connection.credentialWarning = 'System keychain unavailable: the encryption key uses a restricted local file. Protect your application data directory.'
  return data.connection
}

type DbSecretField = 'password' | 'dsn'

function fields(_connection: DbConnection): DbSecretField[] {
  return ['password', 'dsn']
}

function scope(connection: DbConnection, field: DbSecretField): string {
  return `database:${connection.id}:${field}`
}

export function hydrateDatabaseConnections(connections: DbConnection[]): DbConnection[] {
  return connections.map((connection) => {
    const next = { ...connection }
    for (const field of fields(connection)) {
      const value = connection[field]
      if (hasPlaintextSecret(value)) {
        persistManagedSecret(scope(connection, field), value)
        next[field] = value
      } else {
        next[field] = hydrateManagedSecret(scope(connection, field), value)
      }
    }
    next.savedInVault = fields(next).some((field) => isVaultRef(next[field]))
    return next
  })
}

export function serializeDatabaseConnections(connections: DbConnection[]): string {
  return JSON.stringify(connections.map((connection) => {
    const next = { ...connection }
    for (const field of fields(connection)) {
      if (hasPlaintextSecret(connection[field])) throw new Error('Encrypt database credentials before saving')
      next[field] = persistManagedSecret(scope(connection, field), connection[field])
    }
    next.savedInVault = fields(next).some((field) => isVaultRef(next[field]))
    return next
  }))
}

export function databaseCredentialState(connection: DbConnection): 'none' | 'session' | 'vault' {
  const values = fields(connection).map((field) => connection[field]).filter(Boolean)
  if (values.some(hasPlaintextSecret)) return 'session'
  if (values.some(isVaultRef)) return 'vault'
  return 'none'
}

export async function protectDatabaseConnection(connection: DbConnection, passphrase: string): Promise<DbConnection> {
  if (!passphrase) throw new Error('Enter a passphrase for extra protection')
  return sealDatabaseConnection(connection, passphrase)
}

const VAR_FIELDS = ['dsn', 'host', 'database', 'collection', 'user', 'password', 'sqlitePath', 'options'] as const

export async function resolveDatabaseConnection(connection: DbConnection): Promise<DbConnection> {
  const next = { ...connection }
  // References stay opaque in the renderer. Only the Go database runner opens them.
  // {{VAR}} from the active adOmnia environment work in every connection field.
  const vars = useEnvironmentsStore.getState().getResolvedVars()
  // Vault locked: leave {{VAR}} of encrypted values unresolved rather than sending the reference.
  const resolvedVars = await resolveVaultReferences(vars)
    .catch(() => Object.fromEntries(Object.entries(vars).filter(([, value]) => !isVaultRef(value))))
  for (const field of VAR_FIELDS) {
    const value = next[field]
    if (typeof value === 'string' && value.includes('{{')) next[field] = substVars(value, resolvedVars)
  }
  delete next.savedInVault
  return next
}

export function clearDatabaseConnectionSecrets(id: string): void {
  clearManagedSecretsWithPrefix(`database:${id}:`)
}
