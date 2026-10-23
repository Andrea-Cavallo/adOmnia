export interface CodeStudioSourceDeferredCall {
  line: number
  expression: string
}

/** Espressione di un defer senza il commento `//` in coda, se c'è (il taglio parte dagli spazi prima di `//`). */
function withoutTrailingComment(expression: string): string {
  const comment = expression.indexOf('//')
  if (comment <= 0) return expression
  let cut = comment
  while (cut > 0 && /\s/.test(expression[cut - 1])) cut -= 1
  return expression.slice(0, cut)
}

/**
 * Elenca i defer testuali già attraversati nel corpo della funzione corrente.
 * È un indizio da sorgente: un ramo condizionale può non aver registrato il defer a runtime.
 */
export function sourceDeferredCallsBefore(source: string, pausedLine: number): CodeStudioSourceDeferredCall[] {
  const lines = source.split(/\r?\n/)
  const functionStarts = lines.slice(0, Math.max(0, pausedLine - 1)).map((line, index) => ({ line, index })).filter(({ line }) => /^\s*func\b/.test(line))
  const start = Math.max(0, functionStarts.length > 0 ? functionStarts[functionStarts.length - 1].index : -1)
  const calls: CodeStudioSourceDeferredCall[] = []
  for (let index = start; index < Math.min(lines.length, pausedLine - 1); index += 1) {
    const text = lines[index].trim()
    const match = text.match(/^defer\s+(\S.*)$/)
    if (match) calls.push({ line: index + 1, expression: withoutTrailingComment(match[1]) })
  }
  return calls
}
