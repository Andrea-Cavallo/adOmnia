import {
  clearManagedSecretsWithPrefix,
  hasManagedSessionSecret,
  hasPlaintextSecret,
  hydrateManagedSecret,
  persistManagedSecret,
} from '@/lib/managedSecrets'
import { encryptToVaultRef, isVaultRef, resolveSecret } from '@/lib/vaultRefs'
import type { DbConnection } from './dbShared'

type DbSecretField = 'password' | 'dsn'

function fields(connection: DbConnection): DbSecretField[] {
  const dsnScope = scope(connection, 'dsn')
  return (
    isVaultRef(connection.dsn)
    || hasManagedSessionSecret(dsnScope)
    || hasEmbeddedCredentials(connection.dsn)
  ) ? ['password', 'dsn'] : ['password']
}

function scope(connection: DbConnection, field: DbSecretField): string {
  return `database:${connection.id}:${field}`
}

function hasEmbeddedCredentials(value: string): boolean {
  if (!value || isVaultRef(value)) return false
  try {
    const parsed = new URL(value)
    return Boolean(parsed.username || parsed.password)
  } catch {
    return /^[^\s:@/]+:[^\s@/]+@/.test(value)
  }
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
  const next = { ...connection }
  let protectedCount = 0
  for (const field of fields(connection)) {
    const value = connection[field]
    if (!hasPlaintextSecret(value)) continue
    next[field] = await encryptToVaultRef(value, passphrase)
    protectedCount++
  }
  if (!protectedCount) throw new Error('Enter a plaintext password or DSN before protecting this connection')
  next.savedInVault = true
  return next
}

export async function resolveDatabaseConnection(connection: DbConnection): Promise<DbConnection> {
  const next = { ...connection }
  for (const field of fields(connection)) next[field] = await resolveSecret(connection[field])
  delete next.savedInVault
  return next
}

export function clearDatabaseConnectionSecrets(id: string): void {
  clearManagedSecretsWithPrefix(`database:${id}:`)
}
