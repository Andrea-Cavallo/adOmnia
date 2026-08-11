export function decodePersistedJSON<T>(value: unknown): T {
  if (typeof value === 'string') return JSON.parse(value) as T
  if (value !== null && typeof value === 'object') return value as T
  throw new Error('Persisted JSON value is unavailable')
}
