import type { Environment, EnvVariable } from '@/lib/types'
import { uid } from '@/lib/types'
import { isVaultRef } from '@/lib/vaultRefs'

/** Usual delivery stages; each one is an environment, so the stored format never changes. */
export const STANDARD_STAGES = ['Development', 'Testing', 'Certification', 'Production'] as const

export interface MatrixRow {
  key: string
  /** Value per environment id; undefined when that environment does not define the key. */
  values: Record<string, string | undefined>
  secret: boolean
}

/** One row per variable name across all environments, in first-seen order. */
export function matrixRows(environments: Environment[]): MatrixRow[] {
  const rows = new Map<string, MatrixRow>()
  for (const env of environments) {
    for (const variable of env.variables) {
      if (!variable.key.trim()) continue
      const row = rows.get(variable.key) ?? { key: variable.key, values: {}, secret: false }
      row.values[env.id] = variable.value
      row.secret ||= variable.type === 'secret' || isVaultRef(variable.value)
      rows.set(variable.key, row)
    }
  }
  return [...rows.values()]
}

function mapVariables(environments: Environment[], envId: string | null, fn: (vars: EnvVariable[]) => EnvVariable[]): Environment[] {
  return environments.map((env) => (envId === null || env.id === envId ? { ...env, variables: fn(env.variables) } : env))
}

/** Sets `key` in one environment, adding the variable when missing. */
export function setMatrixValue(environments: Environment[], key: string, envId: string, value: string): Environment[] {
  return mapVariables(environments, envId, (vars) => vars.some((v) => v.key === key)
    ? vars.map((v) => (v.key === key ? { ...v, value } : v))
    : [...vars, { id: uid(), key, value, enabled: true, type: 'text' }])
}

export function renameMatrixKey(environments: Environment[], from: string, to: string): Environment[] {
  return mapVariables(environments, null, (vars) => vars.map((v) => (v.key === from ? { ...v, key: to } : v)))
}

export function deleteMatrixKey(environments: Environment[], key: string): Environment[] {
  return mapVariables(environments, null, (vars) => vars.filter((v) => v.key !== key))
}

export function setMatrixSecret(environments: Environment[], key: string, secret: boolean): Environment[] {
  return mapVariables(environments, null, (vars) => vars.map((v) => (v.key === key ? { ...v, type: secret ? 'secret' : 'text' } : v)))
}

/** Adds `key` with an empty value to every environment that lacks it. */
export function addMatrixKey(environments: Environment[], key: string): Environment[] {
  return environments.map((env) => env.variables.some((v) => v.key === key)
    ? env
    : { ...env, variables: [...env.variables, { id: uid(), key, value: '', enabled: true, type: 'text' }] })
}

export const ENVIRONMENTS_FORMAT = 'adomnia-environments'

/**
 * Shareable file: private environments are left out, plain secrets are exported
 * without their value (vault: references stay, they are encrypted).
 */
export function exportEnvironments(environments: Environment[]): string {
  const shared = environments.filter((env) => !env.private).map((env) => ({
    name: env.name,
    variables: env.variables.filter((v) => v.key.trim()).map((v) => ({
      key: v.key,
      value: v.type === 'secret' && !isVaultRef(v.value) ? '' : v.value,
      enabled: v.enabled,
      type: v.type ?? 'text',
    })),
  }))
  return JSON.stringify({ format: ENVIRONMENTS_FORMAT, version: 1, environments: shared }, null, 2)
}

type ImportedVariable = { key?: unknown; value?: unknown; enabled?: unknown; type?: unknown }
type ImportedEnvironment = { name?: unknown; variables?: unknown; values?: unknown }

function toVariables(list: unknown): EnvVariable[] {
  if (!Array.isArray(list)) return []
  return list.flatMap((item: ImportedVariable) => typeof item?.key === 'string' && item.key.trim()
    ? [{
      id: uid(),
      key: item.key,
      value: item.value == null ? '' : String(item.value),
      enabled: item.enabled !== false,
      type: item.type === 'secret' ? 'secret' as const : 'text' as const,
    }]
    : [])
}

function toEnvironment(raw: ImportedEnvironment, fallbackName: string): Environment | null {
  // adOmnia uses `variables`; Postman environments use `values`.
  const variables = toVariables(raw.variables ?? raw.values)
  if (variables.length === 0) return null
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : fallbackName
  return { id: uid(), name, variables }
}

/** Accepts an adOmnia environments file, a single environment, a Postman environment or an array of them. */
export function parseEnvironmentsImport(text: string, fallbackName = 'Imported'): Environment[] {
  const parsed: unknown = JSON.parse(text)
  const list: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { environments?: unknown }).environments)
      ? (parsed as { environments: unknown[] }).environments
      : [parsed]
  return list.flatMap((item, index) => {
    const env = item && typeof item === 'object' ? toEnvironment(item as ImportedEnvironment, list.length > 1 ? `${fallbackName} ${index + 1}` : fallbackName) : null
    return env ? [env] : []
  })
}

/** Same-name environments are merged (imported values win, nothing is deleted); new names are appended. */
export function mergeEnvironments(current: Environment[], imported: Environment[]): Environment[] {
  let next = current
  for (const incoming of imported) {
    const existing = next.find((env) => env.name.toLowerCase() === incoming.name.toLowerCase())
    if (!existing) {
      next = [...next, incoming]
      continue
    }
    const keys = new Set(incoming.variables.map((v) => v.key))
    const kept = existing.variables.filter((v) => !keys.has(v.key))
    const updated = incoming.variables.map((v) => ({ ...v, id: existing.variables.find((old) => old.key === v.key)?.id ?? v.id }))
    next = next.map((env) => (env.id === existing.id ? { ...env, variables: [...kept, ...updated] } : env))
  }
  return next
}
