import { describe, expect, it } from 'vitest'
import { CLIENT_TOKEN_MODIFIERS, CLIENT_TOKEN_TYPES, isLiteralArgument, remapSemanticTokens, typeInfoFromHover } from './goStudioSemanticTokens'

const type = (name: string) => CLIENT_TOKEN_TYPES.indexOf(name as never)
const modifier = (name: string) => 1 << CLIENT_TOKEN_MODIFIERS.indexOf(name as never)

describe('remapSemanticTokens', () => {
  it('maps gopls legend indices to the client legend by name', () => {
    const server = ['variable', 'parameter', 'function']
    const modifiers = ['definition', 'readonly']
    // riga 0 col 5 "parameter" definition; stessa riga col 12 "function"
    const data = [0, 5, 4, 1, 0b01, 0, 7, 3, 2, 0]
    expect(Array.from(remapSemanticTokens(data, server, modifiers))).toEqual([0, 5, 4, type('parameter'), modifier('definition'), 0, 7, 3, type('function'), 0])
  })

  it('drops unknown token types without shifting the following tokens', () => {
    const server = ['exotic', 'variable']
    // token scartato a (1,2), token tenuto a (1,10) e poi (3,4)
    const data = [1, 2, 3, 0, 0, 0, 8, 1, 1, 0, 2, 4, 1, 1, 0]
    expect(Array.from(remapSemanticTokens(data, server, []))).toEqual([1, 10, 1, type('variable'), 0, 2, 4, 1, type('variable'), 0])
  })

  it('ignores modifiers the client does not know', () => {
    const data = [0, 0, 3, 0, 0b11]
    expect(Array.from(remapSemanticTokens(data, ['variable'], ['pointer', 'readonly']))).toEqual([0, 0, 3, type('variable'), modifier('readonly')])
  })
})

describe('isLiteralArgument', () => {
  it('shows parameter names only for literals and nil, like GoLand', () => {
    const line = 'total = Compute(5, "x", nil, count, true, -2, `raw`)'
    const column = (needle: string) => line.indexOf(needle) + 1
    expect(isLiteralArgument(line, column('5'))).toBe(true)
    expect(isLiteralArgument(line, column('"x"'))).toBe(true)
    expect(isLiteralArgument(line, column('nil'))).toBe(true)
    expect(isLiteralArgument(line, column('true'))).toBe(true)
    expect(isLiteralArgument(line, column('-2'))).toBe(true)
    expect(isLiteralArgument(line, column('`raw`'))).toBe(true)
    expect(isLiteralArgument(line, column('count'))).toBe(false)
    expect(isLiteralArgument('f(nilable)', 3)).toBe(false)
  })
})

describe('typeInfoFromHover', () => {
  it('extracts the first Go code block from gopls hover', () => {
    expect(typeInfoFromHover('```go\nvar total int\n```\n\nSome docs')).toBe('var total int')
    expect(typeInfoFromHover('plain text only')).toBeNull()
  })
})
