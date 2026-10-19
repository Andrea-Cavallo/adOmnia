/**
 * Contesti per le scorciatoie con condizione `when` (semplificato):
 * termini booleani combinati con `&&`, `||` e `!` — per esempio `editor && vim.normal`,
 * `!input`, `editor || terminal`. Le parentesi non sono supportate: la condizione si
 * legge da sinistra a destra, `&&` più vincolante di `||`.
 */

export type CodeStudioWhenContext = Readonly<Record<string, boolean>>

/** Termini riconosciuti dai template e dall'editor JSON: i rimanenti valgono sempre false. */
export const CODE_STUDIO_WHEN_TERMS = [
  'editor',
  'input',
  'terminal',
  'vim',
  'emacs',
  'vim.normal',
  'vim.insert',
  'vim.visual',
] as const

function termValue(term: string, context: CodeStudioWhenContext): boolean {
  return context[term] === true
}

function evaluateTerm(operand: string, context: CodeStudioWhenContext): boolean {
  const text = operand.trim()
  if (!text) return false
  const negated = text.startsWith('!')
  const term = (negated ? text.slice(1) : text).trim()
  if (!term) return false
  return negated ? !termValue(term, context) : termValue(term, context)
}

/** true se la condizione è soddisfatta dal contesto; senza condizione il binding vale sempre. */
export function evaluateWhen(expression: string | undefined, context: CodeStudioWhenContext): boolean {
  if (expression === undefined) return true
  const trimmed = expression.trim()
  if (!trimmed) return true
  // L'espressione è un OR di gruppi AND: `a && b || c` = (a && b) || c.
  return trimmed.split('||').some((group) => group.split('&&').every((operand) => evaluateTerm(operand, context)))
}
