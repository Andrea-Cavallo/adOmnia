export interface GoStudioSourceDeferredCall {
  line: number
  expression: string
}

/**
 * Elenca i defer testuali già attraversati nel corpo della funzione corrente.
 * È un indizio da sorgente: un ramo condizionale può non aver registrato il defer a runtime.
 */
export function sourceDeferredCallsBefore(source: string, pausedLine: number): GoStudioSourceDeferredCall[] {
  const lines = source.split(/\r?\n/)
  const functionStarts = lines.slice(0, Math.max(0, pausedLine - 1)).map((line, index) => ({ line, index })).filter(({ line }) => /^\s*func\b/.test(line))
  const start = Math.max(0, functionStarts.length > 0 ? functionStarts[functionStarts.length - 1].index : -1)
  const calls: GoStudioSourceDeferredCall[] = []
  for (let index = start; index < Math.min(lines.length, pausedLine - 1); index += 1) {
    const text = lines[index].trim()
    const match = text.match(/^defer\s+(.+?)(?:\s*\/\/.*)?$/)
    if (match) calls.push({ line: index + 1, expression: match[1] })
  }
  return calls
}
