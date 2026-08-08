import { asSecretRef, type SecretRef } from '@/lib/vaultRefs'

export type PersistedSecret = SecretRef | ''

const sessionSecrets = new Map<string, string>()

/**
 * Converts a runtime credential into its safe at-rest representation.
 * Plaintext remains available only in renderer memory for the current session.
 */
export function persistManagedSecret(scope: string, value: string): PersistedSecret {
  const ref = asSecretRef(value)
  if (ref) {
    sessionSecrets.delete(scope)
    return ref
  }
  if (value) sessionSecrets.set(scope, value)
  else sessionSecrets.delete(scope)
  return ''
}

/** Restores a session-only credential without ever reading it from disk. */
export function hydrateManagedSecret(scope: string, persisted: string): string {
  return asSecretRef(persisted) ?? sessionSecrets.get(scope) ?? ''
}

export function hasManagedSessionSecret(scope: string): boolean {
  return sessionSecrets.has(scope)
}

export function clearManagedSecret(scope: string): void {
  sessionSecrets.delete(scope)
}

export function clearManagedSecretsWithPrefix(prefix: string): void {
  for (const scope of sessionSecrets.keys()) {
    if (scope.startsWith(prefix)) sessionSecrets.delete(scope)
  }
}

export function hasPlaintextSecret(value: string): boolean {
  return Boolean(value) && asSecretRef(value) === null
}

/** Test-only reset for the module-local session registry. */
export function clearManagedSecretSession(): void {
  sessionSecrets.clear()
}
