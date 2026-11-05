/**
 * Colori di Go senza gopls: funzioni, metodi e tipi riconosciuti dalla sola forma del codice.
 * Servono finché gopls carica il workspace, poi i suoi token (che conoscono i tipi) li sostituiscono.
 */
// ponytail: euristica sui token vicini, non un parser: `pkg.Costante` resta senza colore finché non arriva gopls.

export interface SyntacticToken {
  line: number
  start: number
  length: number
  kind: 'function' | 'method' | 'type'
}

interface LexedToken {
  text: string
  line: number
  start: number
}

/** Oltre questa dimensione il costo non vale: un file enorme resta ai colori base. */
const MAX_SOURCE_LENGTH = 512 * 1024

const LEXER = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"\\\n]|\\.)*"?|`[^`]*`?|'(?:[^'\\\n]|\\.)*'?|[\p{L}_][\p{L}\p{N}_]*|\S/gu
const IDENTIFIER = /^[\p{L}_]/u
const EXPORTED = /^\p{Lu}/u
const KEYWORDS = new Set(['break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var'])
const PREDECLARED_TYPES = new Set(['any', 'bool', 'byte', 'comparable', 'complex64', 'complex128', 'error', 'float32', 'float64', 'int', 'int8', 'int16', 'int32', 'int64', 'rune', 'string', 'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr'])

/** Token significativi, senza commenti. Stringhe e caratteri restano come token non identificatori. */
function lex(source: string): LexedToken[] {
  const tokens: LexedToken[] = []
  let line = 0
  let lineStart = 0
  const newlines = /\n/g
  for (const match of source.matchAll(LEXER)) {
    newlines.lastIndex = lineStart
    for (let next = newlines.exec(source); next && next.index < match.index; next = newlines.exec(source)) {
      line++
      lineStart = next.index + 1
      newlines.lastIndex = lineStart
    }
    const text = match[0]
    if (!text.startsWith('//') && !text.startsWith('/*')) tokens.push({ text, line, start: match.index - lineStart })
  }
  return tokens
}

function isName(token: LexedToken | undefined): boolean {
  return !!token && IDENTIFIER.test(token.text) && !KEYWORDS.has(token.text)
}

function closingParen(tokens: LexedToken[], open: number): number {
  let depth = 0
  for (let index = open; index < tokens.length; index++) {
    if (tokens[index].text === '(') depth++
    else if (tokens[index].text === ')' && --depth === 0) return index
  }
  return -1
}

/** I nomi con una posizione nota a priori: metodi dopo il ricevitore, tipi dei blocchi `type ( … )`. */
function declaredKinds(tokens: LexedToken[]): Map<number, SyntacticToken['kind']> {
  const kinds = new Map<number, SyntacticToken['kind']>()
  tokens.forEach((token, index) => {
    if (tokens[index + 1]?.text !== '(') return
    if (token.text === 'func') {
      const close = closingParen(tokens, index + 1)
      if (close > 0 && isName(tokens[close + 1]) && ['(', '['].includes(tokens[close + 2]?.text)) kinds.set(close + 1, 'method')
    } else if (token.text === 'type') {
      const close = closingParen(tokens, index + 1)
      for (let inner = index + 2; inner > 0 && inner < close; inner++) {
        if (isName(tokens[inner]) && tokens[inner].line !== tokens[inner - 1].line) kinds.set(inner, 'type')
      }
    }
  })
  return kinds
}

/** Il nome dopo `*`: `r *Request` è un tipo, `x := *p` una dereferenza. */
function isPointerType(tokens: LexedToken[], index: number): boolean {
  const star = tokens[index - 1]
  if (star?.text !== '*' || star.line !== tokens[index].line || star.start + 1 !== tokens[index].start) return false
  const before = tokens[index - 2]
  return isName(before) && before.line === star.line ? before.start + before.text.length < star.start : EXPORTED.test(tokens[index].text)
}

/** Il secondo nome di una coppia è il tipo: `name Type`, `x pkg.Type`, `r *pkg.Type`. */
function isQualifiedType(tokens: LexedToken[], index: number): boolean {
  if (tokens[index - 1]?.text !== '.' || !EXPORTED.test(tokens[index].text) || !isName(tokens[index - 2])) return false
  const before = tokens[index - 3]
  return !!before && before.line === tokens[index].line && (isName(before) || ['*', ']', 'chan'].includes(before.text))
}

function classify(tokens: LexedToken[], index: number): SyntacticToken['kind'] | null {
  const { text, line } = tokens[index]
  const previous = tokens[index - 1]
  const next = tokens[index + 1]?.text
  if (previous?.text === 'type' || previous?.text === 'chan') return 'type'
  if (previous?.text === 'func' && (next === '(' || next === '[')) return 'function'
  if (next === '(') {
    if (previous?.text === '.') return 'method'
    return PREDECLARED_TYPES.has(text) ? 'type' : 'function'
  }
  if (PREDECLARED_TYPES.has(text) && previous?.text !== '.') return 'type'
  if (next === '{' && EXPORTED.test(text)) return 'type'
  if (previous?.text === ']' || isPointerType(tokens, index) || isQualifiedType(tokens, index)) return 'type'
  return isName(previous) && previous.line === line && next !== ':=' && next !== '.' ? 'type' : null
}

export function goSyntacticTokens(source: string): SyntacticToken[] {
  if (source.length > MAX_SOURCE_LENGTH) return []
  const tokens = lex(source)
  const declared = declaredKinds(tokens)
  const result: SyntacticToken[] = []
  tokens.forEach((token, index) => {
    if (!isName(token)) return
    const kind = declared.get(index) ?? classify(tokens, index)
    if (kind) result.push({ line: token.line, start: token.start, length: token.text.length, kind })
  })
  return result
}
