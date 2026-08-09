import { isVaultRef } from '@/lib/vaultRefs'

const REDACTED = '***REDACTED***'
const SENSITIVE_KEY = /(password|passwd|passphrase|token|secret|api[-_]?key|authorization|cookie|private[-_]?key|access[-_]?key)/i

function hasEmbeddedCredentials(value: string): boolean {
  if (isVaultRef(value)) return false
  try {
    const parsed = new URL(value)
    return Boolean(parsed.username || parsed.password)
  } catch {
    return /^[^\s:@/]+:[^\s@/]+@/.test(value) || /^[^\s:@/]+:[^\s@/]+@tcp\(/i.test(value)
  }
}

function redactString(key: string, value: string): string {
  if (!value || isVaultRef(value)) return value
  if (SENSITIVE_KEY.test(key)) return REDACTED
  if (/^(dsn|url)$/i.test(key) && hasEmbeddedCredentials(value)) return REDACTED
  return value
}

export function redactSensitiveData<T>(value: T): T {
  const walk = (input: unknown, key = ''): unknown => {
    if (input == null) return input
    if (typeof input === 'string') return redactString(key, input)
    if (Array.isArray(input)) return input.map((item) => walk(item, key))
    if (typeof input !== 'object') return input

    const record = input as Record<string, unknown>
    const namedSecret = ['key', 'name', 'header'].some((nameKey) => (
      typeof record[nameKey] === 'string' && SENSITIVE_KEY.test(record[nameKey])
    ))
    const typedSecret = typeof record.type === 'string' && record.type.toLowerCase() === 'secret'

    return Object.fromEntries(Object.entries(record).map(([childKey, child]) => {
      if ((namedSecret || typedSecret) && childKey.toLowerCase() === 'value' && typeof child === 'string' && !isVaultRef(child)) {
        return [childKey, REDACTED]
      }
      return [childKey, walk(child, childKey)]
    }))
  }

  return walk(value) as T
}
