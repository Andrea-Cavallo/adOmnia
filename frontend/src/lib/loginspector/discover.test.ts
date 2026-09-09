import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseLogText } from './parse'
import { filterEvents, EMPTY_FILTERS } from './query'
import {
  discoverFields,
  forgetSchema,
  loadSchemas,
  rememberSchema,
  rememberedPaths,
} from './discover'

// A custom application format nobody modelled.
const CUSTOM = [
  '{"ts":"2026-03-11T09:14:01.900Z","lvl":"INFO","attributes":{"http":{"method":"POST","status_code":201},"tenant":"acme"},"merchantId":"M-1","msg":"created"}',
  '{"ts":"2026-03-11T09:14:02.100Z","lvl":"ERROR","attributes":{"http":{"method":"POST","status_code":502},"tenant":"acme"},"merchantId":"M-2","msg":"failed"}',
  '{"ts":"2026-03-11T09:14:02.400Z","lvl":"INFO","attributes":{"http":{"method":"GET","status_code":200},"tenant":"globex"},"merchantId":"M-1","msg":"read"}',
].join('\n')

function customEvents() {
  return parseLogText(CUSTOM).events
}

describe('field discovery', () => {
  it('finds nested keys of a custom format without configuration', () => {
    const { fields, sampled, total } = discoverFields(customEvents())
    const paths = fields.map((field) => field.path)

    expect(sampled).toBe(3)
    expect(total).toBe(3)
    expect(paths).toContain('attributes')
    expect(paths).toContain('attributes.http')
    expect(paths).toContain('attributes.http.status_code')
    expect(paths).toContain('attributes.tenant')
    expect(paths).toContain('merchantId')
  })

  it('reports coverage, kinds and the most frequent values', () => {
    const { fields } = discoverFields(customEvents())
    const status = fields.find((field) => field.path === 'attributes.http.status_code')!
    const tenant = fields.find((field) => field.path === 'attributes.tenant')!

    expect(status.count).toBe(3)
    expect(status.coverage).toBe(1)
    expect(status.kinds).toEqual(['number'])
    expect(tenant.values[0]).toEqual({ value: 'acme', count: 2 })
    expect(tenant.distinct).toBe(2)
  })

  it('marks a high-cardinality field instead of listing every value', () => {
    const many = Array.from({ length: 200 }, (_, i) => `{"msg":"x","reqId":"r-${i}"}`).join('\n')
    const field = discoverFields(parseLogText(many).events).fields.find((entry) => entry.path === 'reqId')!
    expect(field.distinct).toBe(-1)
    expect(field.values).toEqual([])
  })

  it('sorts the most common fields first', () => {
    const mixed = '{"msg":"a","always":1}\n{"msg":"b","always":1,"sometimes":2}'
    const paths = discoverFields(parseLogText(mixed).events).fields.map((field) => field.path)
    expect(paths.indexOf('always')).toBeLessThan(paths.indexOf('sometimes'))
  })

  it('samples large batches instead of scanning everything', () => {
    const many = Array.from({ length: 50_000 }, (_, i) => `{"msg":"m${i}","svcTag":"t"}`).join('\n')
    const discovery = discoverFields(parseLogText(many).events, { sampleSize: 500 })
    expect(discovery.total).toBe(50_000)
    expect(discovery.sampled).toBeLessThanOrEqual(500)
    expect(discovery.fields.map((field) => field.path)).toContain('svcTag')
  })

  it('returns nothing for a plain-text log', () => {
    const discovery = discoverFields(parseLogText('just a line\nand another').events)
    expect(discovery.fields).toEqual([])
    expect(discovery.fingerprint).toBe('')
  })

  it('gives the same fingerprint to two imports of the same shape', () => {
    const first = discoverFields(customEvents())
    const second = discoverFields(parseLogText(CUSTOM.split('\n')[0]).events)
    expect(first.fingerprint).toBe(second.fingerprint)
    expect(first.fingerprint).not.toBe('')
  })

  it('gives different fingerprints to different shapes', () => {
    const other = discoverFields(parseLogText('{"totally":"different","shape":1}').events)
    expect(other.fingerprint).not.toBe(discoverFields(customEvents()).fingerprint)
  })

  it('makes every discovered field searchable', () => {
    const events = customEvents()
    const filters = { ...EMPTY_FILTERS, query: 'attributes.http.status_code:502' }
    expect(filterEvents(events, filters).map((event) => event.message)).toEqual(['failed'])
    expect(filterEvents(events, { ...EMPTY_FILTERS, query: 'attributes.tenant:acme' })).toHaveLength(2)
  })
})

describe('remembered schemas', () => {
  const values = new Map<string, string>()

  beforeEach(() => {
    values.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
  })

  it('stores the discovered paths under the shape fingerprint', () => {
    const discovery = discoverFields(customEvents())
    const stored = rememberSchema(discovery, 'payments.log')!

    expect(stored.name).toBe('payments.log')
    expect(stored.seen).toBe(1)
    expect(stored.paths).toContain('attributes.http.status_code')
    expect(loadSchemas()[discovery.fingerprint]).toBeDefined()
  })

  it('keeps a field seen in an earlier import of the same shape', () => {
    const first = discoverFields(parseLogText('{"ts":"t","lvl":"INFO","msg":"a","attributes":{"tenant":"acme"},"merchantId":"M-1","legacyField":"gone"}').events)
    rememberSchema(first, 'payments.log')

    const second = discoverFields(customEvents())
    const stored = rememberSchema(second, 'payments-2.log')!

    expect(stored.seen).toBe(2)
    expect(stored.name).toBe('payments.log') // the first name is kept
    expect(stored.paths).toContain('legacyField')
    expect(stored.paths).toContain('attributes.http.status_code')
    expect(rememberedPaths(second.signature)).toContain('legacyField')
  })

  it('does not merge two genuinely different shapes', () => {
    rememberSchema(discoverFields(customEvents()), 'payments.log')
    const other = discoverFields(parseLogText('{"totally":"different","shape":1,"nothing":"shared"}').events)
    const stored = rememberSchema(other, 'other.log')!

    expect(stored.seen).toBe(1)
    expect(stored.name).toBe('other.log')
    expect(Object.keys(loadSchemas())).toHaveLength(2)
  })

  it('learns nothing from a plain-text log', () => {
    expect(rememberSchema(discoverFields(parseLogText('plain line').events), 'x.log')).toBeNull()
    expect(loadSchemas()).toEqual({})
  })

  it('forgets a schema on request', () => {
    const discovery = discoverFields(customEvents())
    rememberSchema(discovery, 'payments.log')
    forgetSchema(discovery.fingerprint)
    expect(loadSchemas()[discovery.fingerprint]).toBeUndefined()
  })

  it('survives localStorage being unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('quota') },
    })
    expect(() => rememberSchema(discoverFields(customEvents()), 'x.log')).not.toThrow()
    expect(loadSchemas()).toEqual({})
  })
})
