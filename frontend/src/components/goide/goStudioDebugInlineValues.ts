import type { GoIDEDebugScope, GoIDEDebugVariable } from '@/lib/goide-debug-api'

/** Righe risalite dalla riga in pausa: basta per una funzione lunga senza scandire tutto il file. */
const MAX_LOOKBACK_LINES = 200
const MAX_VALUE_CHARS = 48
const MAX_LINE_CHARS = 120
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const FUNC_DECLARATION = /^\s*func\b/

export interface InlineVariable {
  name: string
  value: string
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function shorten(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * Variabili del frame da mostrare accanto al codice: locali e argomenti, non i globali
 * né i valori di ritorno sintetici di Delve (~r0).
 */
export function frameVariables(scopes: GoIDEDebugScope[], children: Record<number, GoIDEDebugVariable[]>): InlineVariable[] {
  return scopes
    .filter((scope) => !/^globals/i.test(scope.name))
    .flatMap((scope) => children[scope.variablesReference] ?? [])
    .filter((variable) => IDENTIFIER.test(variable.name))
    .map((variable) => ({ name: variable.name, value: variable.value }))
}

/**
 * Come GoLand: ogni variabile si mostra sull'ultima riga, fino a quella in pausa, in cui compare,
 * senza uscire dalla funzione corrente. Restituisce le variabili per riga (1-based), valori interi.
 */
export function inlineValueVariables(lines: string[], pausedLine: number, variables: InlineVariable[]): Map<number, InlineVariable[]> {
  const byLine = new Map<number, InlineVariable[]>()
  const lowest = Math.max(1, pausedLine - MAX_LOOKBACK_LINES)
  for (const variable of variables) {
    const pattern = new RegExp(`(^|[^.\\w])${escapeRegExp(variable.name)}\\b`)
    for (let line = Math.min(pausedLine, lines.length); line >= lowest; line--) {
      const text = lines[line - 1] ?? ''
      const code = text.replace(/\/\/.*$/, '')
      if (pattern.test(code)) {
        byLine.set(line, [...(byLine.get(line) ?? []), variable])
        break
      }
      if (FUNC_DECLARATION.test(text)) break
    }
  }
  return byLine
}

/** Il testo accorciato da mostrare accanto al codice. */
export function inlineValueText(lines: string[], pausedLine: number, variables: InlineVariable[]): Map<number, string> {
  return new Map([...inlineValueVariables(lines, pausedLine, variables)].map(([line, parts]) => [
    line, shorten(parts.map((part) => `${part.name} = ${shorten(part.value, MAX_VALUE_CHARS)}`).join(', '), MAX_LINE_CHARS),
  ]))
}
