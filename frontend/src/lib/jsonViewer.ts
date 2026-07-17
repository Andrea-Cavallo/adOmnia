import { prettyJson } from './prettyJson'
import { diagnoseJson } from './jsonDiagnostics'

export type JsonViewerMode = 'raw' | 'tree' | 'graph' | 'diff'

type JsonAst =
  | { type: 'object'; entries: Array<{ key: string; keyRaw: string; value: JsonAst }> }
  | { type: 'array'; items: JsonAst[] }
  | { type: 'primitive'; raw: string }

export type JsonDiffStatus = 'added' | 'removed' | 'changed'

export interface JsonDiffRow {
  path: string
  left: string
  right: string
  status: JsonDiffStatus
}

export interface JsonDiffResult {
  rows: JsonDiffRow[]
  equal: boolean
  error: string
}

export interface JsonViewerSession {
  content: string
  rightContent: string
  mode: JsonViewerMode
  searchQuery: string
  isFullscreen: boolean
  compareEnabled: boolean
  activePane: 'left' | 'right'
  expandedPaths: string[]
}

export interface JsonViewerSummary {
  valid: boolean
  errorCount: number
  rootType: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'empty'
  nodeCount: number
  sizeBytes: number
  lineCount: number
}

export const EMPTY_JSON_VIEWER_SESSION: JsonViewerSession = {
  content: '',
  rightContent: '',
  mode: 'raw',
  searchQuery: '',
  isFullscreen: false,
  compareEnabled: false,
  activePane: 'left',
  expandedPaths: ['$'],
}

class LosslessJsonParser {
  private index = 0

  constructor(private readonly text: string) {}

  parse(): JsonAst {
    this.skipWhitespace()
    const value = this.parseValue()
    this.skipWhitespace()
    if (this.index !== this.text.length) throw new Error('Unexpected content after JSON value.')
    return value
  }

  private parseValue(): JsonAst {
    this.skipWhitespace()
    const char = this.text[this.index]
    if (char === '{') return this.parseObject()
    if (char === '[') return this.parseArray()
    if (char === '"') return { type: 'primitive', raw: this.readStringRaw() }
    return { type: 'primitive', raw: this.readLiteralRaw() }
  }

  private parseObject(): JsonAst {
    this.index += 1
    const entries: Array<{ key: string; keyRaw: string; value: JsonAst }> = []
    this.skipWhitespace()
    if (this.text[this.index] === '}') {
      this.index += 1
      return { type: 'object', entries }
    }

    while (this.index < this.text.length) {
      this.skipWhitespace()
      const keyRaw = this.readStringRaw()
      const key = JSON.parse(keyRaw) as string
      this.skipWhitespace()
      if (this.text[this.index] !== ':') throw new Error('Missing colon after object key.')
      this.index += 1
      const value = this.parseValue()
      entries.push({ key, keyRaw, value })
      this.skipWhitespace()
      const char = this.text[this.index]
      if (char === '}') {
        this.index += 1
        return { type: 'object', entries }
      }
      if (char !== ',') throw new Error('Missing comma between object properties.')
      this.index += 1
    }

    throw new Error('Missing closing object brace.')
  }

  private parseArray(): JsonAst {
    this.index += 1
    const items: JsonAst[] = []
    this.skipWhitespace()
    if (this.text[this.index] === ']') {
      this.index += 1
      return { type: 'array', items }
    }

    while (this.index < this.text.length) {
      items.push(this.parseValue())
      this.skipWhitespace()
      const char = this.text[this.index]
      if (char === ']') {
        this.index += 1
        return { type: 'array', items }
      }
      if (char !== ',') throw new Error('Missing comma between array items.')
      this.index += 1
    }

    throw new Error('Missing closing array bracket.')
  }

  private readStringRaw(): string {
    const start = this.index
    if (this.text[this.index] !== '"') throw new Error('Expected a JSON string.')
    this.index += 1
    while (this.index < this.text.length) {
      const char = this.text[this.index]
      if (char === '\\') {
        this.index += 2
        continue
      }
      this.index += 1
      if (char === '"') return this.text.slice(start, this.index)
    }
    throw new Error('Unterminated string.')
  }

  private readLiteralRaw(): string {
    const start = this.index
    while (this.index < this.text.length && !/[\s,\]}]/.test(this.text[this.index])) this.index += 1
    const raw = this.text.slice(start, this.index)
    if (!raw) throw new Error('Expected a JSON value.')
    return raw
  }

  private skipWhitespace(): void {
    while (this.index < this.text.length && /\s/.test(this.text[this.index])) this.index += 1
  }
}

function parseLosslessJson(content: string): JsonAst {
  JSON.parse(content)
  return new LosslessJsonParser(content).parse()
}

function stringifyLosslessJson(ast: JsonAst, options: { sortKeys?: boolean; indent?: number; minify?: boolean } = {}, depth = 0): string {
  if (ast.type === 'primitive') return ast.raw

  if (ast.type === 'array') {
    if (ast.items.length === 0) return '[]'
    if (options.minify) return `[${ast.items.map((item) => stringifyLosslessJson(item, options, depth + 1)).join(',')}]`
    const pad = ' '.repeat(options.indent ?? 2)
    const childIndent = pad.repeat(depth + 1)
    const currentIndent = pad.repeat(depth)
    return `[\n${ast.items.map((item) => `${childIndent}${stringifyLosslessJson(item, options, depth + 1)}`).join(',\n')}\n${currentIndent}]`
  }

  const entries = options.sortKeys
    ? [...ast.entries].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: 'base' }))
    : ast.entries
  if (entries.length === 0) return '{}'
  if (options.minify) {
    return `{${entries.map((entry) => `${entry.keyRaw}:${stringifyLosslessJson(entry.value, options, depth + 1)}`).join(',')}}`
  }
  const pad = ' '.repeat(options.indent ?? 2)
  const childIndent = pad.repeat(depth + 1)
  const currentIndent = pad.repeat(depth)
  return `{\n${entries.map((entry) => `${childIndent}${entry.keyRaw}: ${stringifyLosslessJson(entry.value, options, depth + 1)}`).join(',\n')}\n${currentIndent}}`
}

export function formatJsonViewerContent(content: string): string {
  if (!content.trim()) return content
  return prettyJson(content)
}

export function minifyJsonViewerContent(content: string): string {
  if (!content.trim()) return content
  return stringifyLosslessJson(parseLosslessJson(content), { minify: true })
}

export function sortJsonViewerContent(content: string): string {
  if (!content.trim()) return content
  return stringifyLosslessJson(parseLosslessJson(content), { sortKeys: true, indent: 2 })
}

function flattenAst(ast: JsonAst, path = '$', out: Record<string, string> = {}): Record<string, string> {
  if (ast.type === 'primitive') {
    out[path] = ast.raw
    return out
  }

  if (ast.type === 'array') {
    if (ast.items.length === 0) out[path] = '[]'
    ast.items.forEach((item, index) => flattenAst(item, `${path}[${index}]`, out))
    return out
  }

  if (ast.entries.length === 0) out[path] = '{}'
  ast.entries.forEach((entry) => flattenAst(entry.value, `${path}.${entry.key}`, out))
  return out
}

export function diffJsonViewerContent(left: string, right: string): JsonDiffResult {
  if (!left.trim() || !right.trim()) return { rows: [], equal: false, error: '' }
  try {
    const leftFlat = flattenAst(parseLosslessJson(left))
    const rightFlat = flattenAst(parseLosslessJson(right))
    const paths = [...new Set([...Object.keys(leftFlat), ...Object.keys(rightFlat)])].sort()
    const rows = paths.reduce<JsonDiffRow[]>((acc, path) => {
      const hasLeft = Object.prototype.hasOwnProperty.call(leftFlat, path)
      const hasRight = Object.prototype.hasOwnProperty.call(rightFlat, path)
      if (!hasLeft) acc.push({ path, left: '', right: rightFlat[path], status: 'added' })
      else if (!hasRight) acc.push({ path, left: leftFlat[path], right: '', status: 'removed' })
      else if (leftFlat[path] !== rightFlat[path]) acc.push({ path, left: leftFlat[path], right: rightFlat[path], status: 'changed' })
      return acc
    }, [])
    return { rows, equal: rows.length === 0, error: '' }
  } catch (error) {
    return { rows: [], equal: false, error: error instanceof Error ? error.message : 'Invalid JSON in one or both panes.' }
  }
}

export function buildExpandedJsonPaths(value: unknown, maxPaths = 20000): string[] {
  const paths: string[] = []

  const walk = (node: unknown, path: string) => {
    if (paths.length >= maxPaths) return
    if (node === null || typeof node !== 'object') return
    paths.push(path)
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`))
      return
    }
    Object.entries(node as Record<string, unknown>).forEach(([key, item]) => {
      walk(item, `${path}.${key}`)
    })
  }

  walk(value, '$')
  return paths
}

function countJsonNodes(value: unknown, limit = 100000): number {
  let count = 0
  const walk = (node: unknown) => {
    if (count >= limit) return
    count += 1
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    Object.values(node as Record<string, unknown>).forEach(walk)
  }
  walk(value)
  return count
}

function rootTypeOf(value: unknown): JsonViewerSummary['rootType'] {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value as JsonViewerSummary['rootType']
}

export function summarizeJsonViewerContent(content: string): JsonViewerSummary {
  const diagnostics = diagnoseJson(content)
  const lineCount = content ? content.split(/\r?\n/).length : 1
  const sizeBytes = new Blob([content]).size

  if (!content.trim()) {
    return {
      valid: true,
      errorCount: 0,
      rootType: 'empty',
      nodeCount: 0,
      sizeBytes,
      lineCount,
    }
  }

  if (diagnostics.length > 0) {
    return {
      valid: false,
      errorCount: diagnostics.length,
      rootType: 'empty',
      nodeCount: 0,
      sizeBytes,
      lineCount,
    }
  }

  const parsed = JSON.parse(content)
  return {
    valid: true,
    errorCount: 0,
    rootType: rootTypeOf(parsed),
    nodeCount: countJsonNodes(parsed),
    sizeBytes,
    lineCount,
  }
}
