import type { GoIDEArchitecture } from '@/lib/goide-api'
import { lineDiff } from '@/lib/goide/goStudioLineDiff'

/**
 * Azioni AI contestuali dell'editor (§34 Runtime-Aware AI). Ogni azione diventa un prompt con il
 * contesto reale del workspace (selezione o funzione, errori, diff Git, riferimenti, test falliti,
 * coverage) che finisce nella chat scelta dall'utente: lo si rilegge prima di inviarlo.
 */
export type GoStudioAIActionId =
  | 'explain-code' | 'explain-error' | 'generate-tests' | 'generate-benchmark' | 'generate-fuzz' | 'generate-mock' | 'generate-docs'
  | 'improve-errors' | 'find-races' | 'find-leaks' | 'find-allocations' | 'find-context'
  | 'explain-dependency' | 'explain-architecture' | 'generate-api-call' | 'generate-sql' | 'generate-migration' | 'generate-kafka-message'

/** Parte dell'analisi dell'architettura (Architecture Explorer, go/packages) allegata al prompt. */
export type GoStudioAIBrief = 'architecture' | 'dependencies' | 'api' | 'data' | 'events'

export interface GoStudioAIAction {
  id: GoStudioAIActionId
  label: string
  /** Mostrata nel menu contestuale; le altre restano nella palette dei comandi (F1). */
  contextMenu: boolean
  instruction: string
  brief?: GoStudioAIBrief
}

export const GO_STUDIO_AI_ACTIONS: readonly GoStudioAIAction[] = [
  { id: 'explain-code', label: 'Explain Code', contextMenu: true, instruction: 'Explain what this Go code does, why it is written this way and anything surprising about it. Use the references to say who depends on it.' },
  { id: 'explain-error', label: 'Explain Error', contextMenu: true, instruction: 'Explain the reported problems in plain words: the root cause, why the compiler or linter reports it, and the smallest correct fix.' },
  { id: 'generate-tests', label: 'Generate Tests', contextMenu: true, instruction: 'Write table-driven Go tests for this code in the _test.go file of the same package. Cover the edge cases and the error paths; use the coverage data to target what is not covered yet.' },
  { id: 'improve-errors', label: 'Improve Error Handling', contextMenu: true, instruction: 'Review the error handling: unchecked errors, errors without context (wrap with %w), swallowed errors, panics that should be errors. Propose the corrected code.' },
  { id: 'find-races', label: 'Find Race Risks', contextMenu: true, instruction: 'Find data race risks: shared state touched by several goroutines without synchronisation, captured loop variables, maps used concurrently. For each one give the lines and the fix.' },
  { id: 'generate-docs', label: 'Generate Docs', contextMenu: true, instruction: 'Write Go doc comments for the exported identifiers, in the style of the standard library (start with the identifier name, say what it does and what it returns).' },
  { id: 'generate-benchmark', label: 'Generate Benchmark', contextMenu: false, instruction: 'Write a Go benchmark (func BenchmarkXxx(b *testing.B) with b.Loop or b.N and b.ReportAllocs) for this code, with realistic inputs.' },
  { id: 'generate-fuzz', label: 'Generate Fuzz Target', contextMenu: false, instruction: 'Write a Go fuzz target (func FuzzXxx(f *testing.F)) for this code with a useful seed corpus and the invariants it should check.' },
  { id: 'generate-mock', label: 'Generate Mock', contextMenu: false, instruction: 'Write a hand-written mock (no code generator) for the interfaces in this code, recording calls and returning configurable results, ready for table-driven tests.' },
  { id: 'find-leaks', label: 'Find Goroutine Leaks', contextMenu: false, instruction: 'Find goroutines that may never end: blocked channel sends or receives, missing ctx.Done() checks, tickers never stopped, unbounded workers. Give the lines and the fix.' },
  { id: 'find-allocations', label: 'Find Allocation Hotspots', contextMenu: false, instruction: 'Find avoidable allocations: string concatenation in loops, slices and maps without capacity, interface conversions, closures escaping to the heap. Rank them by likely impact.' },
  { id: 'find-context', label: 'Find Missing Context Propagation', contextMenu: false, instruction: 'Find places where a context.Context should be passed but is not: context.Background()/TODO() inside request paths, I/O calls without ctx, goroutines that drop the caller context.' },
  { id: 'explain-dependency', label: 'Explain Dependency', contextMenu: false, brief: 'dependencies', instruction: 'Explain the dependency (import or module) at the cursor: what it does, which packages of this project use it and for what, whether the standard library or an existing dependency could replace it, and its security and binary size impact.' },
  { id: 'explain-architecture', label: 'Explain Architecture', contextMenu: false, brief: 'architecture', instruction: 'Explain the architecture of this project: the layers and their packages, how a request or message flows from the entry points to storage, where this code sits in it, and the coupling or boundary problems worth fixing.' },
  { id: 'generate-api-call', label: 'Generate API Call', contextMenu: false, brief: 'api', instruction: 'Write ready-to-run calls for the HTTP or gRPC endpoint handled by this code: a curl command and a raw HTTP request with method, path, headers and a realistic JSON body matching the request type, plus the expected response.' },
  { id: 'generate-sql', label: 'Generate SQL Query', contextMenu: false, brief: 'data', instruction: 'Write the SQL this code needs (select, insert, update or delete) for the tables and types shown, with placeholders instead of string formatting, plus the Go code that runs it and scans the rows.' },
  { id: 'generate-migration', label: 'Generate Migration', contextMenu: false, brief: 'data', instruction: 'Write a database migration (up and down SQL) that creates or changes the tables for the Go types in this code: column types, NOT NULL, defaults, primary and foreign keys, and the indexes the existing queries need.' },
  { id: 'generate-kafka-message', label: 'Generate Kafka Message', contextMenu: false, brief: 'events', instruction: 'Write an example Kafka message for this code: topic, key, headers and a realistic JSON value matching the Go struct, plus the producer code that sends it and what the consumers shown will do with it.' },
]

export interface GoStudioAIProblem {
  line: number
  message: string
  source?: string
}

export interface GoStudioAIFailingTest {
  name: string
  output: string
}

/** Contesto raccolto dall'editor e dal workspace; ogni campo opzionale manca se non è disponibile. */
export interface GoStudioAIContext {
  relativePath: string
  /** Righe 1-based del codice in focus. */
  focus: { startLine: number; endLine: number; code: string; kind: 'selection' | 'function' | 'file' }
  symbol?: string
  problems: GoStudioAIProblem[]
  diff?: string
  references: string[]
  failingTests: GoStudioAIFailingTest[]
  coverage?: { percent: number; uncovered: string[] }
  /** Riassunto dell'architettura (architectureBrief) per le azioni che lo chiedono. */
  architecture?: string
}

/** Il backend di Copilot accetta messaggi fino a 64 KiB: il prompt resta sotto con margine. */
export const AI_ACTION_PROMPT_LIMIT = 56 * 1024
const MAX_FOCUS_CHARS = 24_000
const MAX_DIFF_CHARS = 8_000
const MAX_TEST_OUTPUT_CHARS = 1_500
const MAX_ARCHITECTURE_CHARS = 16_000
const MAX_BRIEF_ITEMS = 60

type ArchEntry = GoIDEArchitecture['entries'][number]

function list<T>(items: readonly T[], line: (item: T) => string): string[] {
  const lines = items.slice(0, MAX_BRIEF_ITEMS).map(line)
  return items.length > MAX_BRIEF_ITEMS ? [...lines, `… and ${items.length - MAX_BRIEF_ITEMS} more`] : lines
}

const at = (site: { relativePath: string; line: number }) => `${site.relativePath}:${site.line}`

function body(value: ArchEntry['request']): string {
  return value ? `${value.array ? '[]' : ''}${value.ref || value.type}` : ''
}

function entryLine(entry: ArchEntry): string {
  const parts = [
    `- ${entry.kind} ${entry.name}`,
    entry.detail ? ` (${entry.detail})` : '',
    entry.topics?.length ? ` topics: ${entry.topics.join(', ')}` : '',
    entry.request ? ` request: ${body(entry.request)}` : '',
    entry.response ? ` response: ${body(entry.response)}` : '',
    ` — ${at(entry.handlerSite ?? entry.site)}`,
  ]
  return parts.join('')
}

/** Riassume l'analisi dell'architettura per il tipo di azione: solo la parte che le serve. */
export function architectureBrief(report: GoIDEArchitecture, brief: GoStudioAIBrief): string {
  const entries = (kinds: readonly string[]) => report.entries.filter((entry) => kinds.includes(entry.kind))
  const schemas = list(report.schemas, (schema) => `- ${schema.name} {${schema.fields.map((field) => `${field.name} ${field.ref || field.type}`).join(', ')}} — ${at(schema.site)}`)
  const sections: Array<[string, string[]]> = []
  switch (brief) {
    case 'architecture':
      sections.push(['Packages', list(report.packages, (pkg) => `- ${pkg.path} (${pkg.files} files)${pkg.external.length ? ` uses ${pkg.external.join(', ')}` : ''}`)])
      sections.push(['Internal imports', list(report.imports, (edge) => `- ${edge.from} -> ${edge.to}`)])
      sections.push(['Entry points', list(report.entries, entryLine)])
      break
    case 'dependencies':
      sections.push(['Modules', list(report.modules, (module) => `- ${module.path}${module.external.length ? ` requires ${module.external.join(', ')}` : ''}`)])
      sections.push(['External packages used by each package', list(report.packages.filter((pkg) => pkg.external.length), (pkg) => `- ${pkg.path}: ${pkg.external.join(', ')}`)])
      break
    case 'api':
      sections.push(['HTTP and gRPC endpoints', list(entries(['http', 'grpc', 'middleware']), entryLine)])
      sections.push(['Request and response types', schemas])
      break
    case 'data':
      sections.push(['Queries', list(report.queries, (query) => `- ${query.operation} ${query.tables.join(', ') || '?'} in ${query.function}${query.sql ? `: ${query.sql.replace(/\s+/g, ' ')}` : query.model ? ` (model ${query.model})` : ''} — ${at(query.site)}`)])
      sections.push(['Repositories', list(entries(['repository']), entryLine)])
      sections.push(['Types', schemas])
      break
    case 'events':
      sections.push(['Kafka producers and consumers', list(entries(['kafka-producer', 'kafka-consumer']), entryLine)])
      sections.push(['Types', schemas])
      break
  }
  return sections.filter(([, lines]) => lines.length).map(([title, lines]) => `${title}:\n${lines.join('\n')}`).join('\n\n')
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… [truncated]`
}

/**
 * La funzione (o il tipo, o il blocco top-level) che contiene la riga: dalla dichiarazione a
 * colonna 0 più vicina sopra fino alla `}` a colonna 0 che la chiude. Null fuori da un blocco.
 */
export function enclosingTopLevelBlock(lines: readonly string[], line: number): { startLine: number; endLine: number } | null {
  let start = -1
  for (let index = Math.min(line, lines.length) - 1; index >= 0; index--) {
    if (/^(func|type|var|const)\b/.test(lines[index])) { start = index; break }
    if (index < line - 1 && /^}/.test(lines[index])) return null
  }
  if (start < 0) return null
  // ponytail: chiusura cercata a colonna 0, vale per il codice gofmt; dichiarazioni su una riga finiscono lì.
  if (!/[{(]\s*$/.test(lines[start])) return start + 1 >= line ? { startLine: start + 1, endLine: start + 1 } : null
  for (let index = start + 1; index < lines.length; index++) {
    if (/^[})]/.test(lines[index])) return index + 1 >= line ? { startLine: start + 1, endLine: index + 1 } : null
  }
  return null
}

/** Diff in formato unificato (senza intestazioni di file) fra HEAD e il buffer. Vuoto se uguali. */
export function unifiedDiff(previous: string, current: string, context = 2): string {
  const oldLines = previous.replace(/\r\n/g, '\n').split('\n')
  const newLines = current.replace(/\r\n/g, '\n').split('\n')
  return lineDiff(previous, current).map((hunk) => {
    const before = newLines.slice(Math.max(0, hunk.newStart - 1 - context), hunk.newStart - 1).map((text) => ` ${text}`)
    const removed = hunk.kind === 'added' ? [] : oldLines.slice(hunk.oldStart - 1, hunk.oldEnd).map((text) => `-${text}`)
    const added = hunk.kind === 'deleted' ? [] : newLines.slice(hunk.newStart - 1, hunk.newEnd).map((text) => `+${text}`)
    const afterStart = hunk.kind === 'deleted' ? hunk.newStart : hunk.newEnd
    const after = newLines.slice(afterStart, afterStart + context).map((text) => ` ${text}`)
    return [`@@ line ${hunk.newStart} @@`, ...before, ...removed, ...added, ...after].join('\n')
  }).join('\n')
}

/** Testo da mettere nella chat: istruzione, poi solo le sezioni di contesto che esistono davvero. */
export function buildAIActionPrompt(action: GoStudioAIAction, context: GoStudioAIContext): string {
  const { focus } = context
  const where = focus.kind === 'file' ? context.relativePath : `${context.relativePath}, lines ${focus.startLine}-${focus.endLine}`
  const sections = [
    `${action.instruction}\nReply in the language of this request. Reference code as file:line.`,
    `Code (${focus.kind === 'selection' ? 'selection' : focus.kind === 'function' ? 'enclosing declaration' : 'whole file'}, ${where}):\n\`\`\`go\n${clip(focus.code, MAX_FOCUS_CHARS)}\n\`\`\``,
    context.problems.length ? `Compiler and linter problems in ${context.relativePath}:\n${context.problems.map((problem) => `- line ${problem.line}: ${problem.message}${problem.source ? ` (${problem.source})` : ''}`).join('\n')}` : '',
    context.references.length ? `References to ${context.symbol ?? 'this symbol'} (gopls):\n${context.references.map((reference) => `- ${reference}`).join('\n')}` : '',
    context.diff ? `Uncommitted changes in this file (git diff against HEAD):\n\`\`\`diff\n${clip(context.diff, MAX_DIFF_CHARS)}\n\`\`\`` : '',
    context.failingTests.length ? `Failing tests in the last run:\n${context.failingTests.map((test) => `- ${test.name}\n\`\`\`\n${clip(test.output.trim(), MAX_TEST_OUTPUT_CHARS)}\n\`\`\``).join('\n')}` : '',
    context.architecture ? `Project analysis (adOmnia Architecture Explorer):\n${clip(context.architecture, MAX_ARCHITECTURE_CHARS)}` : '',
    context.coverage ? `Test coverage of this file: ${context.coverage.percent.toFixed(1)}%.${context.coverage.uncovered.length ? ` Functions not fully covered: ${context.coverage.uncovered.join(', ')}.` : ''}` : '',
  ]
  const prompt = sections.filter(Boolean).join('\n\n')
  return prompt.length <= AI_ACTION_PROMPT_LIMIT ? prompt : `${prompt.slice(0, AI_ACTION_PROMPT_LIMIT - 40)}\n… [context truncated]`
}
