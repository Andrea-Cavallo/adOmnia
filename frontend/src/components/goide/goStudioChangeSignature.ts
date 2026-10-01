/** Un parametro della firma: name vuoto per i parametri senza nome (solo tipo). */
export interface GoStudioSignatureParam {
  name: string
  type: string
  variadic: boolean
}

export interface GoStudioSignature {
  name: string
  /** Riga e colonna (1-based) del nome della funzione: è il punto che gopls usa per trovare la firma. */
  line: number
  column: number
  receiver: string
  params: GoStudioSignatureParam[]
  /** Testo dei risultati così com'è (es. "error" o "(int, error)"); resultCount è il numero di campi. */
  results: string
  resultCount: number
}

const SEARCH_LINES = 20

/** Divide una lista al livello zero di parentesi; restituisce i pezzi già ripuliti. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if ('([{'.includes(char)) depth++
    else if (')]}'.includes(char)) depth--
    if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else current += char
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/** Indice della parentesi che chiude quella aperta in `start`, o -1. */
function closing(text: string, start: number): number {
  let depth = 0
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if ('([{'.includes(char)) depth++
    else if (')]}'.includes(char) && --depth === 0) return index
  }
  return -1
}

/** Separa nome e tipo al primo spazio di livello zero ("a map[string]int" → ["a", "map[string]int"]). */
function nameAndType(part: string): [string, string] | null {
  const match = /^([A-Za-z_]\w*)\s+(\S[\s\S]*)$/.exec(part)
  return match ? [match[1], match[2].trim()] : null
}

/** Campi di una lista Go: tutti con nome (anche raggruppati, "a, b int") o tutti senza. */
export function parseFieldList(text: string): GoStudioSignatureParam[] {
  const parts = splitTopLevel(text)
  const named = parts.some((part) => nameAndType(part) !== null)
  if (!named) return parts.map((type) => ({ name: '', type, variadic: type.startsWith('...') }))
  const fields: GoStudioSignatureParam[] = []
  let pending: string[] = []
  for (const part of parts) {
    const split = nameAndType(part)
    if (!split) { pending.push(part); continue }
    const [name, type] = split
    for (const grouped of [...pending, name]) fields.push({ name: grouped, type, variadic: type.startsWith('...') })
    pending = []
  }
  return fields
}

/**
 * Trova la dichiarazione `func` che contiene il cursore (riga della firma o poche righe sotto) e ne legge
 * parametri e risultati. Null se il cursore non è su una dichiarazione di funzione o metodo.
 */
export function parseSignatureAt(text: string, line: number): GoStudioSignature | null {
  const lines = text.split('\n')
  for (let candidate = line - 1; candidate >= Math.max(0, line - 1 - SEARCH_LINES); candidate--) {
    if (!lines[candidate]?.startsWith('func')) continue
    const offset = lines.slice(0, candidate).reduce((total, item) => total + item.length + 1, 0)
    const rest = text.slice(offset)
    const head = /^func\s*(\([^)]*\))?\s*([A-Za-z_]\w*)\s*/.exec(rest)
    if (!head) return null
    let cursor = head[0].length
    if (rest[cursor] === '[') {
      const end = closing(rest, cursor)
      if (end < 0) return null
      cursor = end + 1
      while (rest[cursor] === ' ') cursor++
    }
    if (rest[cursor] !== '(') return null
    const paramsEnd = closing(rest, cursor)
    if (paramsEnd < 0) return null
    const bodyStart = rest.indexOf('{', paramsEnd)
    const signatureEnd = bodyStart < 0 ? rest.indexOf('\n', paramsEnd) : bodyStart
    const endLine = candidate + rest.slice(0, signatureEnd < 0 ? rest.length : signatureEnd).split('\n').length - 1
    if (line - 1 > endLine) return null // il cursore è nel corpo, non nella firma
    const results = rest.slice(paramsEnd + 1, signatureEnd < 0 ? undefined : signatureEnd).trim()
    const resultCount = !results ? 0 : results.startsWith('(') ? parseFieldList(results.slice(1, -1)).length : 1
    const nameIndex = head[0].indexOf(head[2], head[1]?.length ?? 4)
    return {
      name: head[2],
      line: candidate + 1,
      column: nameIndex + 1,
      receiver: head[1] ?? '',
      params: parseFieldList(rest.slice(cursor + 1, paramsEnd)),
      results,
      resultCount,
    }
  }
  return null
}

/** Testo della nuova firma per l'anteprima (un tipo per parametro, come la scrive gopls). */
export function formatSignature(signature: GoStudioSignature, order: number[]): string {
  const params = order.map((index) => signature.params[index]).map((param) => (param.name ? `${param.name} ${param.type}` : param.type))
  const receiver = signature.receiver ? `${signature.receiver} ` : ''
  return `func ${receiver}${signature.name}(${params.join(', ')})${signature.results ? ` ${signature.results}` : ''}`
}

/** Perché il nuovo ordine non si può applicare, o null se va bene. */
export function signatureOrderProblem(signature: GoStudioSignature, order: number[]): string | null {
  const variadic = signature.params.findIndex((param) => param.variadic)
  if (variadic >= 0 && order.includes(variadic) && order[order.length - 1] !== variadic) return `The variadic parameter ${signature.params[variadic].name || signature.params[variadic].type} must stay last.`
  const unchanged = order.length === signature.params.length && order.every((index, position) => index === position)
  return unchanged ? 'Nothing to change.' : null
}
