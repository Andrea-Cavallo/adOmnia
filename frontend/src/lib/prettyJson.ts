// Lossless JSON pretty-printer.
// JSON.parse -> JSON.stringify corrupts large integers (int64 IDs) because
// numbers become JS doubles: 12345678901234567 -> 12345678901234568000.
// This re-indents the source char-by-char and emits number/string tokens
// verbatim, so nothing is ever rounded.
// ponytail: validation-only scan (no value parsing); throws on malformed JSON
//           so callers keep the user's text on failure, like JSON.parse did.

export function prettyJson(src: string, indent = 2): string {
  JSON.parse(src) // validate only — throws on malformed input (result discarded)
  const pad = ' '.repeat(indent)
  let out = ''
  let depth = 0
  let i = 0
  const n = src.length

  const newline = () => '\n' + pad.repeat(depth)

  while (i < n) {
    const c = src[i]

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue }

    if (c === '"') {
      // copy whole string token verbatim, honoring escapes
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === '"') { j++; break }
        j++
      }
      out += src.slice(i, j)
      i = j
      continue
    }

    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']'
      // peek next non-ws: empty container stays on one line
      let k = i + 1
      while (k < n && /\s/.test(src[k])) k++
      if (src[k] === close) { out += c + close; i = k + 1; continue }
      depth++
      out += c + newline()
      i++
      continue
    }

    if (c === '}' || c === ']') {
      depth--
      out += newline() + c
      i++
      continue
    }

    if (c === ',') { out += ',' + newline(); i++; continue }
    if (c === ':') { out += ': '; i++; continue }

    // number / true / false / null — copy verbatim until a structural char
    let j = i
    while (j < n && !/[\s,:{}\[\]"]/.test(src[j])) j++
    out += src.slice(i, j)
    i = j
  }

  return out
}
