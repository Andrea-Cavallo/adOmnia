export interface JsonDiagnostic {
  message: string
  line: number
  column: number
  index: number
}

type TokenType =
  | '{' | '}' | '[' | ']' | ':' | ','
  | 'string' | 'number' | 'true' | 'false' | 'null'
  | 'identifier' | 'invalid' | 'eof'

interface Token {
  type: TokenType
  raw: string
  index: number
}

const MAX_DIAGNOSTICS = 20
const SIMPLE_TOKENS = new Set<TokenType>(['{', '}', '[', ']', ':', ','])

class JsonDiagnosticParser {
  private readonly diagnostics: JsonDiagnostic[] = []
  private readonly diagnosticKeys = new Set<string>()
  private index = 0
  private token: Token = { type: 'eof', raw: '', index: 0 }

  constructor(private readonly text: string) {
    this.advance()
  }

  parse(): JsonDiagnostic[] {
    this.parseValue()
    while (this.token.type !== 'eof') {
      this.add('Unexpected content after the root JSON value.', this.token.index)
      this.advance()
    }
    return this.diagnostics
  }

  private parseValue(): void {
    switch (this.token.type) {
      case '{':
        this.parseObject()
        return
      case '[':
        this.parseArray()
        return
      case 'string':
      case 'number':
      case 'true':
      case 'false':
      case 'null':
        this.advance()
        return
      case 'identifier':
        this.add(`Unexpected identifier "${this.token.raw}". String values must be wrapped in double quotes.`, this.token.index)
        this.advance()
        return
      case 'invalid':
        this.advance()
        return
      case 'eof':
        this.add('Expected a JSON value.', this.token.index)
        return
      default:
        this.add('Expected a JSON value.', this.token.index)
        this.advance()
    }
  }

  private parseObject(): void {
    const openingIndex = this.token.index
    this.advance()
    let expectsProperty = true
    let hasProperty = false
    let lastCommaIndex = -1

    while (this.token.type !== 'eof') {
      if (this.token.type === '}') {
        if (expectsProperty && hasProperty && lastCommaIndex >= 0) {
          this.add('Trailing comma is not allowed before "}".', lastCommaIndex)
        }
        this.advance()
        return
      }
      if (this.token.type === ']') {
        this.add('Expected "}" to close the object, but found "]".', this.token.index)
        this.advance()
        return
      }

      if (!expectsProperty) {
        if (this.token.type === ',') {
          lastCommaIndex = this.token.index
          this.advance()
          expectsProperty = true
          continue
        }
        this.add('Missing comma between object properties.', this.token.index)
        expectsProperty = true
        continue
      }

      if (this.token.type === ',') {
        this.add('Unexpected comma. Add a property before this comma.', this.token.index)
        this.advance()
        continue
      }

      if (this.token.type === 'identifier') {
        this.add(`Property name "${this.token.raw}" must be wrapped in double quotes.`, this.token.index)
        this.advance()
      } else if (this.token.type === 'string') {
        this.advance()
      } else {
        this.add('Expected a property name wrapped in double quotes.', this.token.index)
        this.advance()
        continue
      }

      hasProperty = true
      lastCommaIndex = -1
      if (this.currentType() === ':') {
        this.advance()
      } else {
        this.add('Missing colon after the property name.', this.token.index)
      }

      const valueType = this.currentType()
      if (valueType === ',' || valueType === '}' || valueType === 'eof') {
        this.add('Missing value for the property.', this.token.index)
      } else {
        this.parseValue()
      }
      expectsProperty = false
    }

    this.add('Missing closing "}" for this object.', openingIndex)
  }

  private parseArray(): void {
    const openingIndex = this.token.index
    this.advance()
    let expectsValue = true
    let hasValue = false
    let lastCommaIndex = -1

    while (this.token.type !== 'eof') {
      if (this.token.type === ']') {
        if (expectsValue && hasValue && lastCommaIndex >= 0) {
          this.add('Trailing comma is not allowed before "]".', lastCommaIndex)
        }
        this.advance()
        return
      }
      if (this.token.type === '}') {
        this.add('Expected "]" to close the array, but found "}".', this.token.index)
        this.advance()
        return
      }

      if (!expectsValue) {
        if (this.token.type === ',') {
          lastCommaIndex = this.token.index
          this.advance()
          expectsValue = true
          continue
        }
        this.add('Missing comma between array values.', this.token.index)
        expectsValue = true
        continue
      }

      if (this.token.type === ',') {
        this.add('Missing array value before this comma.', this.token.index)
        this.advance()
        continue
      }

      lastCommaIndex = -1
      this.parseValue()
      hasValue = true
      expectsValue = false
    }

    this.add('Missing closing "]" for this array.', openingIndex)
  }

  private advance(): void {
    this.token = this.readToken()
  }

  private currentType(): TokenType {
    return this.token.type
  }

  private readToken(): Token {
    while (this.index < this.text.length && /\s/.test(this.text[this.index])) this.index++
    const start = this.index
    if (start >= this.text.length) return { type: 'eof', raw: '', index: start }

    const ch = this.text[start]
    if (SIMPLE_TOKENS.has(ch as TokenType)) {
      this.index++
      return { type: ch as TokenType, raw: ch, index: start }
    }

    if (ch === '"' || ch === "'") return this.readString(ch)

    if (ch === '-' || /[0-9]/.test(ch)) {
      let end = start + 1
      while (end < this.text.length && /[0-9eE.+-]/.test(this.text[end])) end++
      const raw = this.text.slice(start, end)
      this.index = end
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) {
        this.add(`Invalid number format "${raw}".`, start)
      }
      return { type: 'number', raw, index: start }
    }

    if (/[A-Za-z_$]/.test(ch)) {
      let end = start + 1
      while (end < this.text.length && /[A-Za-z0-9_$-]/.test(this.text[end])) end++
      const raw = this.text.slice(start, end)
      this.index = end
      if (raw === 'true' || raw === 'false' || raw === 'null') {
        return { type: raw, raw, index: start }
      }
      return { type: 'identifier', raw, index: start }
    }

    this.add(`Unexpected character "${ch}".`, start)
    this.index++
    return { type: 'invalid', raw: ch, index: start }
  }

  private readString(quote: '"' | "'"): Token {
    const start = this.index
    if (quote === "'") {
      this.add('JSON strings and property names must use double quotes, not single quotes.', start)
    }
    this.index++

    while (this.index < this.text.length) {
      const ch = this.text[this.index]
      if (ch === quote) {
        this.index++
        return { type: 'string', raw: this.text.slice(start, this.index), index: start }
      }
      if (ch === '\\') {
        const escapeIndex = this.index
        this.index++
        const escaped = this.text[this.index]
        if (escaped === 'u') {
          const unicode = this.text.slice(this.index + 1, this.index + 5)
          if (!/^[0-9a-fA-F]{4}$/.test(unicode)) {
            this.add('Invalid Unicode escape sequence. Use four hexadecimal digits after "\\u".', escapeIndex)
          } else {
            this.index += 4
          }
        } else if (!escaped || !'"\\/bfnrt'.includes(escaped)) {
          this.add('Invalid escape sequence in string.', escapeIndex)
        }
        this.index++
        continue
      }
      if (ch === '\n' || ch === '\r') {
        this.add('String values cannot contain an unescaped line break.', this.index)
      }
      this.index++
    }

    this.add('Unterminated string. Add a closing double quote.', start)
    return { type: 'string', raw: this.text.slice(start), index: start }
  }

  private add(message: string, index: number): void {
    if (this.diagnostics.length >= MAX_DIAGNOSTICS) return
    const key = `${index}:${message}`
    if (this.diagnosticKeys.has(key)) return
    this.diagnosticKeys.add(key)
    const before = this.text.slice(0, index)
    const lines = before.split(/\r?\n/)
    this.diagnostics.push({
      message,
      line: lines.length,
      column: (lines[lines.length - 1]?.length ?? 0) + 1,
      index,
    })
  }
}

function nativeFallback(text: string, error: unknown): JsonDiagnostic {
  const message = error instanceof Error ? error.message : 'Invalid JSON.'
  const positionMatch = message.match(/position\s+(\d+)/i)
  const position = positionMatch ? Number(positionMatch[1]) : 0
  const before = text.slice(0, position)
  const lines = before.split(/\r?\n/)
  return {
    message: 'Invalid JSON syntax.',
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
    index: position,
  }
}

function normaliseTemplateValues(text: string): string {
  // Environment variables are substituted immediately before a request is
  // sent. Treat a complete {{VARIABLE}} token as a JSON value while editing,
  // preserving its length so diagnostics for real syntax errors retain their
  // original line and column.
  return text.replace(/\{\{[^{}]+\}\}/g, (token) => `0${' '.repeat(token.length - 1)}`)
}

export function diagnoseJson(text: string): JsonDiagnostic[] {
  if (!text.trim()) return []
  const diagnosticText = normaliseTemplateValues(text)
  try {
    JSON.parse(diagnosticText)
    return []
  } catch (error) {
    const diagnostics = new JsonDiagnosticParser(diagnosticText).parse()
    return diagnostics.length > 0 ? diagnostics : [nativeFallback(diagnosticText, error)]
  }
}
