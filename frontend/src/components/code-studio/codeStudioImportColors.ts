export interface ImportColorRange { line: number; start: number; length: number }

/** Import payloads are one visual unit, including separators and the final symbol. */
export function importColorRanges(source: string, language: string): ImportColorRange[] {
  if (!['go', 'java', 'python'].includes(language)) return []
  // Mask comments and strings without moving offsets. Go paths are recovered from source.
  const lexical = language === 'python'
    ? /#[^\r\n]*|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g
    : /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`/g
  const strings = new Set<number>()
  const masked = source.replace(lexical, (text: string, offset: number) => {
    if (/^["'`]/.test(text)) strings.add(offset)
    return text.replace(/[^\r\n]/g, ' ')
  })
  const lines = source.split('\n')
  const clean = masked.split('\n')
  const ranges: ImportColorRange[] = []
  let continued = false
  let parentheses = 0
  let lineOffset = 0
  for (let line = 0; line < lines.length; line++) {
    if (line > 0) lineOffset += lines[line - 1].length + 1
    const text = lines[line]
    const code = clean[line]
    const head = /^\s*(?:import\b|from\b)/.exec(code)
    if (!head && !continued) continue
    const start = head ? head[0].length : 0
    if (language === 'go') {
      if (head && !/^\s*import\b/.test(code)) continue
      for (const match of text.slice(start).matchAll(/"(?:\\.|[^"\\])*"|`[^`]*`/g)) {
        const offset = start + match.index!
        // A quote in a comment is not an import path.
        if (!strings.has(lineOffset + offset)) continue
        ranges.push({ line, start: offset, length: match[0].length })
      }
      continued = (continued || code.slice(start).includes('(')) && !code.includes(')')
      continue
    }
    if (language === 'java' && head && !/^\s*import\b/.test(code)) continue
    const end = language === 'java' && code.includes(';') ? code.indexOf(';') : code.length
    // Keep keywords/comments in their usual colors; all imported names and dots share a color.
    const payload = code.slice(start, end)
    for (const match of payload.matchAll(/[\w.*]+/g)) {
      if (['static', 'from', 'import', 'as'].includes(match[0])) continue
      ranges.push({ line, start: start + match.index!, length: match[0].length })
    }
    parentheses += (code.match(/\(/g)?.length ?? 0) - (code.match(/\)/g)?.length ?? 0)
    continued = language === 'java' ? !code.includes(';') : parentheses > 0 || code.trimEnd().endsWith('\\')
  }
  return ranges
}
