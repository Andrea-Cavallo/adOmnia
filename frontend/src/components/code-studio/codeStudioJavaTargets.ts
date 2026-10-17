/**
 * ▶ nel gutter dei sorgenti Java: metodi `main` e test JUnit. Solo lettura del testo: l'esecuzione resta
 * al backend (Maven/Gradle) e al Java Debug Server.
 */

export interface CodeStudioJavaRunTarget {
  line: number
  kind: 'java-main' | 'java-test'
  /** Metodo di test (vuoto per main). */
  name: string
  /** Nome qualificato della classe, es. it.acme.MathTest. */
  className: string
  /** Sorgente relativo al progetto: serve a trovare il modulo e a filtrare i test. */
  relativePath: string
}

const PACKAGE = /^\s*package\s+([\w.]+)\s*;/m
const MAIN_METHOD = /public\s+static\s+void\s+main\s*\(\s*(?:final\s+)?String\s*(?:\[\s*\]|\.\.\.)/
const TEST_ANNOTATION = /^\s*@(?:Test|ParameterizedTest|RepeatedTest|TestFactory)\b/
const METHOD_NAME = /\bvoid\s+([A-Za-z_$][\w$]*)\s*\(/

export function isJavaTarget(target: { kind: string }): target is CodeStudioJavaRunTarget {
  return target.kind === 'java-main' || target.kind === 'java-test'
}

export function findJavaTargets(relativePath: string, text: string): CodeStudioJavaRunTarget[] {
  if (!relativePath.endsWith('.java')) return []
  const base = relativePath.slice(relativePath.lastIndexOf('/') + 1).replace(/\.java$/, '')
  const pkg = PACKAGE.exec(text)?.[1]
  const className = pkg ? `${pkg}.${base}` : base
  const targets: CodeStudioJavaRunTarget[] = []
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    if (MAIN_METHOD.test(line)) {
      targets.push({ line: index + 1, kind: 'java-main', name: '', className, relativePath })
      return
    }
    if (!TEST_ANNOTATION.test(line)) return
    // Il nome del metodo sta sulla stessa riga (@Test void x()) o in una delle successive (altre annotazioni).
    for (let next = index; next < Math.min(index + 6, lines.length); next += 1) {
      const method = METHOD_NAME.exec(lines[next])
      if (method) { targets.push({ line: index + 1, kind: 'java-test', name: method[1], className, relativePath }); return }
    }
  })
  return targets
}

interface JavaTestProject {
  rootPath: string
  units?: ReadonlyArray<{ language: string; root: string }> | null
}

const slash = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')

/** Richiesta di test per il ▶ di un metodo: nell'unità Java più interna che contiene il file, solo quel metodo. */
export function javaTestRequest(sessionId: string, project: JavaTestProject, target: CodeStudioJavaRunTarget) {
  const base = slash(project.rootPath)
  let workingDirectory = ''
  for (const unit of project.units ?? []) {
    if (unit.language !== 'java') continue
    const root = slash(unit.root)
    const relative = root === base ? '' : root.startsWith(`${base}/`) ? root.slice(base.length + 1) : null
    if (relative === null) continue
    const contains = relative === '' || target.relativePath.startsWith(`${relative}/`)
    if (contains && relative.length >= workingDirectory.length) workingDirectory = relative
  }
  const file = workingDirectory ? target.relativePath.slice(workingDirectory.length + 1) : target.relativePath
  return { sessionId, language: 'java', workingDirectory, packages: [file], run: target.name }
}
