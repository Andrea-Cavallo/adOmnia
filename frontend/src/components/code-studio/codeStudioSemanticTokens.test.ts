import { describe, expect, it } from 'vitest'
import { CLIENT_TOKEN_MODIFIERS, CLIENT_TOKEN_TYPES, isLiteralArgument, remapSemanticTokens, typeInfoFromHover, semanticRetryDelay, SEMANTIC_RETRY_LIMIT } from './codeStudioSemanticTokens'

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

  it('keeps Java annotations (@RestController) and maps record/annotation members to near types', () => {
    const server = ['class', 'decorator', 'annotationMember', 'record']
    const data = [0, 1, 14, 1, 0, 0, 20, 5, 2, 0, 1, 0, 6, 3, 0]
    expect(Array.from(remapSemanticTokens(data, server, []))).toEqual([0, 1, 14, type('annotation'), 0, 0, 20, 5, type('property'), 0, 1, 0, 6, type('class'), 0])
  })

  it('ignores modifiers the client does not know', () => {
    const data = [0, 0, 3, 0, 0b11]
    expect(Array.from(remapSemanticTokens(data, ['variable'], ['pointer', 'readonly']))).toEqual([0, 0, 3, type('variable'), modifier('readonly')])
  })
})

describe('isLiteralArgument', () => {
  it('shows parameter names only for literals and nil', () => {
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

describe('semantic token retries', () => {
  it('backs off while gopls is still loading and gives up after the limit', () => {
    const delays = Array.from({ length: SEMANTIC_RETRY_LIMIT + 1 }, (_, attempt) => semanticRetryDelay(attempt))
    expect(delays).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000, null])
    expect(semanticRetryDelay(-1)).toBeNull()
  })
})

describe('Java remap context', () => {
  const types = ['interface', 'variable']
  // riga 0: token "interface" a colonna 1 (dopo '@'), token "variable" a colonna 10
  const data = [0, 1, 4, 0, 0, 0, 9, 3, 1, 0]
  it('retypes @Name as annotation and variables as javaVariable', () => {
    const out = remapSemanticTokens(data, types, [], { isAnnotationAt: (line, start) => line === 0 && start === 1, variableType: 'javaVariable' })
    expect(out[3]).toBe(CLIENT_TOKEN_TYPES.indexOf('annotation'))
    expect(out[8]).toBe(CLIENT_TOKEN_TYPES.indexOf('javaVariable'))
  })
  it('leaves Go variables alone without a context', () => {
    expect(remapSemanticTokens(data, types, [])[8]).toBe(CLIENT_TOKEN_TYPES.indexOf('variable'))
  })
})
