import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, Crosshair, Flame, GitCompare, Layers, ListTree, Loader2, RefreshCw, Search } from 'lucide-react'
import { useGoIDEStore } from '@/stores/goide'
import { listGoIDEProfileFiles, loadGoIDEProfile, type GoIDEProfileFile, type GoIDEProfileReport } from '@/lib/goide-api'
import type { GoIDESession } from '@/lib/goide-api'
import {
  defaultSampleIndex, diffProfiles, matchingSampleIndex, filterNodes, formatProfilePercent, formatProfileValue, groupByPackage,
  sampleValue, shortFunctionName, sortTop, type ProfileFlame, type ProfileFunction, type ProfileNode,
} from './goStudioProfiles'

interface GoStudioProfilePanelProps {
  session: GoIDESession
}

type ProfileTab = 'top' | 'flame' | 'callers' | 'diff'
type TopMode = 'flat' | 'cum'

const TABS: Array<{ id: ProfileTab; label: string; icon: typeof Flame }> = [
  { id: 'top', label: 'Top functions', icon: ListTree },
  { id: 'flame', label: 'Flame graph', icon: Flame },
  { id: 'callers', label: 'Callers', icon: Crosshair },
  { id: 'diff', label: 'Diff', icon: GitCompare },
]

/** Apre il sorgente di una funzione: relativo al progetto, oppure esterno (stdlib) per i file .go. */
function openFunction(fn: ProfileFunction): void {
  const store = useGoIDEStore.getState()
  if (fn.relative) void store.openLocation(fn.relative, fn.line || 1)
  else if (fn.file && fn.file.endsWith('.go')) void store.openExternalLocation(fn.file, fn.line || 1)
}

interface FlameFrame {
  key: string
  node: ProfileFlame
  x: number
  width: number
  depth: number
}

const FLAME_ROW = 20

/** Dispone l'albero in coordinate frazionarie [0,1]: i figli riempiono il rettangolo del genitore. */
function layoutFlame(root: ProfileFlame | null, total: number, index: number): { frames: FlameFrame[]; maxDepth: number } {
  const frames: FlameFrame[] = []
  let maxDepth = 0
  if (!root || total <= 0) return { frames, maxDepth }
  const walk = (node: ProfileFlame, x: number, depth: number) => {
    if (frames.length >= 20000 || depth > 300) return
    const value = sampleValue(node.value, index)
    if (value <= 0) return
    const width = value / total
    frames.push({ key: `${depth}:${x.toFixed(6)}:${node.function.name}`, node, x, width, depth })
    maxDepth = Math.max(maxDepth, depth)
    let offset = x
    for (const child of node.children ?? []) {
      if (!child) continue
      const childValue = sampleValue(child.value, index)
      if (childValue <= 0) continue
      walk(child, offset, depth + 1)
      offset += childValue / total
    }
  }
  for (const child of root.children ?? []) {
    if (!child) continue
    const childValue = sampleValue(child.value, index)
    if (childValue <= 0) continue
    walk(child, 0, 0)
  }
  return { frames, maxDepth }
}

function ValueBar({ value, total }: { value: number; total: number }) {
  const percent = total > 0 ? Math.min(100, (value / total) * 100) : 0
  return (
    <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
      <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${percent}%` }} />
    </span>
  )
}

function TopRow({ node, index, mode, total, unit, selected, onSelect }: {
  node: ProfileNode
  index: number
  mode: TopMode
  total: number
  unit: string
  selected: string | null
  onSelect: (fn: ProfileFunction) => void
}) {
  const value = sampleValue(mode === 'flat' ? node.flat : node.cum, index)
  const active = selected === node.function.name
  return (
    <div
      role="row"
      tabIndex={0}
      onClick={() => onSelect(node.function)}
      onKeyDown={(event) => { if (event.key === 'Enter') onSelect(node.function) }}
      className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border-1/60 px-3 py-1 ${active ? 'bg-accent/10' : 'hover:bg-surface-2/60'}`}
    >
      <div className="min-w-0">
        <div className="truncate font-mono text-[12px] text-text-1" title={node.function.name}>{shortFunctionName(node.function)}</div>
        <div className="truncate text-[11px] text-text-4" title={node.function.name}>{node.function.package || '(unknown)'}{node.function.runtime ? ' · runtime' : ''}</div>
      </div>
      <span className="text-right font-mono text-[11.5px] tabular-nums text-text-2">{formatProfileValue(value, unit)}</span>
      <span className="flex w-32 items-center justify-end gap-2">
        <ValueBar value={value} total={total} />
        <span className="w-12 text-right font-mono text-[11px] tabular-nums text-text-3">{formatProfilePercent(value, total)}</span>
        {node.function.relative || node.function.file?.endsWith('.go') ? (
          <button
            type="button"
            title="Open source"
            onClick={(event) => { event.stopPropagation(); openFunction(node.function) }}
            className="rounded p-0.5 text-text-4 hover:text-accent"
          >
            <Crosshair size={12} />
          </button>
        ) : <span className="w-[16px]" />}
      </span>
    </div>
  )
}

/** Performance Studio: profili pprof del progetto con Top, flame graph, call graph e diff. */
export function GoStudioProfilePanel({ session }: GoStudioProfilePanelProps) {
  const sessionId = session.id
  const [files, setFiles] = useState<GoIDEProfileFile[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [selectedPath, setSelectedPath] = useState('')
  const [report, setReport] = useState<GoIDEProfileReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<ProfileTab>('top')
  const [mode, setMode] = useState<TopMode>('cum')
  const [sampleIndex, setSampleIndex] = useState(0)
  const [search, setSearch] = useState('')
  const [hideRuntime, setHideRuntime] = useState(false)
  const [grouped, setGrouped] = useState(false)
  const [flameDown, setFlameDown] = useState(false)
  const [selectedFunction, setSelectedFunction] = useState<ProfileFunction | null>(null)
  const [diffPath, setDiffPath] = useState('')
  const [diffReport, setDiffReport] = useState<GoIDEProfileReport | null>(null)

  const refresh = useCallback(async () => {
    setFilesLoading(true)
    try {
      const found = await listGoIDEProfileFiles(sessionId)
      setFiles(found)
      setError(null)
      setSelectedPath((current) => current || found[0]?.relative || '')
      // Rilegge anche il profilo già aperto: senza questo il pulsante Refresh sembra non fare nulla.
      setReloadToken((token) => token + 1)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Impossibile elencare i profili')
    } finally {
      setFilesLoading(false)
    }
  }, [sessionId])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!selectedPath) { setReport(null); return }
      setReportLoading(true)
      try {
        const loaded = await loadGoIDEProfile(sessionId, selectedPath)
        if (cancelled) return
        setReport(loaded)
        setSampleIndex(defaultSampleIndex(loaded))
        setSelectedFunction(null)
        setDiffPath('')
        setDiffReport(null)
        setError(null)
      } catch (problem) {
        if (!cancelled) { setReport(null); setError(problem instanceof Error ? problem.message : 'Caricamento del profilo fallito') }
      } finally {
        if (!cancelled) setReportLoading(false)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [sessionId, selectedPath, reloadToken])

  useEffect(() => {
    let cancelled = false
    if (!diffPath || diffPath === selectedPath) { setDiffReport(null); return }
    loadGoIDEProfile(sessionId, diffPath)
      .then((loaded) => { if (!cancelled) setDiffReport(loaded) })
      .catch(() => { if (!cancelled) setDiffReport(null) })
    return () => { cancelled = true }
  }, [sessionId, diffPath, selectedPath])

  const total = report ? sampleValue(report.totals, sampleIndex) : 0
  const unit = report?.sampleTypes[sampleIndex]?.unit ?? ''
  const topNodes = useMemo(() => {
    if (!report) return []
    return sortTop(filterNodes(report.topFlat, { query: search, hideRuntime, index: sampleIndex }), sampleIndex, mode)
  }, [report, search, hideRuntime, sampleIndex, mode])
  const topGroups = useMemo(() => groupByPackage(topNodes, sampleIndex, mode), [topNodes, sampleIndex, mode])
  const flame = useMemo(() => layoutFlame(report?.flame ?? null, total, sampleIndex), [report, total, sampleIndex])
  const selectedName = selectedFunction?.name ?? ''
  const callers = useMemo(() => report?.edges.filter((edge) => edge.callee.name === selectedName) ?? [], [report, selectedName])
  const callees = useMemo(() => report?.edges.filter((edge) => edge.caller.name === selectedName) ?? [], [report, selectedName])
  const topEdges = useMemo(() => (report?.edges ?? []).slice(0, 200), [report])
  const deltas = useMemo(() => (report && diffReport ? diffProfiles(report, diffReport, sampleIndex, mode) : []), [report, diffReport, sampleIndex, mode])

  if (!session.project.authorization) {
    return <p className="p-4 text-[12px] text-text-4">Trust the project to inspect its profiles.</p>
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="go-studio-tool-header flex-wrap gap-2">
        <span className="go-studio-tool-title">Performance</span>
        <select
          aria-label="Profile file"
          value={selectedPath}
          onChange={(event) => setSelectedPath(event.target.value)}
          className="h-7 max-w-72 rounded-lg border-0 bg-[var(--gs-raised)] px-2 font-mono text-[11.5px] text-text-1 outline-none focus:ring-1 focus:ring-accent"
        >
          {files.length === 0 && <option value="">No .pprof in the project</option>}
          {files.map((file) => <option key={file.relative} value={file.relative}>{file.kind} · {file.relative}</option>)}
        </select>
        {report && (
          <select
            aria-label="Sample type"
            value={sampleIndex}
            onChange={(event) => setSampleIndex(Number(event.target.value))}
            className="h-7 rounded-lg border-0 bg-[var(--gs-raised)] px-2 text-[11.5px] text-text-2 outline-none focus:ring-1 focus:ring-accent"
          >
            {report.sampleTypes.map((type, index) => <option key={`${type.name}-${index}`} value={index}>{type.name}</option>)}
          </select>
        )}
        <label className="flex h-7 w-52 items-center gap-2 rounded-lg bg-[var(--gs-ground)] px-2.5 text-text-4 focus-within:ring-1 focus-within:ring-accent">
          <Search size={12} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search function" aria-label="Search function" className="min-w-0 flex-1 bg-transparent text-[11.5px] text-text-2 outline-none" />
        </label>
        <label className="flex items-center gap-1.5 text-[11.5px] text-text-3"><input type="checkbox" checked={hideRuntime} onChange={(event) => setHideRuntime(event.target.checked)} className="h-[14px] w-[14px] accent-[var(--color-accent)]" />Hide runtime</label>
        <button type="button" onClick={() => void refresh()} aria-label="Refresh profiles" title="Refresh" className="go-studio-icon-button h-7 w-7"><RefreshCw size={13} className={filesLoading ? 'animate-spin' : ''} /></button>
        {reportLoading && <Loader2 size={14} className="animate-spin text-accent" aria-label="Loading profile" />}
      </div>

      {error && <p className="border-b border-danger/30 bg-danger/10 px-3 py-1 text-[11.5px] text-danger">{error}</p>}

      {!report && !reportLoading && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-text-4">
          <Flame size={22} />
          <p className="text-[12.5px]">No profile loaded. Run a test with CPU, Memory, Block, Mutex or Trace profiling, then pick the generated <span className="font-mono">.pprof</span> here.</p>
        </div>
      )}

      {report && (
        <>
          <div className="flex items-center gap-1 border-b border-border-1 px-2 pt-0.5">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 rounded-t-md px-2.5 py-1 text-[11.5px] ${tab === id ? 'bg-surface-2 text-text-1' : 'text-text-3 hover:text-text-1'}`}
              >
                <Icon size={12} />{label}
              </button>
            ))}
            <span className="ml-auto pr-2 text-[11px] text-text-4">{report.samples} samples · {report.kind}{report.time ? ` · ${report.time}` : ''}</span>
          </div>

          {tab === 'top' && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-3 border-b border-border-1 px-3 py-1 text-[11.5px] text-text-3">
                <span className="flex items-center gap-1">
                  <button type="button" onClick={() => setMode('flat')} className={`rounded px-1.5 py-0.5 ${mode === 'flat' ? 'bg-accent/15 text-accent' : 'hover:text-text-1'}`}>Flat</button>
                  <button type="button" onClick={() => setMode('cum')} className={`rounded px-1.5 py-0.5 ${mode === 'cum' ? 'bg-accent/15 text-accent' : 'hover:text-text-1'}`}>Cumulative</button>
                </span>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={grouped} onChange={(event) => setGrouped(event.target.checked)} className="h-[14px] w-[14px] accent-[var(--color-accent)]" />Group by package</label>
                <span className="ml-auto font-mono">{formatProfileValue(total, unit)} total</span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {topNodes.length === 0 && <p className="p-4 text-[12px] text-text-4">No function matches the filter.</p>}
                {!grouped && topNodes.map((node) => (
                  <TopRow key={node.function.name} node={node} index={sampleIndex} mode={mode} total={total} unit={unit} selected={selectedName} onSelect={setSelectedFunction} />
                ))}
                {grouped && topGroups.map((group) => (
                  <div key={group.package}>
                    <div className="flex items-center gap-2 bg-surface-2/60 px-3 py-1 text-[11px] font-semibold text-text-2">
                      <Layers size={11} className="text-text-4" />{group.package}
                      <span className="ml-auto font-mono text-text-3">{formatProfileValue(group.value, unit)}</span>
                    </div>
                    {group.nodes.map((node) => (
                      <TopRow key={node.function.name} node={node} index={sampleIndex} mode={mode} total={total} unit={unit} selected={selectedName} onSelect={setSelectedFunction} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'flame' && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-3 border-b border-border-1 px-3 py-1 text-[11.5px] text-text-3">
                <button type="button" onClick={() => setFlameDown((value) => !value)} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:text-text-1">
                  <ArrowLeftRight size={11} />{flameDown ? 'Icicle (root on top)' : 'Flame (root on bottom)'}
                </button>
                <span className="ml-auto">{flame.frames.length} frames</span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2">
                {flame.frames.length === 0
                  ? <p className="p-4 text-[12px] text-text-4">No stack samples for this sample type.</p>
                  : (
                    <svg
                      role="img"
                      aria-label="Flame graph"
                      viewBox={`0 0 1000 ${(flame.maxDepth + 1) * FLAME_ROW}`}
                      preserveAspectRatio="none"
                      className="w-full"
                      style={{ height: (flame.maxDepth + 1) * FLAME_ROW }}
                    >
                      {flame.frames.map((frame) => {
                        const y = (flameDown ? frame.depth : flame.maxDepth - frame.depth) * FLAME_ROW
                        const value = sampleValue(frame.node.value, sampleIndex)
                        const hot = frame.width > 0.05
                        return (
                          <g key={frame.key} onClick={() => setSelectedFunction(frame.node.function)} className="cursor-pointer">
                            <rect x={frame.x * 1000} y={y} width={Math.max(0.5, frame.width * 1000)} height={FLAME_ROW - 1} rx={1.5} fill={hot ? 'var(--color-accent)' : 'var(--color-surface-3, #333)'} fillOpacity={0.25 + Math.min(0.6, frame.width * 6)} stroke="var(--color-border-1, #444)" strokeWidth={0.3} />
                            <title>{frame.node.function.name} · {formatProfileValue(value, unit)} ({formatProfilePercent(value, total)})</title>
                            {frame.width > 0.08 && (
                              <text x={frame.x * 1000 + 4} y={y + FLAME_ROW - 6} fontSize={9} fill="var(--color-text-1, #eee)" className="pointer-events-none font-mono">{shortFunctionName(frame.node.function)}</text>
                            )}
                          </g>
                        )
                      })}
                    </svg>
                  )}
              </div>
            </div>
          )}

          {tab === 'callers' && (
            <div className="min-h-0 flex-1 overflow-auto">
              {!selectedFunction && <p className="p-4 text-[12px] text-text-4">Select a function in Top functions or the flame graph to see its callers and callees. Showing the 200 heaviest edges.</p>}
              {selectedFunction && (
                <div className="p-3 text-[12px]">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="min-w-0 truncate font-mono text-text-1" title={selectedFunction.name}>{selectedFunction.name}</span>
                    <span className="font-mono text-[11px] text-text-4">{formatProfileValue(sampleValue(findNode(report.topCum, selectedName)?.cum, sampleIndex), unit)} cumulative</span>
                    {(selectedFunction.relative || selectedFunction.file?.endsWith('.go')) && (
                      <button type="button" onClick={() => openFunction(selectedFunction)} className="ml-auto rounded px-1.5 py-0.5 text-accent hover:bg-accent/10">Open source</button>
                    )}
                  </div>
                  <EdgeList title={`Callers (${callers.length})`} edges={callers.map((edge) => ({ fn: edge.caller, value: sampleValue(edge.value, sampleIndex) }))} total={total} unit={unit} />
                  <EdgeList title={`Callees (${callees.length})`} edges={callees.map((edge) => ({ fn: edge.callee, value: sampleValue(edge.value, sampleIndex) }))} total={total} unit={unit} />
                </div>
              )}
              {!selectedFunction && <EdgeList title="Heaviest edges" edges={topEdges.map((edge) => ({ fn: edge.callee, value: sampleValue(edge.value, sampleIndex), caller: edge.caller }))} total={total} unit={unit} />}
            </div>
          )}

          {tab === 'diff' && (
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="flex items-center gap-2 border-b border-border-1 px-3 py-1.5 text-[11.5px] text-text-3">
                <span>Compare with</span>
                <select value={diffPath} onChange={(event) => setDiffPath(event.target.value)} className="h-7 rounded-lg border-0 bg-[var(--gs-raised)] px-2 font-mono text-[11.5px] text-text-1 outline-none focus:ring-1 focus:ring-accent">
                  <option value="">Select a profile…</option>
                  {files.filter((file) => file.relative !== selectedPath).map((file) => <option key={file.relative} value={file.relative}>{file.relative}</option>)}
                </select>
                <span className="ml-auto">base: {report.name} · target: {diffReport?.name ?? '—'} · {mode}</span>
              </div>
              {!diffReport && <p className="p-4 text-[12px] text-text-4">Pick a second profile to see which functions got slower or faster.</p>}
              {diffReport && matchingSampleIndex(report, diffReport, sampleIndex) < 0 && <p className="p-4 text-[12px] text-warning">{diffReport.name} has no {report.sampleTypes[sampleIndex]?.name ?? 'matching'} samples: compare profiles of the same kind (CPU with CPU, heap with heap).</p>}
              {diffReport && deltas.slice(0, 300).map((delta) => (
                <button
                  key={delta.function.name}
                  type="button"
                  onClick={() => setSelectedFunction(delta.function)}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-b border-border-1/60 px-3 py-1 text-left hover:bg-surface-2/60"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[12px] text-text-1" title={delta.function.name}>{shortFunctionName(delta.function)}</span>
                    <span className="block truncate text-[11px] text-text-4">{delta.function.package}</span>
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-text-4">{formatProfileValue(delta.base, unit)}</span>
                  <span className="font-mono text-[11px] tabular-nums text-text-4">{formatProfileValue(delta.target, unit)}</span>
                  <span className={`w-24 text-right font-mono text-[11.5px] tabular-nums ${delta.delta > 0 ? 'text-danger' : delta.delta < 0 ? 'text-success' : 'text-text-3'}`}>
                    {delta.delta > 0 ? '+' : ''}{formatProfileValue(delta.delta, unit)} · {delta.base > 0 ? `${(delta.ratio * 100).toFixed(0)}%` : 'new'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function findNode(nodes: ProfileNode[], name: string): ProfileNode | undefined {
  return nodes.find((node) => node.function.name === name)
}

function EdgeList({ title, edges, total, unit }: {
  title: string
  edges: Array<{ fn: ProfileFunction; value: number; caller?: ProfileFunction }>
  total: number
  unit: string
}) {
  return (
    <div className="mb-3">
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-4">{title}</h4>
      {edges.length === 0 && <p className="text-[11.5px] text-text-4">None.</p>}
      {edges.slice(0, 100).map((edge, index) => (
        <div key={`${edge.fn.name}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border-1/50 py-0.5">
          <button type="button" onClick={() => openFunction(edge.fn)} className="min-w-0 truncate text-left font-mono text-[11.5px] text-text-2 hover:text-accent" title={`${edge.caller ? `${shortFunctionName(edge.caller)} → ` : ''}${edge.fn.name}`}>
            {edge.caller ? `${shortFunctionName(edge.caller)} → ` : ''}{shortFunctionName(edge.fn)}
          </button>
          <span className="flex items-center gap-2">
            <ValueBar value={edge.value} total={total} />
            <span className="w-16 text-right font-mono text-[11px] tabular-nums text-text-3">{formatProfileValue(edge.value, unit)}</span>
          </span>
        </div>
      ))}
    </div>
  )
}
