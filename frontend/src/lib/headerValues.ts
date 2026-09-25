export type HeaderValueKind = 'uuid7' | 'timestamp' | 'http-date'
export type TimestampFormat = 'seconds' | 'milliseconds' | 'iso'

export function headerValueKind(name: string): HeaderValueKind | null {
  const key = name.trim().toLowerCase().replace(/[_-]/g, '').replace(/^x/, '')
  if (['requestid', 'correlationid', 'idempotencykey', 'idempotencekey'].includes(key)) return 'uuid7'
  if (['timestamp', 'requesttimestamp', 'webhooktimestamp'].includes(key)) return 'timestamp'
  if (key === 'date') return 'http-date'
  return null
}

/** UUIDv7: 48-bit Unix milliseconds, version 7, RFC variant and 74 random bits. */
export function uuid7(now = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let time = BigInt(now)
  for (let i = 5; i >= 0; i--) { bytes[i] = Number(time & 255n); time >>= 8n }
  bytes[6] = (bytes[6] & 15) | 112
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function generateHeaderValue(kind: HeaderValueKind, format: TimestampFormat = 'seconds', now = Date.now()): string {
  if (kind === 'uuid7') return uuid7(now)
  if (kind === 'http-date') return new Date(now).toUTCString()
  if (format === 'iso') return new Date(now).toISOString()
  return String(format === 'milliseconds' ? now : Math.floor(now / 1000))
}
