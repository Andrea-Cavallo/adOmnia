import { useEnvironmentsStore } from '@/stores/environments'
import { substVars } from '@/lib/substVars'
import { isVaultRef, resolveVaultReferences } from '@/lib/vaultRefs'

/** Active environment variables with `vault:` values decrypted; a locked Vault leaves those tokens unresolved. */
export async function activeEnvVars(): Promise<Record<string, string>> {
  const vars = useEnvironmentsStore.getState().getResolvedVars()
  try {
    return await resolveVaultReferences(vars)
  } catch {
    return Object.fromEntries(Object.entries(vars).filter(([, value]) => !isVaultRef(value)))
  }
}

function substituteDeep(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') return value.includes('{{') ? substVars(value, vars) : value
  if (Array.isArray(value)) return value.map((item) => substituteDeep(item, vars))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substituteDeep(item, vars)]))
  }
  return value
}

/** New copy of `value` with `{{VAR}}` resolved in every string, for modules outside the HTTP pipeline. */
export async function withActiveEnv<T>(value: T): Promise<T> {
  return substituteDeep(value, await activeEnvVars()) as T
}
