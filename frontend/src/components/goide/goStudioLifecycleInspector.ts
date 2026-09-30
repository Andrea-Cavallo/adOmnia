import type { ConcurrencyDiagnostic } from './goStudioConcurrency'

interface FunctionBody {
  start: number
  end: number
  text: string
  name: string
}

interface LockEdge {
  from: string
  to: string
  offset: number
  functionName: string
}

const CONTEXT_CREATION = /\b[\w.]+\s*,\s*([A-Za-z_]\w*)\s*(?::=|=)\s*context\.(WithCancel|WithTimeout|WithDeadline)\s*\(/g
const TIMER_CREATION = /\b([A-Za-z_]\w*)\s*(?::=|=)\s*time\.(NewTimer|NewTicker|AfterFunc)\s*\(/g

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Replace comments and literals without shifting offsets, so reported source lines remain exact. */
function codeOnly(source: string): string {
  let result = ''
  let quote: '"' | "'" | '`' | null = null
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    const next = source[index + 1]
    if (quote) {
      if (character === '\\' && quote !== '`') {
        result += '  '
        index++
        continue
      }
      result += character === '\n' ? '\n' : ' '
      if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      result += ' '
      continue
    }
    if (character === '/' && next === '/') {
      result += '  '
      index += 2
      while (index < source.length && source[index] !== '\n') {
        result += ' '
        index++
      }
      if (source[index] === '\n') result += '\n'
      continue
    }
    if (character === '/' && next === '*') {
      result += '  '
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        result += source[index] === '\n' ? '\n' : ' '
        index++
      }
      if (index < source.length) {
        result += '  '
        index++
      }
      continue
    }
    result += character
  }
  return result
}

function functionBodies(code: string): FunctionBody[] {
  const bodies: FunctionBody[] = []
  const starts = /\bfunc\s*(?:\([^)]*\)\s*)?([A-Za-z_]\w*)[^{}]*\{/g
  let match: RegExpExecArray | null
  while ((match = starts.exec(code))) {
    const open = starts.lastIndex - 1
    let depth = 1
    let cursor = open + 1
    for (; cursor < code.length && depth > 0; cursor++) {
      if (code[cursor] === '{') depth++
      else if (code[cursor] === '}') depth--
    }
    if (depth === 0) bodies.push({ start: open + 1, end: cursor - 1, text: code.slice(open + 1, cursor - 1), name: match[1] })
  }
  return bodies
}

function goroutineBodies(code: string): FunctionBody[] {
  const bodies: FunctionBody[] = []
  const starts = /\bgo\s+func\b[^{}]*\{/g
  while (starts.exec(code)) {
    const open = starts.lastIndex - 1
    let depth = 1
    let cursor = open + 1
    for (; cursor < code.length && depth > 0; cursor++) {
      if (code[cursor] === '{') depth++
      else if (code[cursor] === '}') depth--
    }
    if (depth === 0) bodies.push({ start: open + 1, end: cursor - 1, text: code.slice(open + 1, cursor - 1), name: 'goroutine' })
  }
  return bodies
}

/** Pairs held locks with a later lock, keeping deferred unlocks until the end of the source function. */
function lockEdges(body: FunctionBody): LockEdge[] {
  const edges: LockEdge[] = []
  const held: Array<{ target: string; offset: number }> = []
  const calls = /\b(defer\s+)?([\w.]+)\s*\.\s*(Lock|RLock|Unlock|RUnlock)\s*\(/g
  let call: RegExpExecArray | null
  while ((call = calls.exec(body.text))) {
    const deferred = Boolean(call[1])
    const target = call[2]
    const acquisition = call[3] === 'Lock' || call[3] === 'RLock'
    if (acquisition) {
      for (const prior of held) {
        if (prior.target !== target) edges.push({ from: prior.target, to: target, offset: body.start + call.index, functionName: body.name })
      }
      if (!held.some((entry) => entry.target === target)) held.push({ target, offset: body.start + call.index })
      continue
    }
    // `defer mu.Unlock()` releases at function return, so `mu` stays held for following source lines.
    if (deferred) continue
    const index = held.map((entry) => entry.target).lastIndexOf(target)
    if (index >= 0) held.splice(index, 1)
  }
  return edges
}

function lineAt(source: string, offset: number): number {
  let line = 1
  for (let index = 0; index < offset; index++) if (source[index] === '\n') line++
  return line
}

/**
 * Conservative static lifecycle pass for the selected Go source file.
 * It intentionally reports only a missing local cleanup call: branches, ownership transfers and
 * calls hidden behind helpers can produce false positives, so the UI labels every result STATIC.
 */
export function staticConcurrencyDiagnostics(source: string, relativePath: string): ConcurrencyDiagnostic[] {
  const code = codeOnly(source)
  const diagnostics: ConcurrencyDiagnostic[] = []
  const bodies = functionBodies(code)
  for (const body of bodies) {
    CONTEXT_CREATION.lastIndex = 0
    let context: RegExpExecArray | null
    while ((context = CONTEXT_CREATION.exec(body.text))) {
      const cancel = context[1]
      const invokesCancel = new RegExp(`\\b${escapePattern(cancel)}\\s*\\(`).test(body.text.slice(context.index + context[0].length))
      if (invokesCancel) continue
      const offset = body.start + context.index
      diagnostics.push({
        id: `static-context:${relativePath}:${offset}`,
        kind: 'leak', severity: 'warning', evidence: 'static',
        title: 'Context cancellation not observed',
        detail: `This function creates context.${context[2]} with ${cancel}, but no ${cancel}() call appears later in the same source function. Verify ownership or defer ${cancel}().`,
        goroutineIds: [], relativePath, line: lineAt(source, offset),
      })
    }

    TIMER_CREATION.lastIndex = 0
    let timer: RegExpExecArray | null
    while ((timer = TIMER_CREATION.exec(body.text))) {
      const name = timer[1]
      const stopsTimer = new RegExp(`\\b${escapePattern(name)}\\s*\\.\\s*Stop\\s*\\(`).test(body.text.slice(timer.index + timer[0].length))
      if (stopsTimer) continue
      const offset = body.start + timer.index
      diagnostics.push({
        id: `static-timer:${relativePath}:${offset}`,
        kind: 'leak', severity: 'warning', evidence: 'static',
        title: `${timer[2] === 'NewTicker' ? 'Ticker' : 'Timer'} stop not observed`,
        detail: `This function creates ${name} with time.${timer[2]}, but no ${name}.Stop() call appears later in the same source function. Verify ownership or defer ${name}.Stop().`,
        goroutineIds: [], relativePath, line: lineAt(source, offset),
      })
    }
  }
  const byDirection = new Map<string, LockEdge>()
  for (const body of bodies) for (const edge of lockEdges(body)) byDirection.set(`${edge.from}\u0000${edge.to}`, edge)
  const reported = new Set<string>()
  for (const edge of byDirection.values()) {
    const reverse = byDirection.get(`${edge.to}\u0000${edge.from}`)
    if (!reverse) continue
    const pair = [edge.from, edge.to].sort().join('\u0000')
    if (reported.has(pair)) continue
    reported.add(pair)
    diagnostics.push({
      id: `static-lock-order:${relativePath}:${edge.offset}:${reverse.offset}`,
      kind: 'mutex', severity: 'warning', evidence: 'static',
      title: 'Inconsistent lock order',
      detail: `${edge.functionName} acquires ${edge.from} → ${edge.to}, while ${reverse.functionName} acquires ${edge.to} → ${edge.from}. If both locks can be held concurrently, use one consistent order.`,
      goroutineIds: [], relativePath, line: lineAt(source, edge.offset),
    })
  }
  for (const body of goroutineBodies(code)) {
    const adds = /\b([\w.]+)\s*\.\s*Add\s*\(/g
    let add: RegExpExecArray | null
    while ((add = adds.exec(body.text))) {
      const offset = body.start + add.index
      diagnostics.push({
        id: `static-waitgroup-add:${relativePath}:${offset}`,
        kind: 'waitgroup', severity: 'warning', evidence: 'static',
        title: 'WaitGroup Add inside goroutine',
        detail: `${add[1]}.Add() runs inside a newly started goroutine. A concurrent Wait() can observe the counter before this Add; increment the WaitGroup before starting the goroutine.`,
        goroutineIds: [], relativePath, line: lineAt(source, offset),
      })
    }
  }
  return diagnostics
}
