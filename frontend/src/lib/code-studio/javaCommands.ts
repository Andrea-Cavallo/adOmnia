import type { CodeStudioJavaRunTarget } from '@/components/code-studio/codeStudioJavaTargets'

/** Il minimo di una proposta Run (`Suggestion` dei binding) che serve a scegliere un goal Maven/Gradle. */
interface GoalSuggestion {
  language: string
  configuration: { kind: string; target: string; workingDirectory: string; programArguments?: readonly string[] | null }
}

const slash = (path: string) => path.replace(/\\/g, '/')

/**
 * La proposta Java il cui comando ha esattamente questi argomenti (`['clean','install']`), nell'unità
 * più interna che contiene il file attivo; senza file attivo vale la prima. Il wrapper (mvnw/gradlew) lo ha già scelto il backend.
 */
export function javaGoalSuggestion<T extends GoalSuggestion>(suggestions: readonly T[], goals: readonly string[], activePath: string): T | null {
  const wanted = goals.join(' ')
  const matches = suggestions.filter((item) => item.language === 'java' && item.configuration.kind === 'command' && (item.configuration.programArguments ?? []).join(' ') === wanted)
  const file = slash(activePath)
  let best: T | null = null
  let bestLength = -1
  for (const item of matches) {
    const directory = slash(item.configuration.workingDirectory).replace(/^\.$/, '').replace(/\/+$/, '')
    const contains = directory === '' || file.startsWith(`${directory}/`)
    if (contains && directory.length > bestLength) { best = item; bestLength = directory.length }
  }
  return best ?? matches[0] ?? null
}

/** Obiettivo `main`/test più vicino al cursore: l'ultimo che inizia sopra la riga, altrimenti il primo. */
export function javaTargetAtLine(targets: readonly CodeStudioJavaRunTarget[], kind: CodeStudioJavaRunTarget['kind'], line: number): CodeStudioJavaRunTarget | null {
  const ofKind = targets.filter((target) => target.kind === kind)
  const above = ofKind.filter((target) => target.line <= line)
  return above[above.length - 1] ?? ofKind[0] ?? null
}

/**
 * Il modulo Maven (cartella relativa al progetto, "" = radice) da usare per un comando di build: l'unità più
 * interna che contiene il file attivo, altrimenti la prima. null se il progetto non ha unità Maven.
 */
export function mavenModuleFor(units: ReadonlyArray<{ language: string; kind: string; root: string }>, projectRoot: string, activeRelativePath: string): string | null {
  const base = slash(projectRoot).replace(/\/+$/, '')
  const relativeRoots = units
    .filter((unit) => unit.language === 'java' && unit.kind === 'maven')
    .map((unit) => {
      const root = slash(unit.root).replace(/\/+$/, '')
      return root === base ? '' : root.startsWith(`${base}/`) ? root.slice(base.length + 1) : null
    })
    .filter((root): root is string => root !== null)
  if (relativeRoots.length === 0) return null
  const file = slash(activeRelativePath)
  const containing = relativeRoots.filter((root) => root === '' || file.startsWith(`${root}/`))
  return containing.sort((a, b) => b.length - a.length)[0] ?? relativeRoots[0]
}

/** Percorsi candidati del sorgente collegato: `src/main/java/a/Foo.java` ↔ `src/test/java/a/FooTest.java`. */
export function javaCounterpartPaths(relativePath: string): string[] {
  const path = slash(relativePath)
  if (!path.endsWith('.java')) return []
  const base = path.slice(0, -'.java'.length)
  if (base.includes('/src/test/java/') || base.startsWith('src/test/java/')) {
    const main = base.replace('src/test/java/', 'src/main/java/')
    const name = main.slice(main.lastIndexOf('/') + 1)
    const stem = name.replace(/(Tests?|IT)$/, '')
    return stem && stem !== name ? [`${main.slice(0, main.length - name.length)}${stem}.java`] : []
  }
  if (!base.includes('src/main/java/')) return []
  const test = base.replace('src/main/java/', 'src/test/java/')
  return ['Test', 'Tests', 'IT'].map((suffix) => `${test}${suffix}.java`)
}

const PACKAGE_NAME = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/
const CLASS_NAME = /^[A-Z][A-Za-z0-9_$]*$/
const JAVA_KEYWORDS = new Set(['abstract', 'class', 'enum', 'final', 'interface', 'new', 'package', 'public', 'record', 'static', 'void', 'import', 'int', 'long', 'null', 'true', 'false', 'default'])

export type JavaEntryKind = 'class' | 'interface' | 'enum' | 'record'

/** Messaggio d'errore per il nome di una classe o di un package, vuoto se valido. */
export function javaNameError(kind: JavaEntryKind | 'package', name: string): string {
  const value = name.trim()
  if (!value) return 'Enter a name'
  if (kind === 'package') {
    if (!PACKAGE_NAME.test(value)) return 'Use lowercase package segments separated by dots (com.acme.app)'
    return value.split('.').some((part) => JAVA_KEYWORDS.has(part)) ? 'A package segment is a Java keyword' : ''
  }
  if (!CLASS_NAME.test(value)) return 'Start with an uppercase letter; letters, digits, _ and $ only'
  return JAVA_KEYWORDS.has(value) ? 'That is a Java keyword' : ''
}

/** Package dichiarato da una cartella `src/main/java/<package>` o `src/test/java/<package>`; vuoto altrimenti. */
export function javaPackageOfDirectory(relativeDirectory: string): string {
  const match = /(?:^|\/)src\/(?:main|test)\/java(?:\/(.*))?$/.exec(slash(relativeDirectory).replace(/\/+$/, ''))
  return match?.[1]?.replace(/\//g, '.') ?? ''
}

/** Sorgente di un nuovo file Java: dichiarazione del package (se la cartella ne ha uno) e un corpo minimo. */
export function javaSourceTemplate(kind: JavaEntryKind, name: string, pkg: string): string {
  const header = pkg ? `package ${pkg};\n\n` : ''
  const body = kind === 'record' ? `public record ${name}() {\n}` : kind === 'class' ? `public class ${name} {\n}` : `public ${kind} ${name} {\n}`
  return `${header}${body}\n`
}
