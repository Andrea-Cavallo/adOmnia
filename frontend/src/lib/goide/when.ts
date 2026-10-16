/**
 * Contesti per le scorciatoie con condizione `when` (stile VS Code, semplificato):
 * termini booleani combinati con `&&`, `||` e `!` — per esempio `editor && vim.normal`,
 * `!input`, `editor || terminal`. Le parentesi non sono supportate: la condizione si
 * legge da sinistra a destra, `&&` più vincolante di `||`.
 */

export type GoStudioWhenContext = Readonly<Record<string, boolean>>

/** Termini riconosciuti dai template e dall'editor JSON: i rimanenti valgono sempre false. */
export const GO_STUDIO_WHEN_TERMS = [
  'editor',
  'input',
  'terminal',
  'vim',
  'emacs',
  'vim.normal',
  'vim.insert',
  'vim.visual',
] as const

function termValue(term: string, context: GoStudioWhenContext): boolean {
  return context[term] === true
}

function evaluateTerm(operand: string, context: GoStudioWhenContext): boolean {
  const text = operand.trim()
  if (!text) return false
  const negated = text.startsWith('!')
  const term = (negated ? text.slice(1) : text).trim()
  if (!term) return false
  return negated ? !termValue(term, context) : termValue(term, context)
}

/** true se la condizione è soddisfatta dal contesto; senza condizione il binding vale sempre. */
export function evaluateWhen(expression: string | undefined, context: GoStudioWhenContext): boolean {
  if (expression === undefined) return true
  const trimmed = expression.trim()
  if (!trimmed) return true
  // L'espressione è un OR di gruppi AND: `a && b || c` = (a && b) || c.
  return trimmed.split('||').some((group) => group.split('&&').every((operand) => evaluateTerm(operand, context)))
}
