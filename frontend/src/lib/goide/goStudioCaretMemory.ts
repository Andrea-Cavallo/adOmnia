/** Ultima posizione del cursore per file, per ripristinarla dopo un riavvio o un crash. */
export interface GoStudioCaret {
  path: string
  line: number
  column: number
}

const carets = new Map<string, GoStudioCaret>()
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()
const PERSIST_DELAY_MS = 2000

const key = (sessionId: string, path: string) => `${sessionId}\u0000${path}`

export function rememberCaret(sessionId: string, path: string, line: number, column: number, persist?: (sessionId: string) => void): void {
  if (!path || line < 1 || column < 1) return
  carets.set(key(sessionId, path), { path, line, column })
  if (!persist) return
  // La vista di sessione si salva poco dopo l'ultimo movimento: niente scrittura a ogni tasto.
  clearTimeout(persistTimers.get(sessionId))
  persistTimers.set(sessionId, setTimeout(() => {
    persistTimers.delete(sessionId)
    persist(sessionId)
  }, PERSIST_DELAY_MS))
}

export function caretFor(sessionId: string, path: string): GoStudioCaret | undefined {
  return carets.get(key(sessionId, path))
}

/** Cursori dei soli file indicati (i tab aperti), da salvare con la vista di sessione. */
export function caretsFor(sessionId: string, paths: readonly string[]): GoStudioCaret[] {
  return paths.flatMap((path) => {
    const caret = carets.get(key(sessionId, path))
    return caret ? [caret] : []
  })
}

export function restoreCarets(sessionId: string, saved: readonly GoStudioCaret[] | undefined): void {
  for (const caret of saved ?? []) {
    if (!carets.has(key(sessionId, caret.path))) carets.set(key(sessionId, caret.path), caret)
  }
}
