import { describe, expect, it } from 'vitest'
import { formatSignature, parseFieldList, parseSignatureAt, signatureOrderProblem } from './goStudioChangeSignature'

const source = [
  'package geo',
  '',
  'func (s *Store) Find[T any](ctx context.Context, id, name string, opts ...Option) (*T, error) {',
  '\treturn nil, nil',
  '}',
  '',
  'func Scale(',
  '\tvalue int,',
  '\tfactor map[string]int,',
  ') int {',
  '\treturn 0',
  '}',
  '',
  'func handler(http.ResponseWriter, *http.Request) {}',
].join('\n')

describe('change signature', () => {
  it('parses grouped, variadic and generic signatures from the declaration line', () => {
    const find = parseSignatureAt(source, 3)!
    expect(find).toMatchObject({ name: 'Find', line: 3, column: 17, receiver: '(s *Store)', results: '(*T, error)', resultCount: 2 })
    expect(find.params.map((param) => `${param.name}:${param.type}`)).toEqual(['ctx:context.Context', 'id:string', 'name:string', 'opts:...Option'])
    expect(find.params[3].variadic).toBe(true)
  })

  it('works inside a multi-line signature but not in the body', () => {
    const scale = parseSignatureAt(source, 9)!
    expect(scale).toMatchObject({ name: 'Scale', line: 7, results: 'int', resultCount: 1 })
    expect(scale.params.map((param) => param.type)).toEqual(['int', 'map[string]int'])
    expect(parseSignatureAt(source, 11)).toBeNull()
    expect(parseSignatureAt(source, 1)).toBeNull()
  })

  it('handles unnamed parameters', () => {
    expect(parseSignatureAt(source, 14)!.params).toEqual([
      { name: '', type: 'http.ResponseWriter', variadic: false },
      { name: '', type: '*http.Request', variadic: false },
    ])
    expect(parseFieldList('n int, err error').length).toBe(2)
  })

  it('previews and validates the new order', () => {
    const find = parseSignatureAt(source, 3)!
    expect(formatSignature(find, [1, 0, 3])).toBe('func (s *Store) Find(id string, ctx context.Context, opts ...Option) (*T, error)')
    expect(signatureOrderProblem(find, [0, 1, 2, 3])).toBe('Nothing to change.')
    expect(signatureOrderProblem(find, [3, 0, 1, 2])).toMatch(/variadic/)
    expect(signatureOrderProblem(find, [0, 1, 3])).toBeNull()
  })
})
