// Line context: what the code under the cursor is in the running system. Pure, from the project's
// architecture report; the Go Studio "Context" pane adds the runtime facts (live requests, SQL,
// messages, tests, diagnostics, Runtime Lens) for the items found here.
import type { GoIDEArchitecture, GoIDEArchEntry } from '@/lib/goide-api'

type ArchFunction = GoIDEArchitecture['functions'][number]
type ArchQuery = GoIDEArchitecture['queries'][number]
type ArchInterface = GoIDEArchitecture['interfaces'][number]
type ArchModule = GoIDEArchitecture['modules'][number]

export interface LineContext {
  /** Function around the cursor (nearest declaration above it in the file). */
  fn?: ArchFunction
  /** HTTP/gRPC routes registered here or served by this function. */
  routes: GoIDEArchEntry[]
  /** Kafka producers/consumers in this function. */
  kafka: GoIDEArchEntry[]
  queries: ArchQuery[]
  /** Interface declared on this line, with its implementations. */
  iface?: ArchInterface
  /** Interfaces the type declared on this line implements. */
  implemented: ArchInterface[]
  /** Test, benchmark or fuzz target around the cursor. */
  test?: string
  /** A goroutine is started on this line. */
  goroutine: boolean
  /** go.mod: module required on this line. */
  module?: string
}


/** Lines [start, end) of the function around `line`: up to the next declaration in the same file. */
function functionRange(functions: readonly ArchFunction[], file: string, line: number): { fn?: ArchFunction; start: number; end: number } {
  // ponytail: the report has declaration lines, not end lines; the next declaration bounds a function.
  const inFile = functions.filter((fn) => fn.site.relativePath === file).sort((a, b) => a.site.line - b.site.line)
  const index = inFile.filter((fn) => fn.site.line <= line).length - 1
  if (index < 0) return { start: line, end: line + 1 }
  return { fn: inFile[index], start: inFile[index].site.line, end: inFile[index + 1]?.site.line ?? Number.MAX_SAFE_INTEGER }
}

const within = (site: { relativePath: string; line: number } | null | undefined, file: string, start: number, end: number) =>
  !!site && site.relativePath === file && site.line >= start && site.line < end

/** Test, benchmark or fuzz function around a line of a _test.go file, from its text (tests are not in the call graph). */
export function testAt(file: string, lines: readonly string[], line: number): string | undefined {
  if (!file.endsWith('_test.go')) return undefined
  for (let index = Math.min(line, lines.length) - 1; index >= 0; index--) {
    const match = /^func\s+(\w+)\s*\(/.exec(lines[index])
    if (match) return /^(Test|Benchmark|Fuzz|Example)/.test(match[1]) ? match[1] : undefined
  }
  return undefined
}

/** go.mod `require` line: `module/path v1.2.3` (with or without the keyword). */
export function moduleOnLine(text: string): string | undefined {
  return /^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]{2,}\/[^\s]+)\s+v\d/i.exec(text)?.[1]
}

export function lineContext(report: GoIDEArchitecture | null | undefined, file: string, line: number, lineText = ''): LineContext {
  const empty: LineContext = { routes: [], kafka: [], queries: [], implemented: [], goroutine: /(^|[\s;{])go\s+(func\b|[\w.]+\()/.test(lineText) }
  if (file.endsWith('go.mod')) return { ...empty, goroutine: false, module: moduleOnLine(lineText) }
  if (!report) return empty
  const { fn, start, end } = functionRange(report.functions ?? [], file, line)
  const onLine = (site: { relativePath: string; line: number } | null | undefined) => !!site && site.relativePath === file && site.line === line
  const entries = report.entries ?? []
  const routes = entries.filter((entry) => (entry.kind === 'http' || entry.kind === 'grpc') && (onLine(entry.site) || within(entry.handlerSite, file, start, end) || (!entry.handlerSite && within(entry.site, file, start, end))))
  const kafka = entries.filter((entry) => (entry.kind === 'kafka-producer' || entry.kind === 'kafka-consumer') && (within(entry.site, file, start, end) || within(entry.breakSite, file, start, end)))
  const queries = (report.queries ?? []).filter((query) => within(query.site, file, start, end))
  const interfaces = report.interfaces ?? []
  const iface = interfaces.find((item) => onLine(item.site))
  const implemented = interfaces.filter((item) => item.implementations.some((impl) => onLine(impl.site)))
  return { ...empty, fn, routes, kafka, queries, iface, implemented }
}

/** Modules of the report a go.mod line refers to (for the dependency section). */
export function moduleInfo(report: GoIDEArchitecture | null | undefined, path: string): ArchModule | undefined {
  return report?.modules?.find((module) => module.path === path)
}
