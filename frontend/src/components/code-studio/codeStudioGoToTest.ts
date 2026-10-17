/** Go to Test: file ↔ file di test e funzione ↔ test, con le convenzioni di `go test` e di gopls. */

export interface GoFunctionRef {
  name: string
  /** Tipo del ricevitore senza `*` né parametri generici; '' per le funzioni. */
  receiver: string
}

const FUNC_DECL = /^func\s+(?:\(\s*(?:\w+\s+)?\*?\s*([\w.]+)(?:\[[^\]]*\])?\s*\)\s*)?(\w+)/

export function isTestFile(relativePath: string): boolean {
  return relativePath.endsWith('_test.go')
}

/** foo.go ↔ foo_test.go nella stessa cartella. */
export function testCounterpart(relativePath: string): string | null {
  if (isTestFile(relativePath)) return relativePath.replace(/_test\.go$/, '.go')
  return relativePath.endsWith('.go') ? relativePath.replace(/\.go$/, '_test.go') : null
}

/** Funzione o metodo che contiene la riga (1-based): la dichiarazione più vicina sopra il cursore. */
export function functionAtLine(text: string, line: number): GoFunctionRef | null {
  const lines = text.split(/\r?\n/)
  for (let index = Math.min(line, lines.length) - 1; index >= 0; index--) {
    const match = FUNC_DECL.exec(lines[index])
    if (match) return { receiver: match[1] ?? '', name: match[2] }
    // Una chiusura a colonna 0 dopo il cursore significa che siamo fuori da ogni funzione.
    if (index < line - 1 && lines[index] === '}') return null
  }
  return null
}

function upperFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** Nome del test di gopls "Add test": TestFoo, oppure TestType_Method per i metodi. */
export function testNameFor(ref: GoFunctionRef): string {
  return ref.receiver ? `Test${upperFirst(ref.receiver)}_${upperFirst(ref.name)}` : `Test${upperFirst(ref.name)}`
}

/** Dalla funzione di test alla funzione provata: TestFoo → Foo/foo, TestType_Method → Type.Method. */
export function subjectOfTest(testName: string): GoFunctionRef[] {
  const match = /^(?:Test|Benchmark|Fuzz|Example)_?(\w+)$/.exec(testName)
  if (!match) return []
  const [first, second] = match[1].split('_')
  if (second) return [{ receiver: first, name: second }, { receiver: first, name: second.charAt(0).toLowerCase() + second.slice(1) }]
  return [{ receiver: '', name: first }, { receiver: '', name: first.charAt(0).toLowerCase() + first.slice(1) }]
}

/** Riga (1-based) della dichiarazione, oppure null. Il ricevitore vuoto accetta solo funzioni. */
export function declarationLine(text: string, ref: GoFunctionRef): number | null {
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const match = FUNC_DECL.exec(lines[index])
    if (match && match[2] === ref.name && (match[1] ?? '') === ref.receiver) return index + 1
  }
  return null
}
