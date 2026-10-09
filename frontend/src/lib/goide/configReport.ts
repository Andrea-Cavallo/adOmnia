// Config & environment: which variables the code reads, which .env profiles define them,
// and what is missing, unused or different between profiles. Pure, from a devcontext snapshot.
import type { DevEntity, DevSource } from '@/lib/devcontext-api'

export type ConfigStatus = 'ok' | 'missing' | 'unused' | 'partial'

export interface ConfigKey {
  name: string
  /** Where the code reads it (os.Getenv, LookupEnv, env struct tags). */
  usedIn: DevSource[]
  /** Profile file → masked value (secrets stay masked). */
  values: Record<string, string>
  definedIn: DevSource[]
  /** Profiles that do not define a variable the code reads. */
  missingIn: string[]
  status: ConfigStatus
}

export interface ConfigReport {
  /** .env files, `.env` first then by name: each one is a profile. */
  profiles: string[]
  keys: ConfigKey[]
  counts: Record<ConfigStatus, number>
}

const STATUS_ORDER: Record<ConfigStatus, number> = { missing: 0, partial: 1, unused: 2, ok: 3 }

export function profileName(file: string): string {
  const base = file.split('/').pop() ?? file
  return base === '.env' ? 'default' : base.replace(/^\.env\./, '')
}

export function configReport(entities: readonly DevEntity[]): ConfigReport {
  const envvars = entities.filter((entity) => entity.kind === 'envvar')
  const profiles = [...new Set(envvars.flatMap((entity) => entity.sources.filter((s) => s.detector === 'dotenv').map((s) => s.file)))]
    .sort((a, b) => (a.endsWith('/.env') || a === '.env' ? -1 : b.endsWith('/.env') || b === '.env' ? 1 : a.localeCompare(b)))
  const keys = envvars.map((entity): ConfigKey => {
    const usedIn = entity.sources.filter((s) => s.detector !== 'dotenv')
    const definedIn = entity.sources.filter((s) => s.detector === 'dotenv')
    const values: Record<string, string> = {}
    for (const source of definedIn) values[source.file] = entity.attrs[`value@${source.file}`] ?? entity.attrs.value ?? ''
    const missingIn = usedIn.length && definedIn.length ? profiles.filter((profile) => !(profile in values)) : []
    const status: ConfigStatus = !usedIn.length ? 'unused' : !definedIn.length ? 'missing' : missingIn.length ? 'partial' : 'ok'
    return { name: entity.label, usedIn, values, definedIn, missingIn, status }
  }).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name))
  const counts: Record<ConfigStatus, number> = { ok: 0, missing: 0, unused: 0, partial: 0 }
  for (const key of keys) counts[key.status]++
  return { profiles, keys, counts }
}

/** Keys whose value differs between two profiles (masked values compare as-is). */
export function profileDiff(report: ConfigReport, left: string, right: string): Array<{ name: string; left?: string; right?: string }> {
  return report.keys
    .filter((key) => key.values[left] !== key.values[right])
    .map((key) => ({ name: key.name, left: key.values[left], right: key.values[right] }))
}
