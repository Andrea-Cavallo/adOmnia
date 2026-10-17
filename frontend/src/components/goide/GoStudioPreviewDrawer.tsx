import { useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, Info, Trash2, X } from 'lucide-react'
import { useGoIDEStore } from '@/stores/goide'
import { useLivePreviewStore } from '@/stores/livePreview'
import { extractBuildProblems, problemRelativePath, type BridgeLogEntry, type BuildProblem } from '@/lib/goide/livePreview'

type DrawerTab = 'console' | 'network' | 'problems'

interface DrawerProps {
  sessionId: string
  log: BridgeLogEntry[]
  /** Output del dev server (stdout/stderr): da qui si estraggono gli errori di compilazione cliccabili. */
  runId: string | null
  workingDirectory: string
  projectDirectory: string
  onClose: () => void
}

const TAB = 'flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px]'

/** Console, rete e problemi della pagina. Non è un debugger: ciò che il bridge nella pagina può riportare. */
export function GoStudioPreviewDrawer({ sessionId, log, runId, workingDirectory, projectDirectory, onClose }: DrawerProps) {
  const [tab, setTab] = useState<DrawerTab>('console')
  const clear = useLivePreviewStore((state) => state.clearLog)
  const chunks = useGoIDEStore((state) => (runId ? state.consoleByRun[runId] : undefined))
  const problems = useMemo(() => extractBuildProblems((chunks ?? []).slice(-300).map((chunk) => chunk.text).join('')), [chunks])
  const consoleEntries = log.filter((entry) => entry.message.type === 'console' || entry.message.type === 'error' || entry.message.type === 'asset-error')
  const networkEntries = log.filter((entry) => entry.message.type === 'network')
  const failed = networkEntries.filter((entry) => entry.message.type === 'network' && !entry.message.ok).length
  const errors = consoleEntries.filter((entry) => entry.message.type !== 'console' || entry.message.level === 'error').length

  return (
    <section aria-label="Preview console" className="flex h-44 min-h-0 shrink-0 flex-col border-t border-border-1 bg-surface-1">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border-1 px-2" role="tablist" aria-label="Preview diagnostics">
        <Tab id="console" current={tab} onSelect={setTab} label="Console" count={errors} danger />
        <Tab id="network" current={tab} onSelect={setTab} label="Network" count={failed} danger />
        <Tab id="problems" current={tab} onSelect={setTab} label="Build problems" count={problems.length} danger />
        <span className="ml-2 hidden truncate text-[10.5px] text-text-4 xl:inline" title="Console, errors and network are reported by adOmnia's preview bridge inside the page. Breakpoints and the DOM inspector need the CDP browser integration, which the embedded WebView does not expose.">Page bridge · no DevTools protocol in the embedded WebView</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => clear(sessionId)} className="go-studio-icon-button h-6 w-6" aria-label="Clear log" title="Clear log"><Trash2 size={12} /></button>
          <button type="button" onClick={onClose} className="go-studio-icon-button h-6 w-6" aria-label="Close console" title="Close console"><X size={12} /></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto font-mono text-[11.5px] leading-5" role="tabpanel">
        {tab === 'console' && <ConsoleList entries={consoleEntries} />}
        {tab === 'network' && <NetworkList entries={networkEntries} />}
        {tab === 'problems' && <ProblemList problems={problems} workingDirectory={workingDirectory} projectDirectory={projectDirectory} />}
      </div>
    </section>
  )
}

function Tab({ id, current, onSelect, label, count, danger }: { id: DrawerTab; current: DrawerTab; onSelect: (id: DrawerTab) => void; label: string; count: number; danger?: boolean }) {
  const selected = id === current
  return (
    <button type="button" role="tab" aria-selected={selected} onClick={() => onSelect(id)} className={`${TAB} ${selected ? 'bg-[var(--gs-raised)] text-text-1' : 'text-text-3 hover:bg-surface-3'}`}>
      {label}
      {count > 0 && <span className={`rounded-full px-1.5 text-[10px] font-semibold ${danger ? 'bg-danger/15 text-danger' : 'bg-surface-3 text-text-3'}`}>{count}</span>}
    </button>
  )
}

const EMPTY = 'px-3 py-2 font-sans text-text-4'

function ConsoleList({ entries }: { entries: BridgeLogEntry[] }) {
  if (!entries.length) return <p className={EMPTY}>Nothing logged yet. console.* calls, runtime errors and failed assets of the page appear here.</p>
  return (
    <ul>
      {entries.map((entry) => {
        const message = entry.message
        if (message.type === 'console') {
          const tone = message.level === 'error' ? 'text-danger' : message.level === 'warn' ? 'text-warning' : 'text-text-2'
          return <li key={entry.id} className={`flex gap-2 border-b border-border-1/40 px-3 ${tone}`}><Level level={message.level} /><span className="whitespace-pre-wrap break-all">{message.text}</span></li>
        }
        if (message.type === 'error') {
          return <li key={entry.id} className="flex gap-2 border-b border-border-1/40 px-3 text-danger"><AlertCircle size={12} className="mt-1 shrink-0" /><span className="whitespace-pre-wrap break-all">{message.message}{message.source ? ` (${shortSource(message.source)}${message.line ? `:${message.line}` : ''})` : ''}</span></li>
        }
        if (message.type === 'asset-error') {
          return <li key={entry.id} className="flex gap-2 border-b border-border-1/40 px-3 text-warning"><AlertTriangle size={12} className="mt-1 shrink-0" /><span className="break-all">Failed to load &lt;{message.tag}&gt; {message.url}</span></li>
        }
        return null
      })}
    </ul>
  )
}

function Level({ level }: { level: string }) {
  if (level === 'error') return <AlertCircle size={12} className="mt-1 shrink-0" aria-label="error" />
  if (level === 'warn') return <AlertTriangle size={12} className="mt-1 shrink-0" aria-label="warning" />
  return <Info size={12} className="mt-1 shrink-0 text-text-4" aria-label={level} />
}

function NetworkList({ entries }: { entries: BridgeLogEntry[] }) {
  if (!entries.length) return <p className={EMPTY}>No requests yet. fetch and XMLHttpRequest calls made by the page appear here with their HTTP status.</p>
  return (
    <table className="w-full table-fixed border-collapse text-left">
      <thead className="sticky top-0 bg-surface-1 font-sans text-[10.5px] uppercase tracking-wide text-text-4">
        <tr><th className="w-14 px-3 py-1 font-medium">Method</th><th className="w-14 py-1 font-medium">Status</th><th className="py-1 font-medium">URL</th><th className="w-16 px-3 py-1 text-right font-medium">Time</th></tr>
      </thead>
      <tbody>
        {entries.map((entry) => entry.message.type === 'network' && (
          <tr key={entry.id} className={`border-b border-border-1/40 ${entry.message.ok ? 'text-text-2' : 'text-danger'}`}>
            <td className="px-3">{entry.message.method}</td>
            <td>{entry.message.status || 'failed'}</td>
            <td className="truncate pr-2" title={entry.message.error ?? entry.message.url}>{entry.message.url}</td>
            <td className="px-3 text-right text-text-4">{entry.message.ms} ms</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ProblemList({ problems, workingDirectory, projectDirectory }: { problems: BuildProblem[]; workingDirectory: string; projectDirectory: string }) {
  const openLocation = useGoIDEStore((state) => state.openLocation)
  if (!problems.length) return <p className={EMPTY}>No build errors in the dev server output. Compile errors (Vite, TypeScript, CSS) show up here and open the file at the right line.</p>
  return (
    <ul>
      {problems.map((problem) => (
        <li key={`${problem.path}:${problem.line}:${problem.column}`}>
          <button type="button" onClick={() => void openLocation(problemRelativePath(problem.path, workingDirectory, projectDirectory), problem.line, problem.column)}
            className="flex w-full items-start gap-2 border-b border-border-1/40 px-3 py-0.5 text-left text-danger hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            <AlertCircle size={12} className="mt-1 shrink-0" aria-hidden="true" />
            <span className="min-w-0"><span className="text-text-1">{problem.path}:{problem.line}:{problem.column}</span> <span className="whitespace-pre-wrap break-words text-danger">{problem.message}</span></span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function shortSource(source: string): string {
  try {
    const url = new URL(source)
    return url.pathname.split('/').pop() || url.pathname
  } catch {
    return source
  }
}
