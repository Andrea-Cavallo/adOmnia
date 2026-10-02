/**
 * Context Propagation Inspector — analisi statica della propagazione di context.Context.
 *
 * Lavora sul testo del buffer dell'editor (anche non salvato) senza rete né tool esterni,
 * come le route HTTP e i benchmark: una scansione riga-per-riga con tracciamento delle
 * parentesi graffe per capire se si è dentro una funzione, una struct o un `select`.
 * Le euristiche sono conservative: segnalano pattern sospetti, non errori certi.
 */

export type ContextFindingKind =
  | 'background'
  | 'todo'
  | 'missing-timeout'
  | 'wide-timeout'
  | 'context-in-struct'
  | 'leaked-cancel'
  | 'ignored-cancellation'
  | 'broken-chain'
  | 'trace-id'

export type ContextSeverity = 'error' | 'warning' | 'info'

export interface ContextFinding {
  id: string
  kind: ContextFindingKind
  severity: ContextSeverity
  line: number
  message: string
  detail?: string
}

export interface ContextGraphNode {
  /** Nome della funzione (o metodo). */
  id: string
  label: string
  line: number
  /** Nomi dei parametri di tipo context.Context che la funzione riceve. */
  ctxParams: string[]
  /** true se crea un context radice (Background/TODO) invece di derivare da un parametro. */
  createsRoot: boolean
  /** true se deriva il context con WithTimeout/WithDeadline da qualche parte. */
  appliesTimeout: boolean
}

export interface ContextGraphEdge {
  from: string
  to: string
  /** Nome del context propagato (es. "ctx"). */
  via?: string
  line: number
}

export interface ContextAnalysis {
  findings: ContextFinding[]
  nodes: ContextGraphNode[]
  edges: ContextGraphEdge[]
}

export const DEFAULT_TIMEOUT_THRESHOLD_MS = 30_000

const UNIT_MS: Record<string, number> = {
  Nanosecond: 1e-6,
  Microsecond: 1e-3,
  Millisecond: 1,
  Second: 1000,
  Minute: 60_000,
  Hour: 3_600_000,
}

/** Durata Go in millisecondi: time.Second, 30*time.Second, time.Second*30, 5*time.Minute… */
export function parseGoDuration(expression: string): number | null {
  const trimmed = expression.trim()
  const unit = `(${Object.keys(UNIT_MS).join('|')})`
  const literal = `time\\.${unit}`
  const number = '\\d+(?:\\.\\d+)?'
  let match = new RegExp(`^${literal}$`).exec(trimmed)
  if (match) return UNIT_MS[match[1]]
  match = new RegExp(`^(${number})\\s*\\*\\s*${literal}$`).exec(trimmed)
  if (match) return Number(match[1]) * UNIT_MS[match[2]]
  match = new RegExp(`^${literal}\\s*\\*\\s*(${number})$`).exec(trimmed)
  if (match) return Number(match[2]) * UNIT_MS[match[1]]
  return null
}

/** Rimuove stringhe e commenti dalla riga, lasciando il codice su cui cercare. */
function stripStringsAndComments(line: string): string {
  let out = ''
  let index = 0
  while (index < line.length) {
    const char = line[index]
    if (char === '"' || char === '`') {
      out += ' '
      index++
      while (index < line.length && line[index] !== char) {
        if (char === '"' && line[index] === '\\') index++
        index++
      }
      if (index < line.length) index++
      continue
    }
    if (char === "'") {
      out += ' '
      index++
      while (index < line.length && line[index] !== "'") {
        if (line[index] === '\\') index++
        index++
      }
      if (index < line.length) index++
      continue
    }
    if (char === '/' && line[index + 1] === '/') {
      out += '  '
      break
    }
    if (char === '/' && line[index + 1] === '*') {
      out += '  '
      index += 2
      while (index < line.length && !(line[index] === '*' && line[index + 1] === '/')) index++
      index = Math.min(line.length, index + 2)
      continue
    }
    out += char
    index++
  }
  return out
}

/** Bilancio delle graffe nella riga (stringhe e commenti già rimossi). */
function braceDelta(cleaned: string): number {
  let delta = 0
  for (const char of cleaned) {
    if (char === '{') delta++
    else if (char === '}') delta--
  }
  return delta
}

const TRACE_KEY_NAMES = /^(?:traceID|traceId|traceIDKey|requestID|requestId|correlationID|correlationId|xTraceID|spanID|spanId)$/
const TRACE_KEY_LITERAL = /trace[-_]?id|traceID|traceId|x-request-id|x-request[-_]?id|request[-_]?id|correlation[-_]?id|x-correlation-id|correlationID|span[-_]?id/
const BLOCKING_CALL = /\.(?:Get|Post|Put|Patch|Delete|Head|Do|Query|QueryRow|QueryContext|Exec|ExecContext|QueryRowContext|Send|Publish|Consume|Read|Write|Run|ListenAndServe|Serve|Dial|Ping)\s*\(/

interface Scope {
  kind: 'func' | 'struct' | 'select'
  name?: string
  line: number
  ctxParams: string[]
  createsRoot: boolean
  appliesTimeout: boolean
  /** Per il `select`: come gestisce ctx.Done(). */
  doneCase?: 'used' | 'ignored' | 'missing'
}

interface RootContext {
  name: string
  line: number
  wrapped: boolean
  used: boolean
}

const FUNC_DECL = /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(([^)]*)\)[^{]*\{/
const STRUCT_DECL = /^\s*type\s+[A-Za-z_]\w*\s+struct\s*\{/
const CTX_PARAM = /([A-Za-z_]\w*)\s+context\.Context/g
const STRUCT_FIELD = /^\s*(?:[A-Za-z_]\w*\s+)?context\.Context\b/
const ROOT_ASSIGN = /([A-Za-z_]\w*)\s*(?::=|=)\s*context\.(Background|TODO)\(\)/
const DERIVED_ASSIGN = /([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*:=\s*context\.(WithCancel|WithTimeout|WithDeadline|WithValue)\s*\(([^)]*)\)/
const INLINE_TIMEOUT = /context\.(WithTimeout|WithDeadline)\s*\(\s*[^,]+,\s*([^)]*)\)/
const DONE_CASE = /case\s*<-\s*ctx\.Done\(\)\s*:/
const SELECT_START = /\bselect\s*\{/
const CALL_WITH_CTX = /([A-Za-z_]\w*)\s*\(\s*([A-Za-z_]\w*)\s*(?:,|\))/

export function analyzeContextPropagation(source: string, options?: { timeoutThresholdMs?: number }): ContextAnalysis {
  const threshold = options?.timeoutThresholdMs ?? DEFAULT_TIMEOUT_THRESHOLD_MS
  const findings: ContextFinding[] = []
  const edges: ContextGraphEdge[] = []
  const roots = new Map<string, RootContext>()
  /** Nomi di variabili note per trasportare un context (parametri, radici, derivate). */
  const contextVars = new Set<string>()

  const lines = source.split(/\r?\n/)

  // Passata 0: funzioni note, così gli archi del grafo possono puntare anche a funzioni definite dopo.
  const functionNames = new Map<string, { line: number; ctxParams: string[] }>()
  for (let index = 0; index < lines.length; index++) {
    const func = FUNC_DECL.exec(stripStringsAndComments(lines[index]))
    if (!func) continue
    const ctxParams = (func[2].match(CTX_PARAM) ?? []).map((entry) => entry.trim().split(/\s+/)[0])
    functionNames.set(func[1], { line: index + 1, ctxParams })
    for (const name of ctxParams) contextVars.add(name)
  }

  const traits = new Map<string, { createsRoot: boolean; appliesTimeout: boolean }>()
  const scopes: Scope[] = []

  const push = (finding: Omit<ContextFinding, 'id'>): void => {
    findings.push({ ...finding, id: `${finding.kind}:${finding.line}:${findings.length}` })
  }

  const innermostFunc = (): Scope | null => {
    for (let index = scopes.length - 1; index >= 0; index--) if (scopes[index].kind === 'func') return scopes[index]
    return null
  }
  const innermostStruct = (): Scope | null => {
    for (let index = scopes.length - 1; index >= 0; index--) if (scopes[index].kind === 'struct') return scopes[index]
    return null
  }
  const innermostSelect = (): Scope | null => {
    for (let index = scopes.length - 1; index >= 0; index--) if (scopes[index].kind === 'select') return scopes[index]
    return null
  }
  const markTrait = (fn: Scope, key: 'createsRoot' | 'appliesTimeout'): void => {
    fn[key] = true
    const entry = traits.get(fn.name ?? '') ?? { createsRoot: false, appliesTimeout: false }
    entry[key] = true
    traits.set(fn.name ?? '', entry)
  }

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]
    const line = index + 1
    const cleaned = stripStringsAndComments(raw)

    // Funzione che apre il corpo su questa riga.
    const func = FUNC_DECL.exec(cleaned)
    if (func) {
      const ctxParams = (func[2].match(CTX_PARAM) ?? []).map((entry) => entry.trim().split(/\s+/)[0])
      scopes.push({ kind: 'func', name: func[1], line, ctxParams, createsRoot: false, appliesTimeout: false })
    }

    // Struct: i campi che seguono vengono letti finché la struct non si chiude.
    if (STRUCT_DECL.test(cleaned)) {
      scopes.push({ kind: 'struct', line, ctxParams: [], createsRoot: false, appliesTimeout: false })
    } else if (innermostStruct() && STRUCT_FIELD.test(cleaned) && !/^\s*\{/.test(cleaned)) {
      const fieldName = (cleaned.match(/([A-Za-z_]\w*)\s+context\.Context/) ?? [])[1] ?? 'context.Context'
      push({
        kind: 'context-in-struct', severity: 'warning', line,
        message: `Context stored in struct field "${fieldName}".`,
        detail: 'Storing context.Context in a struct is discouraged: contexts should flow as parameters with a clear cancellation owner.',
      })
    }

    // context.Background() / context.TODO(): radice del grafo e da evidenziare.
    const rootAssign = ROOT_ASSIGN.exec(cleaned)
    if (rootAssign) {
      const name = rootAssign[1]
      const kind: ContextFindingKind = rootAssign[2] === 'TODO' ? 'todo' : 'background'
      roots.set(name, { name, line, wrapped: false, used: false })
      contextVars.add(name)
      push({
        kind, severity: kind === 'todo' ? 'warning' : 'info', line,
        message: kind === 'todo'
          ? `context.TODO() creates an unfinished context ("${name}").`
          : `context.Background() creates a root context ("${name}").`,
        detail: kind === 'todo'
          ? 'context.TODO() is a placeholder: it never carries a deadline or cancellation. Replace it before shipping.'
          : 'A root context has no parent: it never carries a deadline or cancellation unless wrapped with WithTimeout/WithDeadline.',
      })
      const fn = innermostFunc()
      if (fn) {
        markTrait(fn, 'createsRoot')
        if (fn.ctxParams.length > 0) {
          push({
            kind: 'broken-chain', severity: 'error', line,
            message: `Cancellation chain broken: "${name}" derives from context.Background/TODO instead of the "${fn.ctxParams.join('", "')}" parameter.`,
            detail: 'This function already receives a context: creating a new root context drops the caller\'s cancellation and deadline.',
          })
        }
      }
    }

    // WithCancel / WithTimeout / WithDeadline / WithValue.
    const derived = DERIVED_ASSIGN.exec(cleaned)
    if (derived) {
      const ctxVar = derived[1]
      const cancelVar = derived[2]
      const method = derived[3]
      const args = derived[4]
      contextVars.add(ctxVar)
      const parent = roots.get(args.split(',')[0]?.trim() ?? '')
      if (parent && (method === 'WithTimeout' || method === 'WithDeadline')) parent.wrapped = true
      if (method === 'WithValue') {
        const keyExpr = (args.split(',')[1] ?? '').trim()
        if (TRACE_KEY_NAMES.test(keyExpr)) {
          push({
            kind: 'trace-id', severity: 'info', line,
            message: `Trace ID correlated through context value "${keyExpr}".`,
            detail: 'context.WithValue carries a trace/request identifier: a correlation point between code and runtime traces.',
          })
        }
      }
      if (method === 'WithTimeout') {
        const durationExpr = (args.split(',')[1] ?? '').trim()
        const millis = parseGoDuration(durationExpr)
        if (millis !== null && millis > threshold) {
          push({
            kind: 'wide-timeout', severity: 'warning', line,
            message: `Timeout too wide: ${durationExpr} (${formatMillis(millis)}) exceeds the configured ${formatMillis(threshold)}.`,
            detail: 'A timeout this large hides slow paths. Lower it or split the work into smaller cancellable steps.',
          })
        }
      }
      if (method !== 'WithValue') {
        const remaining = lines.slice(index + 1).join('\n')
        const used = new RegExp(`defer\\s+${cancelVar}\\s*\\(`).test(cleaned) || new RegExp(`\\b${cancelVar}\\s*\\(`).test(remaining)
        if (!used) {
          push({
            kind: 'leaked-cancel', severity: 'warning', line,
            message: `Cancel function "${cancelVar}" from context.${method} is never called or deferred.`,
            detail: 'The cancel function releases resources tied to the context. Defer it right after creating the context to avoid leaks.',
          })
        }
      }
      const fn = innermostFunc()
      if (fn && (method === 'WithTimeout' || method === 'WithDeadline')) markTrait(fn, 'appliesTimeout')
    } else if (INLINE_TIMEOUT.test(cleaned)) {
      const inline = INLINE_TIMEOUT.exec(cleaned)
      const fn = innermostFunc()
      if (fn) markTrait(fn, 'appliesTimeout')
      const millis = inline ? parseGoDuration(inline[2].trim()) : null
      if (millis !== null && millis > threshold) {
        push({
          kind: 'wide-timeout', severity: 'warning', line,
          message: `Timeout too wide: ${inline?.[2]?.trim() ?? ''} (${formatMillis(millis)}) exceeds the configured ${formatMillis(threshold)}.`,
        })
      }
    }

    // Trace id: letterale noto usato come chiave o header, non già coperto da WithValue.
    if (TRACE_KEY_LITERAL.test(raw) && !/context\.(WithValue|Background|TODO)/.test(cleaned)) {
      const literal = (raw.match(TRACE_KEY_LITERAL) ?? [])[0]
      push({
        kind: 'trace-id', severity: 'info', line,
        message: `Trace ID literal "${literal}" found.`,
        detail: 'A trace/request identifier in this position can be correlated with runtime traces and logs.',
      })
    }

    // select: traccia come gestisce ctx.Done().
    if (SELECT_START.test(cleaned)) {
      scopes.push({ kind: 'select', line, ctxParams: [], createsRoot: false, appliesTimeout: false })
    }
    const selectScope = innermostSelect()
    if (selectScope) {
      if (DONE_CASE.test(cleaned)) {
        const next = lines[index + 1]?.trim() ?? ''
        const empty = next === '' || next.startsWith('case ') || next === '}' || next.startsWith('default:')
        selectScope.doneCase = empty ? 'ignored' : 'used'
        if (empty) {
          push({
            kind: 'ignored-cancellation', severity: 'warning', line,
            message: 'Cancellation ignored: the ctx.Done() case has an empty body.',
            detail: 'An empty case on ctx.Done() drops the cancellation signal. Return an error or clean up instead of silently continuing.',
          })
        }
      } else if (/case\s/.test(cleaned) && !selectScope.doneCase) {
        selectScope.doneCase = 'missing'
      }
    }

    // Goroutine o chiamata bloccante che usa un context radice senza timeout.
    if (/\bgo\b/.test(cleaned) || BLOCKING_CALL.test(cleaned)) {
      for (const root of roots.values()) {
        if (!root.wrapped && new RegExp(`\\b${root.name}\\b`).test(cleaned)) root.used = true
      }
    }

    // Propagazione: chiamata a una funzione nota che riceve un context conosciuto.
    const call = CALL_WITH_CTX.exec(cleaned)
    if (call && functionNames.has(call[1]) && contextVars.has(call[2])) {
      const fn = innermostFunc()
      if (fn) edges.push({ from: fn.name ?? '', to: call[1], via: call[2], line })
    }

    // Chiusura degli scope alla fine della riga.
    const delta = braceDelta(cleaned)
    if (delta < 0) {
      let closes = -delta
      while (closes > 0 && scopes.length > 0) {
        const popped = scopes.pop()
        if (popped?.kind === 'select' && popped.doneCase === 'missing') {
          const fn = innermostFunc()
          if (fn && fn.ctxParams.length > 0) {
            push({
              kind: 'ignored-cancellation', severity: 'info', line: popped.line,
              message: 'select without a ctx.Done() case.',
              detail: 'This select cannot be cancelled: add a case <-ctx.Done() so the operation stops when the caller cancels.',
            })
          }
        }
        closes--
      }
    }
  }

  // Context radice usato ma mai avvolto da WithTimeout/WithDeadline.
  for (const root of roots.values()) {
    if (root.used && !root.wrapped) {
      push({
        kind: 'missing-timeout', severity: 'warning', line: root.line,
        message: `Context "${root.name}" is used in a goroutine or blocking call without any timeout.`,
        detail: 'Wrap it with context.WithTimeout or context.WithDeadline so the operation cannot hang forever.',
      })
    }
  }

  const nodes: ContextGraphNode[] = [...functionNames.entries()].map(([name, info]) => ({
    id: name,
    label: name,
    line: info.line,
    ctxParams: info.ctxParams,
    createsRoot: traits.get(name)?.createsRoot ?? false,
    appliesTimeout: traits.get(name)?.appliesTimeout ?? false,
  })).sort((left, right) => left.line - right.line)

  const order: Record<ContextSeverity, number> = { error: 0, warning: 1, info: 2 }
  findings.sort((left, right) => order[left.severity] - order[right.severity] || left.line - right.line)

  return { findings, nodes, edges }
}

export function formatMillis(millis: number): string {
  if (millis < 1000) return `${Math.round(millis)}ms`
  if (millis < 60_000) return `${(millis / 1000).toFixed(1)}s`
  return `${Math.floor(millis / 60_000)}m`
}

export const CONTEXT_TIMEOUT_KEY = 'adomnia.goStudio.contextTimeoutMs'

/** Soglia configurabile del timeout "troppo ampio", persistita tra le sessioni. */
export function loadContextTimeoutThreshold(): number {
  const stored = Number(localStorage.getItem(CONTEXT_TIMEOUT_KEY))
  return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_TIMEOUT_THRESHOLD_MS
}

export function saveContextTimeoutThreshold(ms: number): void {
  localStorage.setItem(CONTEXT_TIMEOUT_KEY, String(ms))
}

export function contextFindingSummary(findings: readonly ContextFinding[]): { errors: number; warnings: number; infos: number } {
  let errors = 0
  let warnings = 0
  let infos = 0
  for (const finding of findings) {
    if (finding.severity === 'error') errors++
    else if (finding.severity === 'warning') warnings++
    else infos++
  }
  return { errors, warnings, infos }
}
