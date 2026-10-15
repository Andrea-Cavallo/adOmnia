import { describe, expect, it } from 'vitest'
import { activeStop, parseSnippet, renderSnippetText } from './snippet'

describe('parseSnippet', () => {
  it('keeps plain text as a single literal segment', () => {
    const parsed = parseSnippet('SELECT 1')
    expect(parsed.segments).toEqual([{ text: 'SELECT 1' }])
    expect(parsed.stops).toBe(0)
  })

  it('parses placeholders, choices and the final $0', () => {
    const parsed = parseSnippet('${1:nome} ${2|a,b|} $0')
    expect(parsed.stops).toBe(3)
    expect(parsed.segments[0]).toEqual({ text: 'nome', stop: 1, placeholder: 'nome' })
    expect(parsed.segments[1].text).toBe(' ')
    expect(parsed.segments[2]).toEqual({ text: 'a', stop: 2, choices: ['a', 'b'] })
    expect(parsed.segments[4]).toEqual({ text: '', stop: 0 })
  })

  it('parses bare numbered stops with empty text', () => {
    const parsed = parseSnippet('a$1b$0c')
    expect(parsed.stops).toBe(2)
    expect(parsed.segments[1]).toEqual({ text: '', stop: 1 })
    expect(parsed.segments[3]).toEqual({ text: '', stop: 0 })
    expect(parsed.segments[4].text).toBe('c')
  })

  it('renders escaped dollars literally instead of stops', () => {
    const parsed = parseSnippet('costo \\$5, prezzo \\$0')
    expect(parsed.stops).toBe(0)
    expect(parsed.segments).toEqual([{ text: 'costo $5, prezzo $0' }])
  })

  it('keeps nested braces inside placeholder text', () => {
    const parsed = parseSnippet('${1:{$gte: 1}}')
    expect(parsed.stops).toBe(1)
    expect(parsed.segments[0].placeholder).toBe('{$gte: 1}')
    expect(parsed.segments[0].text).toBe('{$gte: 1}')
  })

  it('treats repeated stops with the same number as one tab position', () => {
    const parsed = parseSnippet('a${1:x}b${1:x}c')
    expect(parsed.stops).toBe(1)
    expect(parsed.segments.filter((s) => s.stop === 1)).toHaveLength(2)
  })

  it('does not read stops into dollar-prefixed literals like Mongo operators', () => {
    const parsed = parseSnippet('{"$set": {"$inc": 1}}')
    expect(parsed.stops).toBe(0)
    expect(parsed.segments).toEqual([{ text: '{"$set": {"$inc": 1}}' }])
  })

  it('splits choices on unescaped commas only', () => {
    const parsed = parseSnippet('${1|a\\,b,c|}')
    expect(parsed.segments[0].choices).toEqual(['a,b', 'c'])
    expect(parsed.segments[0].text).toBe('a,b')
  })
})

describe('renderSnippetText', () => {
  it('fills stops from values and keeps literal text', () => {
    const parsed = parseSnippet('SELECT ${1:*} FROM ${2:table} LIMIT ${3:100}')
    expect(renderSnippetText(parsed, { 2: 'users' })).toBe('SELECT * FROM users LIMIT 100')
  })

  it('renders every stop with its default when no value is given', () => {
    const parsed = parseSnippet('${1:nome} ${2|a,b|} $0')
    expect(renderSnippetText(parsed, {})).toBe('nome a ')
  })

  it('gives repeated stops the same value', () => {
    const parsed = parseSnippet('a${1:x}b${1:x}c')
    expect(renderSnippetText(parsed, { 1: 'Z' })).toBe('aZbZc')
  })

  it('lets an explicit empty value clear a stop', () => {
    const parsed = parseSnippet('a${1:x}b')
    expect(renderSnippetText(parsed, { 1: '' })).toBe('ab')
  })

  it('drops snippet syntax and keeps escaped dollars', () => {
    const parsed = parseSnippet('costo \\$10 ${1:qta}')
    expect(renderSnippetText(parsed, { 1: '3' })).toBe('costo $10 3')
    expect(renderSnippetText(parsed, {})).toBe('costo $10 qta')
  })
})

describe('activeStop', () => {
  it('returns absolute spans in the current text', () => {
    const parsed = parseSnippet('ab${1:xy}cd$0')
    expect(parsed.stops).toBe(2)
    expect(activeStop(parsed, 1)).toEqual({ start: 2, end: 4, text: 'xy' })
    expect(activeStop(parsed, 2)).toEqual({ start: 6, end: 6, text: '' })
    expect(activeStop(parsed, 0)).toEqual({ start: 6, end: 6, text: '' })
  })

  it('returns the choices of a choice stop', () => {
    const parsed = parseSnippet('${1|a,b|}')
    expect(activeStop(parsed, 1)).toEqual({ start: 0, end: 1, text: 'a', choices: ['a', 'b'] })
  })

  it('points at the first occurrence of a repeated stop', () => {
    const parsed = parseSnippet('a${1:x}b${1:x}c')
    expect(activeStop(parsed, 1)).toEqual({ start: 1, end: 2, text: 'x' })
  })

  it('returns null when there is no such stop', () => {
    expect(activeStop(parseSnippet('plain text'), 1)).toBeNull()
    expect(activeStop(parseSnippet('${1:a}$0'), 5)).toBeNull()
    expect(activeStop(parseSnippet('${1:a}'), 0)).toBeNull()
    expect(activeStop(parseSnippet('${1:a}'), -1)).toBeNull()
  })

  it('lines up with the text rendered from the defaults', () => {
    const parsed = parseSnippet('${1:nome} ${2|a,b|} $0')
    const text = renderSnippetText(parsed, {})
    const span = activeStop(parsed, 2)
    expect(span).not.toBeNull()
    expect(text.slice(span!.start, span!.end)).toBe(span!.text)
    expect(span!.text).toBe('a')
  })
})
