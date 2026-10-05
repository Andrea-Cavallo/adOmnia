import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bug, Copy, FileCode2, History, Loader2, Play, RefreshCw, Repeat, Sparkles, Trash2, Upload } from 'lucide-react'
import { Clipboard as WailsClipboard } from '@wailsio/runtime'
import {
  deleteGoIDEFuzzInput, listGoIDEFuzzTargets, promoteGoIDEFuzzInput, readGoIDEFuzzInput,
  type GoIDEFuzzInput, type GoIDEFuzzInputContent, type GoIDEFuzzSource, type GoIDEFuzzTarget, type GoIDESession,
} from '@/lib/goide-api'
import { clearFuzzSessions, groupFuzzCrashes, loadFuzzSessions, type GoStudioFuzzSession } from '@/lib/goide/goStudioFuzzSessions'
import { formatDuration } from '@/lib/goide/goStudioTestTree'
import { useGoIDEStore } from '@/stores/goide'
import { fuzzReplayRequestForTarget, fuzzRunRequestForTarget } from './goStudioQuickActions'

type FuzzTab = 'corpus' | 'crashes' | 'sessions'
interface Selection { source: GoIDEFuzzSource; name: string }

const DURATIONS = [['10s', '10 s'], ['30s', '30 s'], ['1m', '1 min'], ['5m', '5 min'], ['15m', '15 min'], ['', 'Until stopped']] as const
const WORKERS = [0, 1, 2, 4, 8, 16]
const BUTTON = 'flex h-6 items-center gap-1 rounded px-1.5 text-[11px] disabled:opacity-30'

function errorText(problem: unknown): string {
  return problem instanceof Error ? problem.message : String(problem)
}

function targetKey(target: GoIDEFuzzTarget): string {
  return `${target.packageDir}\u0000${target.name}`
}

function runTarget(target: GoIDEFuzzTarget) {
  return { line: target.line, kind: 'fuzz' as const, name: target.name, packagePath: target.packageDir === '.' ? '.' : `./${target.packageDir}` }
}

/** f.Add(...) con gli stessi valori: l'input diventa un seed esplicito nel codice. */
export function fuzzSeedCall(content: GoIDEFuzzInputContent): string {
  return `f.Add(${content.values.map((value) => value.expression).join(', ')})`
}

/** Fuzzing Studio: target, corpus (seed e generato), crash deduplicati e storico delle sessioni. */
export function GoStudioFuzzPanel({ session }: { session: GoIDESession }) {
  const sessionId = session.id
  const projectRoot = session.project.realPath
  const authorized = session.project.authorization === 'tooling-permitted'
  const [targets, setTargets] = useState<GoIDEFuzzTarget[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState('')
  const [tab, setTab] = useState<FuzzTab>('corpus')
  const [selection, setSelection] = useState<Selection | null>(null)
  const [content, setContent] = useState<GoIDEFuzzInputContent | null>(null)
  const [duration, setDuration] = useState<string>('30s')
  const [workers, setWorkers] = useState(0)
  const [sessions, setSessions] = useState<GoStudioFuzzSession[]>(() => loadFuzzSessions(projectRoot))
  const finishedRuns = useGoIDEStore((state) => state.executions.filter((item) => item.sessionId === sessionId && item.status !== 'running').length)
  const startRun = useGoIDEStore((state) => state.startRun)
  const openLocation = useGoIDEStore((state) => state.openLocation)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const found = await listGoIDEFuzzTargets(sessionId)
      setTargets(found)
      setActiveKey((current) => found.some((item) => targetKey(item) === current) ? current : found[0] ? targetKey(found[0]) : '')
      setError(null)
    } catch (problem) {
      setError(errorText(problem))
    } finally {
      setLoading(false)
    }
    setSessions(loadFuzzSessions(projectRoot))
  }, [projectRoot, sessionId])
  // Una run finita può aver scritto un crash in testdata o nuovo corpus nella cache.
  useEffect(() => { void refresh() }, [refresh, finishedRuns])

  const target = targets.find((item) => targetKey(item) === activeKey) ?? null
  const targetSessions = useMemo(() => sessions.filter((item) => item.target === target?.name), [sessions, target?.name])
  const crashes = useMemo(() => groupFuzzCrashes(targetSessions), [targetSessions])

  useEffect(() => {
    setContent(null)
    if (!target || !selection) return
    let cancelled = false
    void readGoIDEFuzzInput(sessionId, target, selection.source, selection.name)
      .then((value) => { if (!cancelled) setContent(value) })
      .catch((problem) => { if (!cancelled) setContent({ values: [], raw: '', error: errorText(problem) }) })
    return () => { cancelled = true }
  }, [selection, sessionId, target])

  const act = async (action: () => Promise<unknown>) => {
    try { await action(); setError(null) } catch (problem) { setError(errorText(problem)) }
    await refresh()
  }
  const fuzz = () => target && void startRun('test', fuzzRunRequestForTarget(session, runTarget(target), duration, workers))
  const replay = (name?: string) => target && void startRun('test', fuzzReplayRequestForTarget(session, runTarget(target), name))

  if (!targets.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-[11px] text-text-3">
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Bug size={18} className="text-text-4" aria-hidden="true" />}
        <p>{loading ? 'Looking for fuzz targets…' : error ?? 'No fuzz targets. Add a func FuzzXxx(f *testing.F) to a _test.go file (Code → Generate → Fuzz test).'}</p>
        {!loading && <button type="button" onClick={() => void refresh()} className={`${BUTTON} text-accent hover:bg-accent/10`}><RefreshCw size={11} aria-hidden="true" /> Refresh</button>}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-[11px]">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border-1 px-2 py-1">
        <select aria-label="Fuzz target" value={activeKey} onChange={(event) => { setActiveKey(event.target.value); setSelection(null) }} className="h-6 max-w-[18rem] rounded border border-border-1 bg-surface-2 px-1 font-mono text-text-1">
          {targets.map((item) => <option key={targetKey(item)} value={targetKey(item)}>{item.name} · {item.packageDir}</option>)}
        </select>
        <select aria-label="Fuzz duration" value={duration} onChange={(event) => setDuration(event.target.value)} title="-fuzztime" className="h-6 rounded border border-border-1 bg-surface-2 px-1 text-text-1">
          {DURATIONS.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
        </select>
        <select aria-label="Fuzz workers" value={workers} onChange={(event) => setWorkers(Number(event.target.value))} title="-parallel: fuzzing workers (Auto = GOMAXPROCS)" className="h-6 rounded border border-border-1 bg-surface-2 px-1 text-text-1">
          {WORKERS.map((value) => <option key={value} value={value}>{value ? `${value} worker${value === 1 ? '' : 's'}` : 'Auto workers'}</option>)}
        </select>
        <button type="button" disabled={!authorized || !target} onClick={fuzz} title={authorized ? 'Start go test -fuzz for this target' : 'Trust the project to run tools'} className={`${BUTTON} bg-accent font-semibold text-white hover:opacity-90`}><Play size={11} aria-hidden="true" /> Fuzz</button>
        <button type="button" disabled={!authorized || !target} onClick={() => replay()} title="Run the target on every input in testdata/fuzz, without fuzzing" className={`${BUTTON} text-accent hover:bg-accent/10`}><Repeat size={11} aria-hidden="true" /> Replay corpus</button>
        {target && <button type="button" onClick={() => void openLocation(target.file, target.line, 1)} title={`${target.file}:${target.line}`} className={`${BUTTON} text-text-3 hover:bg-surface-3 hover:text-text-1`}><FileCode2 size={11} aria-hidden="true" /> Source</button>}
        <button type="button" onClick={() => void refresh()} title="Rescan targets and corpus" className={`${BUTTON} ml-auto text-text-3 hover:bg-surface-3 hover:text-text-1`}>{loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} aria-hidden="true" />}</button>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border-1 px-2" role="tablist">
        {([['corpus', `Corpus (${(target?.seeds.length ?? 0) + (target?.cachedTotal ?? 0)})`], ['crashes', `Crashes (${crashes.length})`], ['sessions', `Sessions (${targetSessions.length})`]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`border-b-2 px-2 py-1 ${tab === id ? 'border-accent text-text-1' : 'border-transparent text-text-3 hover:text-text-1'}`}>{label}</button>
        ))}
      </div>
      {error && <div className="shrink-0 border-b border-danger/30 bg-danger/10 px-2 py-1 text-danger">{error}</div>}
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 w-1/2 min-w-[14rem] overflow-auto border-r border-border-1">
          {target && tab === 'corpus' && <CorpusList target={target} selection={selection} onSelect={setSelection} />}
          {tab === 'crashes' && <CrashList groups={crashes} onSelect={(file) => setSelection({ source: 'testdata', name: file.split('/').pop() ?? file })} />}
          {tab === 'sessions' && <SessionList sessions={targetSessions} onClear={() => { clearFuzzSessions(projectRoot); setSessions([]) }} />}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {target && selection ? (
            <InputViewer
              selection={selection}
              content={content}
              authorized={authorized}
              onReplay={() => replay(selection.name)}
              onPromote={() => void act(async () => { const path = await promoteGoIDEFuzzInput(sessionId, target, selection.name); setSelection({ source: 'testdata', name: selection.name }); return path })}
              onDelete={() => void act(async () => { await deleteGoIDEFuzzInput(sessionId, target, selection.source, selection.name); setSelection(null) })}
              onOpen={() => void openLocation(`${target.packageDir === '.' ? '' : `${target.packageDir}/`}testdata/fuzz/${target.name}/${selection.name}`, 1, 1)}
            />
          ) : <p className="text-text-4">Select an input to see its values. Inputs in testdata/fuzz run on every go test as regression cases.</p>}
        </div>
      </div>
    </div>
  )
}

function InputRow({ input, active, onSelect }: { input: GoIDEFuzzInput; active: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} className={`flex w-full items-center gap-2 px-2 py-0.5 text-left ${active ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-3'}`}>
      <span className="min-w-0 flex-1 truncate font-mono">{input.name}</span>
      {input.duplicate && <span className="shrink-0 rounded bg-surface-3 px-1 text-[9px] text-text-4" title={`Same content as ${input.duplicate}`}>dup</span>}
      <span className="shrink-0 text-[10px] text-text-4">{input.size} B · {new Date(input.modified).toLocaleString()}</span>
    </button>
  )
}

function CorpusList({ target, selection, onSelect }: { target: GoIDEFuzzTarget; selection: Selection | null; onSelect: (selection: Selection) => void }) {
  return (
    <div className="py-1">
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-4" title="testdata/fuzz: committed with the code and run by every go test">Seeds and failures · testdata ({target.seeds.length})</div>
      {target.seeds.length ? target.seeds.map((input) => <InputRow key={input.name} input={input} active={selection?.source === 'testdata' && selection.name === input.name} onSelect={() => onSelect({ source: 'testdata', name: input.name })} />) : <p className="px-2 text-text-4">No inputs yet: failing inputs land here.</p>}
      <div className="mt-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-4" title={target.cacheDir ?? ''}>Generated · Go cache ({target.cachedTotal}{target.cachedTotal > target.cached.length ? `, newest ${target.cached.length}` : ''})</div>
      {target.cached.length ? target.cached.map((input) => <InputRow key={input.name} input={input} active={selection?.source === 'cache' && selection.name === input.name} onSelect={() => onSelect({ source: 'cache', name: input.name })} />) : <p className="px-2 text-text-4">{target.cacheDir ? 'Empty: fuzzing adds interesting inputs here.' : 'No module path: the Go cache corpus cannot be located.'}</p>}
    </div>
  )
}

function CrashList({ groups, onSelect }: { groups: ReturnType<typeof groupFuzzCrashes>; onSelect: (file: string) => void }) {
  if (!groups.length) return <p className="p-2 text-text-4">No crashes recorded for this target. Crashes found by Fuzz appear here, grouped by failure.</p>
  return (
    <ul className="py-1">
      {groups.map((group) => (
        <li key={`${group.target}:${group.signature}`}>
          <button type="button" disabled={!group.latest.crashFile} onClick={() => group.latest.crashFile && onSelect(group.latest.crashFile)} className="block w-full px-2 py-1 text-left hover:bg-surface-3 disabled:cursor-default">
            <div className="flex items-center gap-2">
              <Bug size={11} className="shrink-0 text-danger" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-text-1" title={group.latest.failure ?? ''}>{group.latest.failure ?? 'Failure without message'}</span>
              {group.count > 1 && <span className="shrink-0 rounded bg-danger/15 px-1 text-[10px] text-danger" title="Sessions that hit the same failure">×{group.count}</span>}
            </div>
            <div className="mt-0.5 flex gap-2 pl-5 text-[10px] text-text-4">
              <span>{new Date(group.latest.startedAt).toLocaleString()}</span>
              {group.latest.minimized && <span className="text-success" title="go test minimized the failing input before saving it">minimized</span>}
              {group.latest.crashFile && <span className="truncate font-mono">{group.latest.crashFile}</span>}
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}

function SessionList({ sessions, onClear }: { sessions: GoStudioFuzzSession[]; onClear: () => void }) {
  if (!sessions.length) return <p className="p-2 text-text-4">No fuzz sessions yet. Each finished Fuzz run is recorded here with its throughput and result.</p>
  return (
    <div className="py-1">
      <div className="flex justify-end px-2"><button type="button" onClick={onClear} className={`${BUTTON} text-text-3 hover:bg-surface-3 hover:text-danger`}><Trash2 size={10} aria-hidden="true" /> Clear history</button></div>
      {sessions.map((item) => (
        <div key={item.id} className="border-b border-border-1 px-2 py-1">
          <div className="flex items-center gap-2">
            <History size={11} className="shrink-0 text-text-4" aria-hidden="true" />
            <span className="text-text-2">{new Date(item.startedAt).toLocaleString()}</span>
            <span className={item.status === 'crashed' ? 'font-semibold text-danger' : item.status === 'exited' ? 'text-success' : 'text-text-3'}>{item.status === 'exited' ? 'no failure' : item.status}</span>
            <span className="ml-auto text-text-4">{formatDuration(item.durationMillis)}</span>
          </div>
          <div className="mt-0.5 pl-5 font-mono text-[10px] text-text-4">
            {item.execs !== null ? `${item.execs.toLocaleString()} execs · ${item.execsPerSecond?.toLocaleString()}/s · +${item.newInteresting} interesting · corpus ${item.corpusTotal}` : 'no fuzzing statistics'}{item.workers ? ` · ${item.workers} workers` : ''}
          </div>
        </div>
      ))}
    </div>
  )
}

interface InputViewerProps {
  selection: Selection
  content: GoIDEFuzzInputContent | null
  authorized: boolean
  onReplay: () => void
  onPromote: () => void
  onDelete: () => void
  onOpen: () => void
}

function InputViewer({ selection, content, authorized, onReplay, onPromote, onDelete, onOpen }: InputViewerProps) {
  const inTestdata = selection.source === 'testdata'
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <span className="mr-1 truncate font-mono text-text-1">{selection.name}</span>
        <span className="rounded bg-surface-3 px-1 text-[10px] text-text-3">{inTestdata ? 'testdata' : 'Go cache'}</span>
        <span className="ml-auto" />
        {inTestdata && <button type="button" disabled={!authorized} onClick={onReplay} title="Run the target on this input only" className={`${BUTTON} text-accent hover:bg-accent/10`}><Repeat size={11} aria-hidden="true" /> Replay</button>}
        {!inTestdata && <button type="button" disabled={!authorized} onClick={onPromote} title="Copy into testdata/fuzz: go test then runs it as a regression case" className={`${BUTTON} text-accent hover:bg-accent/10`}><Upload size={11} aria-hidden="true" /> Promote to test</button>}
        <button type="button" disabled={!content?.values.length} onClick={() => content && void WailsClipboard.SetText(fuzzSeedCall(content))} title="Copy as an f.Add(...) seed for the fuzz function" className={`${BUTTON} text-text-3 hover:bg-surface-3 hover:text-text-1`}><Sparkles size={11} aria-hidden="true" /> Copy f.Add</button>
        <button type="button" disabled={!content} onClick={() => content && void WailsClipboard.SetText(content.raw)} title="Copy the corpus file" className={`${BUTTON} text-text-3 hover:bg-surface-3 hover:text-text-1`}><Copy size={11} aria-hidden="true" /></button>
        {inTestdata && <button type="button" onClick={onOpen} title="Open the file in the editor" className={`${BUTTON} text-text-3 hover:bg-surface-3 hover:text-text-1`}><FileCode2 size={11} aria-hidden="true" /></button>}
        <button type="button" disabled={!authorized} onClick={onDelete} title="Delete this input" className={`${BUTTON} text-text-3 hover:bg-surface-3 hover:text-danger`}><Trash2 size={11} aria-hidden="true" /></button>
      </div>
      {!content ? <Loader2 size={12} className="animate-spin text-text-4" /> : content.error ? <p className="text-danger">{content.error}</p> : (
        <table className="w-full border-collapse font-mono text-[10.5px]">
          <thead><tr className="text-left text-[10px] text-text-4"><th className="w-8 py-0.5 font-normal">#</th><th className="w-24 font-normal">Type</th><th className="font-normal">Value</th></tr></thead>
          <tbody>
            {content.values.map((value, index) => (
              <tr key={index} className="border-t border-border-1 align-top">
                <td className="py-0.5 text-text-4">{index + 1}</td>
                <td className="text-accent">{value.type}</td>
                <td className="break-all text-text-1">{value.literal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
