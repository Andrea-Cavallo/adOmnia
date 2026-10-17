import { describe, expect, it } from 'vitest'
import {
  HISTORY_SEARCH_EXCERPT_CHARS, dropRedundantBodyBase64, isTextualResponse, responseWeight, trimHistoryByWeight,
} from './responseMemory'

describe('response weight', () => {
  it('counts body, the base64 twin and the headers, with per-entry overhead', () => {
    const weight = responseWeight({ body: 'x'.repeat(1000), bodyBase64: 'y'.repeat(137), headers: { 'Content-Type': 'application/json' } })
    expect(weight).toBe(512 + 1000 + 137 + 'Content-Type'.length + 'application/json'.length)
    expect(responseWeight(null)).toBe(0)
    expect(responseWeight({})).toBe(512)
  })
})

describe('history budget', () => {
  const entry = (id: string, bytes: number) => ({ id, weight: bytes })

  it('trims by count, newest first', () => {
    const entries = ['a', 'b', 'c'].map((id) => entry(id, 10))
    expect(trimHistoryByWeight(entries, { maxEntries: 2, maxBytes: 10_000 }, (item) => item.weight).map((item) => item.id))
      .toEqual(['a', 'b'])
  })

  it('trims by weight even below the count limit', () => {
    const entries = [entry('a', 10), entry('b', 4_000), entry('c', 4_000)]
    // Un solo budget per peso: restano la più recente e una vecchia che ci sta.
    expect(trimHistoryByWeight(entries, { maxEntries: 20, maxBytes: 5_000 }, (item) => item.weight).map((item) => item.id))
      .toEqual(['a', 'b'])
  })

  it('always keeps the newest entry, even one larger than the whole budget', () => {
    const entries = [entry('huge', 50_000_000), entry('old', 10)]
    expect(trimHistoryByWeight(entries, { maxEntries: 20, maxBytes: 1_000 }, (item) => item.weight).map((item) => item.id))
      .toEqual(['huge'])
    expect(trimHistoryByWeight([], { maxEntries: 20, maxBytes: 1_000 }, () => 0)).toEqual([])
    expect(trimHistoryByWeight(entries, { maxEntries: 0, maxBytes: 1_000 }, () => 0)).toEqual([])
  })
})

describe('body base64 twin', () => {
  it('recognises textual bodies', () => {
    expect(isTextualResponse('application/json; charset=utf-8', '{"a":1}')).toBe(true)
    expect(isTextualResponse('text/plain', 'hello')).toBe(true)
    expect(isTextualResponse('image/png', 'binary')).toBe(false)
    expect(isTextualResponse('application/pdf', 'binary')).toBe(false)
    // Senza content-type decide il contenuto: NUL o caratteri persi significano binario.
    expect(isTextualResponse('', 'plain text')).toBe(true)
    expect(isTextualResponse('', 'bin\u0000ary')).toBe(false)
    expect(isTextualResponse('', 'moji\uFFFDcke')).toBe(false)
  })

  it('drops the twin only for textual responses', () => {
    const text = dropRedundantBodyBase64({ body: 'hello', bodyBase64: 'aGVsbG8=', contentType: 'text/plain' })
    expect(text.bodyBase64).toBeUndefined()
    expect(text.body).toBe('hello')
    const image = dropRedundantBodyBase64({ body: '?', bodyBase64: 'aGVsbG8=', contentType: 'image/png' })
    expect(image.bodyBase64).toBe('aGVsbG8=')
    expect(dropRedundantBodyBase64({ body: 'hello', contentType: 'text/plain' }).body).toBe('hello')
  })

  it('bounds the history search excerpt', () => {
    expect(HISTORY_SEARCH_EXCERPT_CHARS).toBeLessThan(64_000)
  })
})
