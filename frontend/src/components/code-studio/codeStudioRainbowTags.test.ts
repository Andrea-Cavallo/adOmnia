import { describe, expect, it } from 'vitest'
import { rainbowTagRanges } from './codeStudioRainbowTags'

const tags = (text: string, html = true) => rainbowTagRanges(text, html).map((r) => [text.slice(r.start, r.end), r.level])
describe('rainbow HTML/XML tag pairs', () => {
  it('matches opening and closing tags by nesting depth', () => {
    expect(tags('<div><div><label>x</label></div></div>')).toEqual([['div', 0], ['div', 1], ['label', 2], ['label', 2], ['div', 1], ['div', 0]])
  })
  it('ignores quoted delimiters, comments, CDATA and declarations', () => {
    expect(tags('<?xml version="1.0"?><!DOCTYPE root [<!ELEMENT root ANY>]><root a="> <fake>"><!-- <fake> --><![CDATA[<fake>]]><ns:item /></root>', false)).toEqual([['root', 0], ['ns:item', 1], ['root', 0]])
  })
  it('handles HTML void elements, case and raw text', () => {
    expect(tags('<DIV><input><br/><script>if (a < b) { "<fake>" }</script><style>x<fake>{}</style></div>')).toEqual([['DIV', 0], ['input', 1], ['br', 1], ['script', 1], ['script', 1], ['style', 1], ['style', 1], ['div', 0]])
  })
  it('keeps XML case sensitivity and XML elements named like HTML void tags', () => {
    expect(tags('<root><input><Item/></input></root>', false)).toEqual([['root', 0], ['input', 1], ['Item', 2], ['input', 1], ['root', 0]])
    expect(tags('<Root></root>', false)).toEqual([['Root', 0]])
  })
  it('recovers from incomplete nesting and avoids scanning huge files', () => {
    expect(tags('<a><b></a></orphan><c/>')).toEqual([['a', 0], ['b', 1], ['a', 0], ['c', 0]])
    expect(rainbowTagRanges(' '.repeat(1_000_001), true)).toEqual([])
  })
})

it('scans a hostile DOCTYPE in linear time', () => {
  const started = performance.now()
  rainbowTagRanges('<!doctype[' + ']['.repeat(50_000), false)
  expect(performance.now() - started).toBeLessThan(1000)
  expect(rainbowTagRanges('<!DOCTYPE note [<!ELEMENT note (to)>]><note><to/></note>', false).map((tag) => tag.level)).toEqual([0, 1, 0])
})
