export interface ConsoleLocation {
  path: string
  line: number
  column: number
}

// go build/vet, javac via Gradle (`Foo.java:12: error:`) e Maven (`Foo.java:[12,34]`). Un'estensione per volta: il resto
// ("example.com:443") non è un sorgente.
const LOCATION = /(?<![^\s:[\]()](?![A-Za-z]:[\\/]))((?:[A-Za-z]:[\\/])?[^\s:[\]()]+):(?:\[(\d+)(?:,(\d+))?\]|(\d+)(?::(\d+))?)/g
/** L'estensione si verifica dopo il match: dentro la regex il `.` del percorso si scontrerebbe col gruppo finale. */
const SOURCE_EXTENSION = /\.(?:go|java|kt|kts|groovy)$/

/** Il primo "file:riga[:colonna]" di una riga di output di build/run, o null; il percorso usa sempre "/". */
export function parseConsoleLocation(text: string): ConsoleLocation | null {
  LOCATION.lastIndex = 0
  for (let match = LOCATION.exec(text); match; match = LOCATION.exec(text)) {
    if (!SOURCE_EXTENSION.test(match[1])) continue
    return { path: match[1].replace(/\\/g, '/'), line: Number(match[2] ?? match[4]), column: Number(match[3] ?? match[5] ?? 1) }
  }
  return null
}
