import { useMemo, useState } from 'react'
import { Copy, RefreshCw, Search, Square, TerminalSquare } from 'lucide-react'
import { Clipboard as WailsClipboard } from '@wailsio/runtime'
import { useGoIDEStore, type GoIDEConsoleChunk } from '@/stores/goide'
import type { GoIDEExecution } from '@/lib/goide-api'
import { resolveConsolePath } from './goStudioConsolePaths'

interface GoStudioRunPanelProps {
  sessionId: string
}

interface ParsedLine {
  text: string
  raw: string
  path?: string
  line?: number
  column?: number
  stream: GoIDEConsoleChunk['stream']
  sequence: number
}

const ansiPattern = /\x1b\[[0-?]*[ -/]*[@-~]/g
const locationPattern = /((?:[A-Za-z]:[\\/])?[^\s:]+\.go):(\d+)(?::(\d+))?/

function parseLines(chunks: GoIDEConsoleChunk[]): ParsedLine[] {
  const lines: ParsedLine[] = []
  for (const chunk of chunks) {
    for (const raw of chunk.text.split(/\r?\n/)) {
      if (!raw && chunk.text.endsWith('\n')) continue
      const text = raw.replace(ansiPattern, '')
      const match = text.match(locationPattern)
      lines.push({
        text,
        raw,
        stream: chunk.stream,
        sequence: chunk.sequence,
        path: match?.[1]?.replace(/\\/g, '/'),
        line: match ? Number(match[2]) : undefined,
        column: match?.[3] ? Number(match[3]) : 1,
      })
    }
  }
  return lines
}

function renderAnsi(raw: string) {
  const segments: Array<{ text: string; className: string }> = []
  const expression = /\x1b\[([0-9;]*)m/g
  let index = 0
  let className = ''
  for (const match of raw.matchAll(expression)) {
    const offset = match.index ?? 0
    if (offset > index) segments.push({ text: raw.slice(index, offset), className })
    for (const code of (match[1] || '0').split(';').map(Number)) {
      if (code === 0 || code === 39) className = ''
      else if (code === 1) className = `${className} font-semibold`.trim()
      else if (code === 31 || code === 91) className = 'text-danger'
      else if (code === 32 || code === 92) className = 'text-success'
      else if (code === 33 || code === 93) className = 'text-warning'
      else if ([34, 35, 36, 94, 95, 96].includes(code)) className = 'text-accent'
      else if (code === 90) className = 'text-text-4'
      else if (code === 37 || code === 97) className = 'text-text-1'
    }
    index = offset + match[0].length
  }
  if (index < raw.length) segments.push({ text: raw.slice(index), className })
  return segments.map((segment, segmentIndex) => <span key={segmentIndex} className={segment.className}>{segment.text}</span>)
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds} ms`
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)} s`
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1000)}s`
}

function executionDetails(execution: GoIDEExecution): string {
  const parts = [execution.status]
  if (execution.pid) parts.push(`PID ${execution.pid}`)
  if (execution.status !== 'running') {
    if (execution.exitCode !== undefined && execution.exitCode !== null) parts.push(`exit ${execution.exitCode}`)
    parts.push(formatDuration(execution.durationMillis))
  }
  return parts.join(' · ')
}

function statusClass(status: string): string {
  if (status === 'running') return 'text-success'
  if (status === 'failed') return 'text-danger'
  if (status === 'stopped') return 'text-warning'
  return 'text-text-3'
}

export function GoStudioRunPanel({ sessionId }: GoStudioRunPanelProps) {
  const [view, setView] = useState<'run' | 'problems'>('run')
  const [search, setSearch] = useState('')
  const [input, setInput] = useState('')
  const allExecutions = useGoIDEStore((state) => state.executions)
  const executions = useMemo(() => allExecutions.filter((execution) => execution.sessionId === sessionId), [allExecutions, sessionId])
  const activeRunId = useGoIDEStore((state) => state.activeRunBySession[sessionId] ?? null)
  const consoleByRun = useGoIDEStore((state) => state.consoleByRun)
  const stopRun = useGoIDEStore((state) => state.stopRun)
  const restartRun = useGoIDEStore((state) => state.restartRun)
  const sendRunInput = useGoIDEStore((state) => state.sendRunInput)
  const openLocation = useGoIDEStore((state) => state.openLocation)
  const active = executions.find((execution) => execution.id === activeRunId) ?? executions[executions.length - 1] ?? null
  const chunks = active ? consoleByRun[active.id] ?? [] : []
  const lines = useMemo(() => parseLines(chunks), [chunks])
  const problems = useMemo(() => lines.filter((line) => line.path && line.line), [lines])
  const visibleLines = (view === 'problems' ? problems : lines).filter((line) => !search || line.text.toLowerCase().includes(search.toLowerCase()))

  const submitInput = async () => {
    if (!active || !input) return
    await sendRunInput(active.id, `${input}\n`)
    setInput('')
  }

  return (
    <section aria-label="Go Studio run console" className="flex h-full min-h-0 flex-col bg-surface-1">
      <div className="flex h-8 shrink-0 items-center border-b border-border-1">
        <button type="button" onClick={() => setView('run')} className={`flex h-8 items-center gap-1.5 border-r border-border-1 px-3 text-[10px] font-semibold uppercase tracking-wider ${view === 'run' ? 'border-b border-b-accent text-text-1' : 'text-text-3'}`}><TerminalSquare size={11} /> Run</button>
        <button type="button" onClick={() => setView('problems')} className={`flex h-8 items-center gap-1.5 border-r border-border-1 px-3 text-[10px] font-semibold uppercase tracking-wider ${view === 'problems' ? 'border-b border-b-accent text-text-1' : 'text-text-3'}`}>Problems <span className={problems.length ? 'text-danger' : 'text-text-4'}>{problems.length}</span></button>
        {active && <>
          <select
            aria-label="Active run"
            value={active.id}
            onChange={(event) => useGoIDEStore.setState((state) => ({ activeRunBySession: { ...state.activeRunBySession, [sessionId]: event.target.value } }))}
            className="ml-2 h-6 max-w-52 rounded border border-border-1 bg-surface-2 px-1.5 text-[10px] text-text-2"
          >
            {executions.map((execution) => <option key={execution.id} value={execution.id}>{execution.kind} · {execution.id.slice(-6)} · {execution.status}</option>)}
          </select>
          <span className={`ml-2 text-[9px] ${statusClass(active.status)}`} title={`${active.command}\n${active.workingDirectory}`}>{executionDetails(active)}</span>
          {active.kind !== 'dependency' && <button type="button" onClick={() => void restartRun(active.id)} title="Restart" className="ml-1 grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1"><RefreshCw size={11} /></button>}
          <button type="button" onClick={() => void stopRun(active.id)} disabled={active.status !== 'running'} title="Stop process tree" className="grid h-6 w-6 place-items-center rounded text-danger hover:bg-danger/10 disabled:opacity-30"><Square size={10} fill="currentColor" /></button>
        </>}
        <label className="ml-auto mr-1 flex h-6 items-center gap-1 rounded border border-border-1 bg-surface-0 px-1.5 text-text-4 focus-within:border-accent">
          <Search size={10} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find output" className="w-28 bg-transparent text-[10px] text-text-2 outline-none" />
        </label>
        <button type="button" disabled={!chunks.length} onClick={() => void WailsClipboard.SetText(chunks.map((chunk) => chunk.text).join(''))} title="Copy console" className="mr-1 grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3 disabled:opacity-30"><Copy size={11} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-surface-0 px-3 py-2 font-mono text-[10px] leading-4">
        {!active && <p className="text-text-4">Build or run the active project to open a real console.</p>}
        {active && visibleLines.length === 0 && <p className="text-text-4">{view === 'problems' ? 'No compiler problems detected.' : 'Waiting for output…'}</p>}
        {visibleLines.map((line, index) => (
          <div key={`${line.sequence}-${index}`} className={`min-h-4 whitespace-pre-wrap break-all ${line.stream === 'stderr' ? 'text-danger' : line.stream === 'system' ? 'text-text-4' : 'text-text-2'}`}>
            {line.path && line.line ? (
              <button type="button" onClick={() => void openLocation(resolveConsolePath(line.path!, active?.workingDirectory ?? ''), line.line!, line.column)} className="text-left underline decoration-accent/40 underline-offset-2 hover:text-accent">{renderAnsi(line.raw)}</button>
            ) : renderAnsi(line.raw)}
          </div>
        ))}
      </div>
      {active?.status === 'running' && active.kind === 'run' && (
        <form onSubmit={(event) => { event.preventDefault(); void submitInput() }} className="flex h-8 shrink-0 items-center border-t border-border-1 bg-surface-1 px-2">
          <span className="mr-2 font-mono text-[10px] text-accent">stdin ›</span>
          <input value={input} onChange={(event) => setInput(event.target.value)} className="min-w-0 flex-1 bg-transparent font-mono text-[10px] text-text-1 outline-none" placeholder="Type input and press Enter" />
        </form>
      )}
    </section>
  )
}
