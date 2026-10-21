/** ▶ nel gutter degli script Python: la riga `if __name__ == "__main__":`. Solo lettura del testo, l'esecuzione resta al backend. */

export interface CodeStudioPythonRunTarget {
  line: number
  kind: 'python-main'
  name: string
  /** Sorgente relativo alla radice del progetto: è lo `script` della Run e del debug. */
  relativePath: string
}

const MAIN_GUARD = /^if\s+__name__\s*==\s*(["'])__main__\1\s*:/

export function isPythonTarget(target: { kind: string }): target is CodeStudioPythonRunTarget {
  return target.kind === 'python-main'
}

export function findPythonTargets(relativePath: string, text: string): CodeStudioPythonRunTarget[] {
  if (!relativePath.toLowerCase().endsWith('.py')) return []
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1)
  const guard = text.split(/\r?\n/).findIndex((line) => MAIN_GUARD.test(line))
  // Senza il guard `__main__` ogni script resta eseguibile: il ▶ sta sulla prima riga.
  return [{ line: guard < 0 ? 1 : guard + 1, kind: 'python-main', name, relativePath }]
}
