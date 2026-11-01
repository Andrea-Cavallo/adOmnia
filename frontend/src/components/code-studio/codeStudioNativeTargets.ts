/**
 * ▶ nel gutter dei sorgenti C/C++: la funzione main. Il backend compila il file (e gli altri sorgenti
 * della cartella) e avvia il programma: serve make e un compilatore C/C++ sul PATH.
 */

export interface CodeStudioNativeRunTarget {
  line: number
  kind: 'native-main'
  name: string
  /** Cartella del file relativa al progetto: working directory di compilazione ed esecuzione. */
  directory: string
  /** Percorso relativo del sorgente da compilare. */
  relativePath: string
  /** Nome del file nella cartella: il backend lo risolve rispetto alla working directory. */
  file: string
}

const NATIVE_EXTENSIONS = ['.c', '.cc', '.cpp', '.cxx', '.m', '.mm']
// Un `main` a inizio riga: firma tipizzata o stile K&R, ma non una chiamata (`main();`).
const MAIN_DEFINITION = /^\s*(?:int\s+)?main\s*\([^;{)]*\)\s*(?:\{|$)/

export function isNativeTarget(target: { kind: string }): target is CodeStudioNativeRunTarget {
  return target.kind === 'native-main'
}

export function findNativeTargets(relativePath: string, text: string): CodeStudioNativeRunTarget[] {
  const lower = relativePath.toLowerCase()
  if (!NATIVE_EXTENSIONS.some((extension) => lower.endsWith(extension))) return []
  const index = text.split(/\r?\n/).findIndex((line) => MAIN_DEFINITION.test(line))
  if (index < 0) return []
  const slash = relativePath.lastIndexOf('/')
  return [{
    line: index + 1,
    kind: 'native-main',
    name: 'main',
    directory: slash < 0 ? '' : relativePath.slice(0, slash),
    relativePath,
    file: relativePath.slice(slash + 1),
  }]
}
