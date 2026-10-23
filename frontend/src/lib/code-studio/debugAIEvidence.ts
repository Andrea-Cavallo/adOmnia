import { getGoIDEAIPolicy, listGoIDEAIExcludedPaths } from '@/lib/code-studio-api'
import { getGoIDEDebugScopes, getGoIDEDebugVariables } from '@/lib/code-studio-debug-api'
import { getGoIDEChangedSymbols, getGoIDEFileAtRevision, getGoIDEFileHistory } from '@/lib/code-studio-vcs-api'
import { getOtlpLens, getOtlpTrace } from '@/lib/otlp-api'
import { traceIdFor } from '@/lib/devsession/traceparent'
import { getServerPort } from '@/lib/useServerPort'
import { useDevSessionStore } from '@/stores/devSession'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useCodeStudioDebugStore } from '@/stores/codeStudioDebug'
import type { DebugEvidence } from './debugAI'
import { runtimeByNode, runtimeText } from './runtimeLens'
import { graphImpactAt } from './workspaceGraph'

const PANIC_FRAME = /^runtime\.(gopanic|fatalpanic|panicmem|sigpanic)/
const SOURCE_WINDOW = 25

function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise.catch(() => fallback), new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))])
}

function window(source: string, line: number): string {
  const lines = source.split('\n')
  const start = Math.max(0, line - SOURCE_WINDOW)
  return lines.slice(start, Math.min(lines.length, line + SOURCE_WINDOW)).map((text, index) => `${start + index + 1}  ${text}`).join('\n')
}

/**
 * Everything adOmnia knows at a debugger stop, gathered for an AI draft. Every source is best
 * effort and time-bounded: a missing graph, trace or Git history leaves its section empty.
 */
export async function collectDebugEvidence(sessionId: string, debugId: string): Promise<DebugEvidence> {
  const view = useCodeStudioDebugStore.getState().debuggers[debugId]
  if (!view) throw new Error('The debug session has ended.')
  if (view.frames.length === 0) throw new Error('Pause the program first: the AI needs a stack to look at.')
  const policy = await getGoIDEAIPolicy(sessionId)
  if (policy !== 'allowed') throw new Error(policy === 'off' ? 'AI is turned off for this project.' : 'This project only allows local AI providers; milk and Copilot may use remote providers.')
  const projectFrames = view.frames.filter((frame) => frame.relativePath)
  const excluded = await listGoIDEAIExcludedPaths(sessionId, [...new Set(projectFrames.map((frame) => frame.relativePath!))], false)
  if (excluded.length) throw new Error(`The stack goes through files excluded from AI (${excluded.join(', ')}). Review it locally instead.`)
  const top = projectFrames[0] ?? view.frames[0]
  const file = top.relativePath ?? ''

  // Locals of the selected frame (or the top project frame).
  const frameId = view.frameId ?? top.id
  const scopes = view.scopes.length ? view.scopes : await within(getGoIDEDebugScopes(debugId, frameId), 3000, [])
  const locals: DebugEvidence['locals'] = []
  const scopeVariables = await Promise.all(
    scopes.filter((item) => !item.expensive && item.variablesReference > 0).slice(0, 2).map(
      (scope) => view.children[scope.variablesReference] ?? within(getGoIDEDebugVariables(debugId, scope.variablesReference), 3000, []),
    ),
  )
  for (const variables of scopeVariables) {
    locals.push(...variables.slice(0, 30).map((variable) => ({ name: variable.name, value: variable.value, type: variable.type })))
  }
  let panicValue: string | null = null
  const runtimeFrame = view.frames.find((frame) => PANIC_FRAME.test(frame.name))
  if (runtimeFrame) {
    for (const scope of await within(getGoIDEDebugScopes(debugId, runtimeFrame.id), 2000, [])) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- early exit on the first match, so scopes are probed one at a time
      const value = (await within(getGoIDEDebugVariables(debugId, scope.variablesReference), 2000, [])).find((variable) => /^(?:e|panic|value|err)$/i.test(variable.name))
      if (value) { panicValue = `${value.value}${value.type ? ` (${value.type})` : ''}`; break }
    }
  }

  const overview = view.goroutines
  const byState: Record<string, number> = {}
  for (const goroutine of overview?.goroutines ?? []) byState[goroutine.state] = (byState[goroutine.state] ?? 0) + 1
  const blocked = (overview?.goroutines ?? []).filter((goroutine) => goroutine.blockedOn || /chan|select|mutex|lock|sleep|wait/i.test(goroutine.state))
    .map((goroutine) => `#${goroutine.id} ${goroutine.state}${goroutine.blockedOn ? ` on ${goroutine.blockedOn}` : ''}${goroutine.location ? ` at ${goroutine.location.relativePath}:${goroutine.location.line}` : ''}`)

  // The live session of this debugger: its in-flight request and recent logs.
  const live = useDevSessionStore.getState()
  const liveId = `debug:${debugId}`
  const runs = live.runOrder.map((id) => live.runs[id]).filter((run) => run?.sessionId === liveId)
  const run = runs[runs.length - 1] ?? null
  const logs = (live.logs[liveId] ?? []).slice(-20).map((entry) => entry.text.slice(0, 300))

  const port = await getServerPort()
  const traceSpans = run && port ? await within(getOtlpTrace(port, traceIdFor(run.correlationId)), 2000, []) : []
  const spans = (traceSpans ?? []).slice(0, 20).map((span) => `${span.service} ${span.kind} ${span.name} ${span.durationMs.toFixed(1)} ms${span.statusCode === 'ERROR' ? ` ERROR ${span.statusMessage ?? ''}` : ''}`)
  const [graph, changed, history, previous, lens] = await Promise.all([
    file ? within(graphImpactAt(sessionId, file, top.line), 4000, null) : Promise.resolve(null),
    within(getGoIDEChangedSymbols(sessionId), 3000, []),
    file ? within(getGoIDEFileHistory(sessionId, file), 3000, []) : Promise.resolve([]),
    file ? within(getGoIDEFileAtRevision(sessionId, file, 'HEAD'), 3000, '') : Promise.resolve(''),
    port ? within(getOtlpLens(port), 1500, []) : Promise.resolve([]),
  ])
  const session = useCodeStudioStore.getState().sessions.find((item) => item.id === sessionId)
  const document = useCodeStudioStore.getState().documents.find((item) => item.document.sessionId === sessionId && item.document.relativePath === file)
  const runtime = graph && session
    ? [...runtimeByNode(lens ?? [], session.project.rootPath, [graph.target, ...(graph.callers ?? []).map((ref) => ref.node)]).entries()]
        .map(([id, value]) => `${id === graph.target.id ? graph.target.label : (graph.callers ?? []).find((ref) => ref.node.id === id)?.node.label}: ${runtimeText(value)}`)
    : []

  return {
    stopReason: view.info.stopReason ?? '',
    frames: view.frames.slice(0, 25).map((frame) => ({ name: frame.name, location: frame.relativePath ? `${frame.relativePath}:${frame.line}` : frame.path ? `${frame.path}:${frame.line}` : '(no source)' })),
    locals,
    goroutines: overview ? { total: overview.goroutines.length, byState, blocked } : null,
    console: view.console.slice(-20).map((line) => line.text.trimEnd()).filter(Boolean),
    logs,
    request: run ? { method: run.method, url: run.url, status: run.status, durationMs: run.durationMs, error: run.error } : null,
    spans,
    changedSymbols: (changed ?? []).slice(0, 20).map((symbol) => `${symbol.change} ${symbol.kind} ${symbol.name} (${symbol.relativePath}:${symbol.line})`),
    tests: (graph?.tests ?? []).slice(0, 12).map((ref) => ref.node.label),
    related: graph ? [...(graph.callers ?? []).slice(0, 8).map((ref) => `caller ${ref.node.label}`), ...(graph.callees ?? []).slice(0, 7).map((ref) => `calls ${ref.node.label}`)] : [],
    runtime,
    history: (history ?? []).slice(0, 8).map((commit) => `${commit.hash} ${commit.date} ${commit.author}: ${commit.message.split('\n')[0]}`),
    previousSource: previous ? window(previous, top.line) : null,
    currentSource: document ? window(document.buffer, top.line) : null,
    panicValue,
  }
}
