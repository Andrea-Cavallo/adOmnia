export const PARSING_PROFILE_SCHEMA_VERSION = 1 as const
export const PARSING_PROFILES_STORAGE_KEY = 'adomnia.loginspector.parsing-profiles.v1'

export type ParsingField =
  | 'timestamp' | 'level' | 'message' | 'service' | 'namespace' | 'pod' | 'container'
  | 'traceId' | 'spanId' | 'parentSpanId' | 'correlationId' | 'requestId' | 'thread' | 'logger'
  | 'duration' | 'requestBody' | 'responseBody'

export type DurationUnit = 'ns' | 'us' | 'ms' | 's'

/** Portable, versioned contract for log shapes not built into adOmnia. */
export interface ParsingProfile {
  schemaVersion: typeof PARSING_PROFILE_SCHEMA_VERSION
  id: string
  name: string
  description?: string
  fieldMappings: Partial<Record<ParsingField, string[]>>
  timestamp?: {
    /** Offset of a zone-less timestamp from UTC, e.g. 120 for Europe/Rome summer time. */
    timezoneOffsetMinutes?: number
    /** Known source clock correction. Positive values move events forward. */
    clockOffsetMs?: number
  }
  durationUnit?: DurationUnit
  multiline?: {
    /** A matching line always begins a new event. JavaScript regex source. */
    startPattern?: string
    /** A matching line is appended to the previous event. JavaScript regex source. */
    continuationPattern?: string
  }
  limits?: {
    maxDepth?: number
    maxFields?: number
  }
}

export const DEFAULT_PARSING_PROFILE: ParsingProfile = {
  schemaVersion: 1,
  id: 'default',
  name: 'Built-in auto detection',
  description: 'adOmnia aliases, timestamp formats and Java/Go multiline recognition.',
  fieldMappings: {},
  durationUnit: 'ms',
  limits: { maxDepth: 5, maxFields: 250 },
}

const FIELD_NAMES = new Set<ParsingField>([
  'timestamp', 'level', 'message', 'service', 'namespace', 'pod', 'container',
  'traceId', 'spanId', 'parentSpanId', 'correlationId', 'requestId', 'thread', 'logger',
  'duration', 'requestBody', 'responseBody',
])

function finiteInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

export function validateParsingProfile(value: unknown): { profile?: ParsingProfile; errors: string[] } {
  const errors: string[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { errors: ['Profile must be a JSON object.'] }
  const input = value as Record<string, unknown>
  if (input.schemaVersion !== 1) errors.push('schemaVersion must be 1.')
  if (typeof input.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(input.id)) errors.push('id must be 2–64 letters, numbers, dots, dashes or underscores.')
  if (typeof input.name !== 'string' || !input.name.trim()) errors.push('name is required.')

  const mappings = input.fieldMappings
  if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) errors.push('fieldMappings must be an object.')
  else for (const [field, paths] of Object.entries(mappings as Record<string, unknown>)) {
    if (!FIELD_NAMES.has(field as ParsingField)) errors.push(`Unknown field mapping: ${field}.`)
    if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string' || !path.trim())) errors.push(`${field} must be an array of field paths.`)
  }

  const timestamp = input.timestamp as Record<string, unknown> | undefined
  if (timestamp?.timezoneOffsetMinutes !== undefined && !finiteInRange(timestamp.timezoneOffsetMinutes, -14 * 60, 14 * 60)) errors.push('timezoneOffsetMinutes must be between -840 and 840.')
  if (timestamp?.clockOffsetMs !== undefined && !finiteInRange(timestamp.clockOffsetMs, -86_400_000, 86_400_000)) errors.push('clockOffsetMs must be within ±24 hours.')
  if (input.durationUnit !== undefined && !['ns', 'us', 'ms', 's'].includes(String(input.durationUnit))) errors.push('durationUnit must be ns, us, ms or s.')

  const multiline = input.multiline as Record<string, unknown> | undefined
  for (const key of ['startPattern', 'continuationPattern'] as const) {
    const pattern = multiline?.[key]
    if (pattern === undefined || pattern === '') continue
    if (typeof pattern !== 'string' || pattern.length > 500) errors.push(`${key} must be a regex string up to 500 characters.`)
    else try { new RegExp(pattern) } catch { errors.push(`${key} is not a valid JavaScript regex.`) }
  }

  const limits = input.limits as Record<string, unknown> | undefined
  if (limits?.maxDepth !== undefined && !finiteInRange(limits.maxDepth, 1, 20)) errors.push('maxDepth must be between 1 and 20.')
  if (limits?.maxFields !== undefined && !finiteInRange(limits.maxFields, 25, 5000)) errors.push('maxFields must be between 25 and 5000.')
  return errors.length ? { errors } : { profile: value as ParsingProfile, errors }
}

export function durationToMilliseconds(value: number, unit: DurationUnit = 'ms'): number {
  if (unit === 'ns') return value / 1_000_000
  if (unit === 'us') return value / 1_000
  if (unit === 's') return value * 1_000
  return value
}

export function importParsingProfile(text: string): ParsingProfile {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('Parsing profile is not valid JSON.') }
  const checked = validateParsingProfile(value)
  if (!checked.profile) throw new Error(checked.errors.join(' '))
  return checked.profile
}

export function exportParsingProfile(profile: ParsingProfile): string {
  return JSON.stringify(profile, null, 2)
}

export function loadParsingProfiles(): ParsingProfile[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(PARSING_PROFILES_STORAGE_KEY) || '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => validateParsingProfile(item).profile ?? [])
  } catch { return [] }
}

export function saveParsingProfiles(profiles: ParsingProfile[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(PARSING_PROFILES_STORAGE_KEY, JSON.stringify(profiles))
}
