/** Local syntax only: offsets are JavaScript/Monaco UTF-16, never byte positions. */
export interface JavaToken { text: string; start: number; end: number; identifier: boolean }
export interface JavaExcluded { start: number; end: number; endInclusive?: boolean }
const START = /[\p{L}_$]/u
const PART = /[\p{L}\p{N}_$]/u
export const MAX_JAVA_LOCAL_CHARS = 256_000
export const MAX_JAVA_LOCAL_TOKENS = 50_000

export function lexJava(source: string): { tokens: JavaToken[]; excluded: JavaExcluded[]; limited: boolean } {
  const tokens: JavaToken[] = [], excluded: JavaExcluded[] = []
  let i = 0
  if (source.length > MAX_JAVA_LOCAL_CHARS) return { tokens, excluded, limited: true }
  while (i < source.length) {
    const start = i, char = source[i]
    if (/\s/.test(char)) { i++; continue }
    if (source.startsWith('//', i)) {
      i = source.indexOf('\n', i + 2); if (i < 0) i = source.length
      excluded.push({ start, end: i, endInclusive: i === source.length }); continue
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 2
      excluded.push({ start, end: i, endInclusive: end < 0 }); continue
    }
    if (char === '"' || char === "'") {
      const delimiter = source.startsWith('"""', i) ? '"""' : char
      i += delimiter.length
      let closed = false
      while (i < source.length) {
        if (source[i] === '\\') { i += Math.min(2, source.length - i); continue }
        if (source.startsWith(delimiter, i)) { i += delimiter.length; closed = true; break }
        i++
      }
      excluded.push({ start, end: i, endInclusive: !closed }); continue
    }
    const cp = String.fromCodePoint(source.codePointAt(i)!)
    const identifier = START.test(cp)
    if (identifier) {
      i += cp.length
      while (i < source.length) {
        const next = String.fromCodePoint(source.codePointAt(i)!)
        if (!PART.test(next)) break
        i += next.length
      }
    } else if (/\d/.test(char)) {
      i++
      while (i < source.length && /[\w.]/.test(source[i])) i++
    } else i++
    tokens.push({ text: source.slice(start, i), start, end: i, identifier })
    if (tokens.length >= MAX_JAVA_LOCAL_TOKENS) return { tokens: [], excluded: [], limited: true }
  }
  return { tokens, excluded, limited: false }
}

export function javaLineStarts(source: string): number[] {
  const lines = [0]
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lines.push(i + 1)
  return lines
}
export function javaPosition(lines: number[], offset: number) {
  let low = 0, high = lines.length
  while (low + 1 < high) { const mid = (low + high) >>> 1; if (lines[mid] <= offset) low = mid; else high = mid }
  return { line: low + 1, column: offset - lines[low] + 1 }
}
