import { lineDiff } from '@/lib/goide/goStudioLineDiff'

/**
 * Azioni AI contestuali dell'editor (§34 Runtime-Aware AI). Ogni azione diventa un prompt con il
 * contesto reale del workspace (selezione o funzione, errori, diff Git, riferimenti, test falliti,
 * coverage) che finisce nella chat scelta dall'utente: lo si rilegge prima di inviarlo.
 */
export type GoStudioAIActionId =
  | 'explain-code' | 'explain-error' | 'generate-tests' | 'generate-benchmark' | 'generate-fuzz' | 'generate-mock' | 'generate-docs'
  | 'improve-errors' | 'find-races' | 'find-leaks' | 'find-allocations' | 'find-context'

export interface GoStudioAIAction {
  id: GoStudioAIActionId
  label: string
  /** Mostrata nel menu contestuale; le altre restano nella palette dei comandi (F1). */
  contextMenu: boolean
  instruction: string
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
}

/** Il backend di Copilot accetta messaggi fino a 64 KiB: il prompt resta sotto con margine. */
export const AI_ACTION_PROMPT_LIMIT = 56 * 1024
const MAX_FOCUS_CHARS = 24_000
const MAX_DIFF_CHARS = 8_000
const MAX_TEST_OUTPUT_CHARS = 1_500

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
    context.coverage ? `Test coverage of this file: ${context.coverage.percent.toFixed(1)}%.${context.coverage.uncovered.length ? ` Functions not fully covered: ${context.coverage.uncovered.join(', ')}.` : ''}` : '',
  ]
  const prompt = sections.filter(Boolean).join('\n\n')
  return prompt.length <= AI_ACTION_PROMPT_LIMIT ? prompt : `${prompt.slice(0, AI_ACTION_PROMPT_LIMIT - 40)}\n… [context truncated]`
}
