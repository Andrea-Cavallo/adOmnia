import type { GoIDEQuickRunKind } from '@/stores/goide'
import { findToolTargets, type GoStudioToolTarget } from './goStudioToolTargets'
import { functionAtLine } from './goStudioGoToTest'

export type GoStudioRunTargetKind = 'main' | 'test' | 'benchmark' | 'fuzz' | 'example'

/** Un ▶ del gutter: funzione Go, target make o stage Docker. */
export type GoStudioRunTarget = GoStudioGoRunTarget | GoStudioToolTarget

export interface GoStudioGoRunTarget {
  line: number
  kind: GoStudioRunTargetKind
  name: string
  /** Package relativo alla radice del progetto, es. "./cmd/api" o ".". */
  packagePath: string
}

/** Clic sul ▶ del gutter: il punto serve per aprire il menu Run/Debug accanto al glifo. */
export type GoStudioRunTargetHandler = (target: GoStudioRunTarget, anchor: { x: number; y: number }) => void

export interface GoStudioRunCommand {
  kind: 'run' | 'test'
  target: string
  programArguments: string[]
  label: string
}

const PACKAGE_MAIN = /^\s*package\s+main\b/m
const FUNC_MAIN = /^func\s+main\s*\(\s*\)/
const TEST_FUNC = /^func\s+((Test|Benchmark|Fuzz|Example)[A-Za-z0-9_]*)\s*\(/

function packagePathFor(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/')
  return slash < 0 ? '.' : `./${relativePath.slice(0, slash)}`
}

function kindFor(prefix: string): GoStudioRunTargetKind {
  if (prefix === 'Benchmark') return 'benchmark'
  if (prefix === 'Fuzz') return 'fuzz'
  if (prefix === 'Example') return 'example'
  return 'test'
}

/** Trova le righe eseguibili dal gutter: func main nei package main e le funzioni di test nei file _test.go. */
export function findRunTargets(relativePath: string, text: string): GoStudioRunTarget[] {
  if (!relativePath.endsWith('.go')) return findToolTargets(relativePath, text)
  const packagePath = packagePathFor(relativePath)
  const isTestFile = relativePath.endsWith('_test.go')
  const isMainPackage = !isTestFile && PACKAGE_MAIN.test(text)
  if (!isTestFile && !isMainPackage) return []
  const targets: GoStudioGoRunTarget[] = []
  text.split(/\r?\n/).forEach((line, index) => {
    if (isMainPackage && FUNC_MAIN.test(line)) {
      targets.push({ line: index + 1, kind: 'main', name: 'main', packagePath })
      return
    }
    const match = isTestFile ? TEST_FUNC.exec(line) : null
    if (match) targets.push({ line: index + 1, kind: kindFor(match[2]), name: match[1], packagePath })
  })
  return targets
}

/**
 * Run Current Context (Ctrl+Shift+F10 di GoLand): in un _test.go il test che contiene il cursore,
 * in un package main la sua func main. null = nessun contesto, si eseguono i test del package.
 */
export function contextRunTarget(relativePath: string, text: string, line: number): GoStudioGoRunTarget | null {
  if (!relativePath.endsWith('.go')) return null
  const targets = findRunTargets(relativePath, text) as GoStudioGoRunTarget[]
  const main = targets.find((target) => target.kind === 'main')
  if (main) return main
  const current = functionAtLine(text, line)
  return (current && !current.receiver && targets.find((target) => target.name === current.name)) || null
}

/** Traduce un target del gutter nel comando go strutturato da eseguire. */
export function runCommandFor(target: GoStudioGoRunTarget): GoStudioRunCommand {
  const exact = `^${target.name}$`
  switch (target.kind) {
    case 'main':
      return { kind: 'run', target: target.packagePath, programArguments: [], label: `go run ${target.packagePath}` }
    case 'benchmark':
      return { kind: 'test', target: target.packagePath, programArguments: ['-run', '^$', '-bench', exact, '-benchmem', '-v'], label: `Run ${target.name}` }
    case 'fuzz':
      return { kind: 'test', target: target.packagePath, programArguments: ['-run', exact, '-v', '-count=1'], label: `Run ${target.name} (seed corpus)` }
    default:
      return { kind: 'test', target: target.packagePath, programArguments: ['-run', exact, '-v', '-count=1'], label: `Run ${target.name}` }
  }
}

const PACKAGE_CLAUSE = /^package\s+\w+/
const GO_GENERATE = /^\/\/go:generate\s/m

export interface GoStudioPackageLens {
  line: number
  title: string
  tooltip: string
  kind: GoIDEQuickRunKind
}

/** Pulsanti rapidi sulla riga package: build, test, vet e generate quando servono. */
export function packageLenses(relativePath: string, text: string): GoStudioPackageLens[] {
  if (!relativePath.endsWith('.go')) return []
  const lines = text.split(/\r?\n/)
  const index = lines.findIndex((line) => PACKAGE_CLAUSE.test(line))
  if (index < 0) return []
  const line = index + 1
  const lenses: GoStudioPackageLens[] = [
    { line, title: '⚒ Build', tooltip: 'go build on this package', kind: 'build' },
    { line, title: '▶ Test', tooltip: 'go test on this package', kind: 'test' },
    { line, title: 'Vet', tooltip: 'go vet on this package', kind: 'vet' },
  ]
  if (GO_GENERATE.test(text)) lenses.push({ line, title: 'Generate', tooltip: 'go generate on this package', kind: 'generate' })
  return lenses
}
