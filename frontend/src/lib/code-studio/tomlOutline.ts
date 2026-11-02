import type { GoIDESymbolNode } from '@/lib/code-studio-lsp-api'
export const TOML_OUTLINE_LIMIT = 256000

/** Syntactic navigation only: reads the current buffer without evaluating or rewriting TOML. */
export function tomlOutline(text: string): GoIDESymbolNode[] {
  const lines = text.slice(0, TOML_OUTLINE_LIMIT).split(/\r?\n/), symbols: GoIDESymbolNode[] = []
  let quote = '', depth = 0, table: GoIDESymbolNode | undefined
  const range = (line: number, start: number, end: number) => ({ startLine: line, startColumn: start, endLine: line, endColumn: end })
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index], line = index + 1
    let masked = ''
    for (let at = 0; at < raw.length;) {
      if (quote) {
        if (quote[0] === '"' && raw[at] === '\\') { masked += '  '; at += 2 }
        else if (raw.startsWith(quote, at)) { masked += ' '.repeat(quote.length); at += quote.length; quote = '' }
        else { masked += ' '; at++ }
      } else if (raw[at] === '#') { masked += ' '.repeat(raw.length - at); break }
      else if (raw[at] === '"' || raw[at] === "'") {
        quote = raw.startsWith(raw[at].repeat(3), at) ? raw[at].repeat(3) : raw[at]
        masked += ' '.repeat(quote.length); at += quote.length
      } else { masked += raw[at]; at++ }
    }
    if (quote.length === 1) quote = ''
    const trimmed = masked.trim()
    const header = depth === 0 && /^(\[\[[^\[\]]*\]\]|\[[^\[\]]*\])$/.test(trimmed)
    if (header) {
      if (table) { table.range.endLine = Math.max(table.range.startLine, line - 1); table.range.endColumn = lines[line - 2].length + 1 }
      const start = masked.indexOf('['), brackets = trimmed.startsWith('[[') ? 2 : 1
      const end = masked.lastIndexOf(']') - brackets + 1
      const name = raw.slice(start + brackets, end).trim()
      if (!name) continue
      table = { name: brackets === 2 ? `[[${name}]]` : name, kind: 3, range: range(line, start + 1, raw.length + 1), selectionRange: range(line, start + brackets + 1, end + 1), children: [] }
      symbols.push(table)
      continue
    }
    const equals = masked.indexOf('=')
    if (depth === 0 && equals > 0) {
      const name = raw.slice(0, equals).trim(), start = raw.search(/\S/)
      if (name) {
        const node = { name, kind: 7, range: range(line, start + 1, raw.length + 1), selectionRange: range(line, start + 1, equals + 1), children: [] }
        if (table) table.children!.push(node); else symbols.push(node)
      }
    }
    for (const character of masked) {
      if (character === '[' || character === '{') depth++
      else if (character === ']' || character === '}') depth = Math.max(0, depth - 1)
    }
  }
  if (table) { table.range.endLine = lines.length; table.range.endColumn = lines[lines.length - 1].length + 1 }
  return symbols
}
