import {
  clearManagedSecretsWithPrefix,
  hasManagedSessionSecret,
  hasPlaintextSecret,
  hydrateManagedSecret,
  persistManagedSecret,
} from '@/lib/managedSecrets'
import { encryptToVaultRef, isVaultRef, resolveSecret, resolveVaultReferences } from '@/lib/vaultRefs'
import { substVars } from '@/lib/substVars'
import { useEnvironmentsStore } from '@/stores/environments'
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

const VAR_FIELDS = ['dsn', 'host', 'database', 'collection', 'user', 'password', 'sqlitePath', 'options'] as const

export async function resolveDatabaseConnection(connection: DbConnection): Promise<DbConnection> {
  const next = { ...connection }
  for (const field of fields(connection)) next[field] = await resolveSecret(connection[field])
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
