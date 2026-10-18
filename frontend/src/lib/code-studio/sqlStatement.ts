/**
 * The SQL statement under `offset`: text between the surrounding semicolons, trimmed. Semicolons inside
 * quotes or comments are not told apart (ponytail: good enough for the editor's "run statement"; a SQL parser
 * only if scripts with procedures need it).
 */
export function sqlStatementAt(text: string, offset: number): string {
  // A caret right after a semicolon still belongs to the statement that semicolon ends.
  const caret = text[offset - 1] === ';' ? offset - 1 : offset
  const start = text.lastIndexOf(';', Math.max(0, caret - 1)) + 1
  const next = text.indexOf(';', caret)
  return text.slice(start, next === -1 ? text.length : next).trim()
}
