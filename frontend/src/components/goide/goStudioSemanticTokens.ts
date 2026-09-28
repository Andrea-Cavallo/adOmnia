/** Legenda fissa dichiarata a Monaco: i token di gopls vengono rimappati per nome, qualunque sia la sua legenda. */
export const CLIENT_TOKEN_TYPES = [
  'namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'parameter', 'variable', 'property',
  'enumMember', 'event', 'function', 'method', 'macro', 'keyword', 'modifier', 'comment', 'string', 'number', 'regexp', 'operator', 'label',
] as const

export const CLIENT_TOKEN_MODIFIERS = [
  'declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract', 'async', 'modification', 'documentation', 'defaultLibrary',
] as const

const TOKEN_FIELDS = 5

interface AbsoluteToken {
  line: number
  start: number
  length: number
  type: number
  modifiers: number
}

function decode(data: ArrayLike<number>): AbsoluteToken[] {
  const tokens: AbsoluteToken[] = []
  let line = 0
  let start = 0
  for (let index = 0; index + TOKEN_FIELDS <= data.length; index += TOKEN_FIELDS) {
    const deltaLine = data[index]
    line += deltaLine
    start = deltaLine === 0 ? start + data[index + 1] : data[index + 1]
    tokens.push({ line, start, length: data[index + 2], type: data[index + 3], modifiers: data[index + 4] })
  }
  return tokens
}

function encode(tokens: AbsoluteToken[]): Uint32Array {
  const data = new Uint32Array(tokens.length * TOKEN_FIELDS)
  let line = 0
  let start = 0
  tokens.forEach((token, index) => {
    const offset = index * TOKEN_FIELDS
    data[offset] = token.line - line
    data[offset + 1] = token.line === line ? token.start - start : token.start
    data[offset + 2] = token.length
    data[offset + 3] = token.type
    data[offset + 4] = token.modifiers
    line = token.line
    start = token.start
  })
  return data
}

function indexByName(names: readonly string[]): Map<string, number> {
  return new Map(names.map((name, index) => [name, index]))
}

/**
 * Converte i token di gopls nella legenda del client. I tipi sconosciuti vengono scartati
 * (le posizioni relative dei successivi restano corrette), i modificatori sconosciuti ignorati.
 */
export function remapSemanticTokens(data: ArrayLike<number>, serverTypes: readonly string[], serverModifiers: readonly string[]): Uint32Array {
  const clientTypes = indexByName(CLIENT_TOKEN_TYPES)
  const clientModifiers = indexByName(CLIENT_TOKEN_MODIFIERS)
  const typeMap = serverTypes.map((name) => clientTypes.get(name) ?? -1)
  const modifierMap = serverModifiers.map((name) => clientModifiers.get(name) ?? -1)
  const mapped: AbsoluteToken[] = []
  for (const token of decode(data)) {
    const type = typeMap[token.type] ?? -1
    if (type < 0) continue
    let modifiers = 0
    modifierMap.forEach((target, bit) => {
      if (target >= 0 && token.modifiers & (1 << bit)) modifiers |= 1 << target
    })
    mapped.push({ ...token, type, modifiers })
  }
  return encode(mapped)
}

const LITERAL_ARGUMENT = /^\s*(?:-?\.?\d|"|`|'|nil\b|true\b|false\b)/

/** Come GoLand: il nome del parametro si mostra solo quando l'argomento è un literal o nil. */
export function isLiteralArgument(lineText: string, column: number): boolean {
  return LITERAL_ARGUMENT.test(lineText.slice(Math.max(0, column - 1)))
}

const GO_CODE_BLOCK = /```go\n([\s\S]*?)\n```/

/** Estrae la firma o il tipo dalla hover di gopls (primo blocco di codice Go). */
export function typeInfoFromHover(markdown: string): string | null {
  const match = GO_CODE_BLOCK.exec(markdown)
  if (!match) return null
  const code = match[1].trim()
  return code.length > 0 ? code : null
}
