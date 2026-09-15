import { describe, expect, it } from 'vitest'
import { parseLogText } from './parse'
import { importParsingProfile, type ParsingProfile } from './parsingProfiles'

const CUSTOM: ParsingProfile = {
  schemaVersion: 1,
  id: 'acme-v1',
  name: 'Acme logger',
  fieldMappings: {
    timestamp: ['logged_at'], level: ['priority_name'], message: ['description'],
    service: ['app_name'], correlationId: ['context.corr'], duration: ['elapsed_us'],
    requestBody: ['wire.in'], responseBody: ['wire.out'],
  },
  timestamp: { timezoneOffsetMinutes: 120, clockOffsetMs: 250 },
  durationUnit: 'us',
  limits: { maxDepth: 2, maxFields: 50 },
}

describe('configurable parsing profiles', () => {
  it('maps a custom JSON shape, timezone, duration unit, bodies and explicit source offset', () => {
    const event = parseLogText(JSON.stringify({
      logged_at: '2026-09-15T10:00:00', priority_name: 'WARNING', description: 'custom',
      app_name: 'ledger', context: { corr: 'corr-1' }, elapsed_us: 2500,
      wire: { in: { amount: 9 }, out: { accepted: false } },
    }), { parsingProfile: CUSTOM }).events[0]

    expect(event).toMatchObject({
      service: 'ledger', correlationId: 'corr-1', level: 'warn', message: 'custom',
      parsingProfileId: 'acme-v1', clockOffsetMs: 250, normalizedDurationMs: 2.5,
      normalizedRequestBody: { amount: 9 }, normalizedResponseBody: { accepted: false },
    })
    expect(event.tsOriginal).toBe(Date.parse('2026-09-15T08:00:00Z'))
    expect(event.ts).toBe(event.tsOriginal! + 250)
  })

  it('uses profile multiline rules without changing application code', () => {
    const profile: ParsingProfile = {
      schemaVersion: 1, id: 'pipe-v1', name: 'Pipe continuation', fieldMappings: {},
      multiline: { continuationPattern: '^\\|' },
    }
    const parsed = parseLogText('2026-09-15T10:00:00Z ERROR failed\n| detail one\n| detail two\n2026-09-15T10:00:01Z INFO done', { parsingProfile: profile })
    expect(parsed.events).toHaveLength(2)
    expect(parsed.events[0].lineCount).toBe(3)
  })

  it('warns when configured indexing limits hide searchable leaves', () => {
    const profile = { ...CUSTOM, limits: { maxDepth: 1, maxFields: 25 } }
    const nested = { a: { b: { c: 'hidden' } }, ...Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`k${index}`, index])) }
    const result = parseLogText(JSON.stringify(nested), { parsingProfile: profile })
    expect(result.summary.warningCount).toBeGreaterThan(0)
    expect(result.events[0].normalizationWarnings?.join(' ')).toMatch(/stopped/i)
  })

  it('rejects invalid portable profiles with an actionable error', () => {
    expect(() => importParsingProfile('{"schemaVersion":1,"id":"x","name":"","fieldMappings":{}}')).toThrow(/name is required/i)
  })
})
