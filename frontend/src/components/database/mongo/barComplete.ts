import { jsonCompletions } from '../jsonComplete'
import type { SqlCompletion } from '../sqlComplete'

export type BarRoot = 'filter' | 'projection' | 'sort'

const SIMPLE_KEY = /^[A-Za-z_$][\w$]*$/

/**
 * Completion for one query-bar input: the text is completed as if it were the `filter` / `projection` /
 * `sort` of a runner command, so field names and operators come from the same engine as the JSON runner.
 * Simple keys are inserted without quotes (shell syntax), dotted paths keep them.
 */
export function barCompletions(text: string, caret: number, root: BarRoot, fields: string[], explicit = false): SqlCompletion | null {
  const head = `{"collection":"c","${root}":`
  const result = jsonCompletions(head + text, head.length + caret, { driver: 'mongodb', collections: [], fields: { c: fields } }, explicit)
  if (!result) return null
  return {
    start: result.start - head.length,
    prefix: result.prefix,
    items: result.items.map((item) => {
      const bare = item.label.startsWith('"') && item.label.endsWith('"') ? item.label.slice(1, -1) : null
      return bare != null && SIMPLE_KEY.test(bare) ? { ...item, label: bare } : item
    }),
  }
}

/** Applies a picked item: returns the new text and caret. A field gets `: ` appended when it is a key. */
export function applyCompletion(text: string, caret: number, completion: SqlCompletion, label: string): { text: string; caret: number } {
  const before = text.slice(0, completion.start)
  const after = text.slice(caret)
  const suffix = after.trimStart().startsWith(':') ? '' : ': '
  const next = before + label + suffix + after
  return { text: next, caret: (before + label + suffix).length }
}
