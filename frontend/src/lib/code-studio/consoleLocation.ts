export interface ConsoleLocation {
  path: string
  line: number
  column: number
}

// go build/vet, javac via Gradle (`Foo.java:12: error:`) e Maven (`Foo.java:[12,34]`). Un'estensione per volta: il resto
// ("example.com:443") non è un sorgente.
const LOCATION = /((?:[A-Za-z]:[\\/])?[^\s:[\]()]+\.(?:go|java|kt|kts|groovy)):(?:\[(\d+)(?:,(\d+))?\]|(\d+)(?::(\d+))?)/

/** Il primo "file:riga[:colonna]" di una riga di output di build/run, o null; il percorso usa sempre "/". */
export function parseConsoleLocation(text: string): ConsoleLocation | null {
  const match = LOCATION.exec(text)
  if (!match) return null
  return { path: match[1].replace(/\\/g, '/'), line: Number(match[2] ?? match[4]), column: Number(match[3] ?? match[5] ?? 1) }
}
