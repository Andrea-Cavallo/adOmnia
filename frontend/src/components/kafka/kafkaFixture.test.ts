import { describe, expect, it } from 'vitest'
import { fixtureFileName, parseFixture, toFixture } from './kafkaFixture'

describe('kafka fixtures', () => {
  it('round-trips a consumed message', () => {
    const fixture = toFixture('orders.created', { key: 'o-1', value: '{"id":1}', headers: { 'x-trace': 't1' }, partition: 2, offset: 42 })
    const back = parseFixture(JSON.stringify(fixture, null, 2))
    expect(back).toMatchObject({ topic: 'orders.created', key: 'o-1', value: '{"id":1}', headers: { 'x-trace': 't1' } })
    expect(fixtureFileName(back)).toBe('orders.created-p2-o42.kafka.json')
  })

  it('rejects files that are not fixtures', () => {
    expect(() => parseFixture('nope')).toThrow('not valid JSON')
    expect(() => parseFixture('{"value":"x"}')).toThrow('Not an adOmnia Kafka fixture')
    expect(() => parseFixture('{"format":"adomnia-kafka-fixture"}')).toThrow('no "value"')
  })

  it('stringifies header values and sanitizes the file name', () => {
    const f = parseFixture('{"format":"adomnia-kafka-fixture","value":"","topic":"a/b c","headers":{"n":1}}')
    expect(f.headers).toEqual({ n: '1' })
    expect(fixtureFileName(f)).toBe('a_b_c.kafka.json')
  })
})
