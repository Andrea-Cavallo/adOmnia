// Kafka message fixtures: a captured message saved as a small, git-friendly JSON file
// that the producer can load back to replay it.

export const FIXTURE_FORMAT = 'adomnia-kafka-fixture'

export interface KafkaFixture {
  format: typeof FIXTURE_FORMAT
  version: 1
  topic: string
  key: string
  headers: Record<string, string>
  value: string
  source?: { partition?: number; offset?: number; timestamp?: string }
}

export interface FixtureMessage {
  key?: string
  value?: string
  partition?: number
  offset?: number
  timestamp?: string
  headers?: Record<string, string>
}

export function toFixture(topic: string, message: FixtureMessage): KafkaFixture {
  return {
    format: FIXTURE_FORMAT,
    version: 1,
    topic,
    key: message.key ?? '',
    headers: message.headers ?? {},
    value: message.value ?? '',
    source: { partition: message.partition, offset: message.offset, timestamp: message.timestamp },
  }
}

export function fixtureFileName(fixture: KafkaFixture): string {
  const safe = (fixture.topic || 'message').replace(/[^\w.-]+/g, '_')
  const at = fixture.source?.offset != null ? `-p${fixture.source.partition ?? 0}-o${fixture.source.offset}` : ''
  return `${safe}${at}.kafka.json`
}

/** Parses a fixture file; throws a readable error when it is not one. */
export function parseFixture(text: string): KafkaFixture {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('The file is not valid JSON.') }
  const f = raw as Partial<KafkaFixture>
  if (!f || typeof f !== 'object' || f.format !== FIXTURE_FORMAT) throw new Error('Not an adOmnia Kafka fixture (missing "format": "adomnia-kafka-fixture").')
  if (typeof f.value !== 'string') throw new Error('The fixture has no "value" string.')
  const headers = f.headers && typeof f.headers === 'object' ? f.headers : {}
  return {
    format: FIXTURE_FORMAT,
    version: 1,
    topic: typeof f.topic === 'string' ? f.topic : '',
    key: typeof f.key === 'string' ? f.key : '',
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, String(v)])),
    value: f.value,
    source: f.source,
  }
}
