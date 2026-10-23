/** ▶ nel gutter dei sorgenti Rust: `fn main` (anche `#[tokio::main] async fn main`). Solo lettura del testo. */

export interface CodeStudioRustRunTarget {
  line: number
  kind: 'rust-main'
  name: string
  /** Cartella del crate relativa alla radice del progetto: è la working directory di Run e debug. */
  crateDirectory: string
  /** `src/bin/<n>.rs` → bin `n`; `src/main.rs` lascia vuoto (lo risolve cargo/il backend dal crate). */
  bin?: string
  /** `examples/<n>.rs` → example `n`. */
  example?: string
  /** File `.rs` fuori da un crate Cargo: nome del file, lanciato dal backend con un crate fantasma. */
  source?: string
}

const FN_MAIN = /^\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+main\s*\(/

export function isRustTarget(target: { kind: string }): target is CodeStudioRustRunTarget {
  return target.kind === 'rust-main'
}

/** Posizione del file nel crate: dove sta il Cargo.toml e che target Cargo è. Null fuori da src/ ed examples/. */
function crateLayout(relativePath: string): { crateDirectory: string; bin?: string; example?: string; source?: string; name: string } | null {
  const parts = relativePath.split('/')
  for (let index = parts.length - 1; index >= 0; index--) {
    const crateDirectory = parts.slice(0, index).join('/')
    const rest = parts.slice(index)
    // Cargo scopre solo `examples/*.rs`, `examples/*/main.rs`, `src/bin/*.rs`, `src/bin/*/main.rs`:
    // gli altri file dentro una sottocartella sono moduli, non target.
    if (rest[0] === 'examples') {
      if (rest.length === 2) {
        const name = rest[1].replace(/\.rs$/, '')
        return { crateDirectory, example: name, name }
      }
      if (rest.length === 3 && rest[2] === 'main.rs') {
        return { crateDirectory, example: rest[1], name: rest[1] }
      }
      return null
    }
    if (rest[0] === 'src' && rest[1] === 'bin') {
      if (rest.length === 3) {
        const name = rest[2].replace(/\.rs$/, '')
        return { crateDirectory, bin: name, name }
      }
      if (rest.length === 4 && rest[3] === 'main.rs') {
        return { crateDirectory, bin: rest[2], name: rest[2] }
      }
      return null
    }
    if (rest[0] === 'src' && rest.length === 2 && rest[1] === 'main.rs') {
      return { crateDirectory, name: parts[index - 1] ?? 'main' }
    }
  }
  return null
}

export function findRustTargets(relativePath: string, text: string): Array<CodeStudioRustRunTarget | CodeStudioRustTestTarget> {
  return [...findRustMainTargets(relativePath, text), ...findRustTestTargets(relativePath, text)]
}

function findRustMainTargets(relativePath: string, text: string): CodeStudioRustRunTarget[] {
  if (!relativePath.toLowerCase().endsWith('.rs')) return []
  const index = text.split(/\r?\n/).findIndex((line) => FN_MAIN.test(line))
  if (index < 0) return []
  const layout = crateLayout(relativePath) ?? looseLayout(relativePath)
  if (!layout) return []
  const { name, crateDirectory, bin, example, source } = layout
  return [{ line: index + 1, kind: 'rust-main', name, crateDirectory, ...(bin ? { bin } : {}), ...(example ? { example } : {}), ...(source ? { source } : {}) }]
}

/**
 * Un `.rs` con `fn main` che non è un target Cargo (esercizi, prove: `fibonacci/fibonacci.rs`) si lancia
 * da solo. Restano fuori i file dentro un crate (`src/`, `tests/`, `benches/`) e `build.rs`, dove
 * `main` non è il programma dell'utente.
 */
function looseLayout(relativePath: string): { crateDirectory: string; bin?: string; example?: string; source: string; name: string } | null {
  const parts = relativePath.split('/')
  const file = parts[parts.length - 1]
  if (file === 'build.rs' || parts.slice(0, -1).some((part) => ['src', 'examples', 'tests', 'benches', 'target'].includes(part))) return null
  return { crateDirectory: parts.slice(0, -1).join('/'), source: file, name: file.replace(/\.rs$/, '') }
}

/** ▶ su una funzione di test Rust (`#[test]`, `#[tokio::test]`…): si lancia per nome esatto con `cargo test`. */
export interface CodeStudioRustTestTarget {
  line: number
  kind: 'rust-test'
  /** Nome della funzione, o del modulo per i target `mod <nome>` (RS-5.5). */
  name: string
  /** Percorso completo come lo stampa libtest (`handlers::tests::creates_user`), per `--exact`. I
   * moduli finiscono con `::`: il filtro è per prefisso, non esatto. */
  testPath: string
  /** Vero per il ▶ su `mod <nome>` con test dentro: esegue/debugga tutto il modulo (RS-5.5). */
  module?: boolean
  /** Cartella del crate relativa alla radice del progetto: working directory del `cargo test`. */
  crateDirectory: string
  relativePath: string
}

export function isRustTestTarget(target: { kind: string }): target is CodeStudioRustTestTarget {
  return target.kind === 'rust-test'
}

const TEST_ATTRIBUTE = /^\s*#\[\s*(?:[A-Za-z_][\w]*::)*test\b[^\]]*\]/
const OTHER_ATTRIBUTE = /^\s*#\[/
const FN_NAME = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/
const MOD_OPEN = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*\{/

/** Crate e modulo del file: `crates/api/src/handlers/user.rs` → crate `crates/api`, modulo `handlers::user`. Null fuori da src/ e tests/. */
function testFileLayout(relativePath: string): { crateDirectory: string; modulePath: string[] } | null {
  const parts = relativePath.split('/')
  const lastSrc = parts.lastIndexOf('src')
  if (lastSrc >= 0 && lastSrc < parts.length - 1) {
    const rest = parts.slice(lastSrc + 1)
    if (rest[0] === 'bin') return { crateDirectory: parts.slice(0, lastSrc).join('/'), modulePath: [] }
    const file = rest[rest.length - 1].replace(/\.rs$/, '')
    const modulePath = [...rest.slice(0, -1), ...(['lib', 'main', 'mod'].includes(file) ? [] : [file])]
    return { crateDirectory: parts.slice(0, lastSrc).join('/'), modulePath }
  }
  const lastTests = parts.lastIndexOf('tests')
  if (lastTests >= 0 && lastTests < parts.length - 1) return { crateDirectory: parts.slice(0, lastTests).join('/'), modulePath: [] }
  return null
}

/** Toglie stringhe e commenti di riga, così le graffe dentro non spostano la profondità. */
const withoutLiterals = (line: string): string => line.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/\/\/.*$/, '')

export function findRustTestTargets(relativePath: string, text: string): CodeStudioRustTestTarget[] {
  if (!relativePath.toLowerCase().endsWith('.rs')) return []
  const layout = testFileLayout(relativePath)
  if (!layout) return []
  const targets: CodeStudioRustTestTarget[] = []
  const declared: Array<{ name: string; inner: number; line: number; path: string[]; tests: number }> = []
  const modules: Array<{ name: string; inner: number; line: number; path: string[]; tests: number }> = []
  let depth = 0
  let pendingTest = false
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = withoutLiterals(raw)
    const open = MOD_OPEN.exec(line)
    if (open) {
      const entry = { name: open[1], inner: depth + 1, line: index + 1, path: [...modules.map((item) => item.name), open[1]], tests: 0 }
      modules.push(entry)
      declared.push(entry)
    }
    if (TEST_ATTRIBUTE.test(line)) pendingTest = true
    else if (pendingTest && !OTHER_ATTRIBUTE.test(line)) {
      const fn = FN_NAME.exec(line)
      if (fn) {
        const testPath = [...layout.modulePath, ...modules.map((entry) => entry.name), fn[1]].join('::')
        targets.push({ line: index + 1, kind: 'rust-test', name: fn[1], testPath, crateDirectory: layout.crateDirectory, relativePath })
        // Un test appartiene a tutta la catena di moduli che lo contiene: ognuno riceve il ▶ (RS-5.5).
        for (const entry of modules) entry.tests += 1
      }
      if (fn || line.trim() !== '') pendingTest = false
    }
    for (const char of line) {
      if (char === '{') depth += 1
      else if (char === '}') {
        depth -= 1
        while (modules.length && modules[modules.length - 1].inner > depth) modules.pop()
      }
    }
  })
  // ▶ su `mod <nome>` (tipicamente `mod tests`): esegue/debugga tutto il modulo per prefisso.
  const moduleTargets: CodeStudioRustTestTarget[] = declared
    .filter((entry) => entry.tests > 0)
    .map((entry) => ({
      line: entry.line,
      kind: 'rust-test' as const,
      name: entry.name,
      testPath: [...layout.modulePath, ...entry.path].join('::') + '::',
      module: true,
      crateDirectory: layout.crateDirectory,
      relativePath,
    }))
  return [...targets, ...moduleTargets].sort((left, right) => left.line - right.line)
}
