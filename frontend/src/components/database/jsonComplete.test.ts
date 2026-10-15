import { describe, expect, it } from 'vitest'
import { jsonCompletions, type JsonCompleteContext } from './jsonComplete'

const mongo: JsonCompleteContext = {
  driver: 'mongodb',
  collections: ['utenti', 'ordini'],
  fields: { utenti: ['nome', 'stato', 'eta'] },
}
const redis: JsonCompleteContext = { driver: 'redis', collections: [], fields: {} }

/** `|` marks the caret. */
function complete(source: string, ctx = mongo, explicit = false) {
  const caret = source.indexOf('|')
  const text = source.replace('|', '')
  const result = jsonCompletions(text, caret, ctx, explicit)
  return result?.items.map((i) => i.label) ?? null
}

describe('jsonCompletions', () => {
  it('offers the operation names inside the operation value', () => {
    expect(complete('{ "operation": "upd|" }')).toEqual(['updateOne', 'updateMany'])
  })

  it('offers collections from the schema', () => {
    expect(complete('{ "operation": "find", "collection": "u|" }')).toEqual(['utenti'])
  })

  it('offers top-level keys in a key position', () => {
    expect(complete('{ "op|" }')).toContain('operation')
    expect(complete('{ "operation": "find", "col|" }')).toEqual(['collection'])
  })

  it('offers the known fields of the chosen collection inside filter', () => {
    expect(complete('{ "collection": "utenti", "filter": { "st|" } }')).toEqual(['stato'])
  })

  it('offers operators after a dollar sign and update operators in update', () => {
    expect(complete('{ "collection": "utenti", "filter": { "eta": { "$g|" } } }')).toEqual(['$gt', '$gte'])
    expect(complete('{ "collection": "utenti", "update": { "$s|" } }')).toEqual(['$set', '$setOnInsert'])
  })

  it('offers fields inside $set', () => {
    expect(complete('{ "collection": "utenti", "update": { "$set": { "no|" } } }')).toEqual(['nome'])
  })

  it('offers aggregation stages inside the pipeline', () => {
    const items = complete('{ "collection": "utenti", "pipeline": [ { "$ma|" } ] }')
    expect(items).toContain('$match')
  })

  it('quotes the label when the key is not already inside a string', () => {
    expect(complete('{ "collection": "utenti", "filter": { st| } }')).toEqual(['"stato"'])
  })

  it('suggests Redis commands', () => {
    expect(complete('{ "command": "HG|" }', redis)).toEqual(['HGET', 'HGETALL'])
  })

  it('degrades to null on broken JSON and outside objects', () => {
    expect(complete('')).toBeNull()
    expect(complete('{ "operation": "fi|"', mongo)).toEqual(['find'])
    expect(complete('[ "x|" ]')).toBeNull()
    expect(complete('{ "filter": { "a": 1,, "|')).toBeNull()
  })
})
