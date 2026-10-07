import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, Crosshair, Flame, GitCompare, Layers, ListTree, Loader2, Network, RefreshCw, Search } from 'lucide-react'
import { useGoIDEStore } from '@/stores/goide'
import { listGoIDEProfileFiles, loadGoIDEProfile, type GoIDEProfileFile, type GoIDEProfileReport } from '@/lib/goide-api'
import type { GoIDESession } from '@/lib/goide-api'
import {
  defaultSampleIndex, diffProfiles, matchingSampleIndex, filterNodes, formatProfilePercent, formatProfileValue, groupByPackage,
  sampleValue, shortFunctionName, sortTop, codeOriginColor, CODE_ORIGINS, type ProfileFunction, type ProfileNode,
} from './goStudioProfiles'
import { GoStudioFlameGraph } from './GoStudioFlameGraph'
import { GoStudioCallGraph } from './GoStudioCallGraph'
import { VizBar, VizLegend, VizSegmented } from './GoStudioVizKit'
import { GoStudioPerfExport } from './GoStudioPerfExport'
import { GoStudioCreateProfile } from './GoStudioCreateProfile'
import { GoStudioCaptureLiveProfile } from './GoStudioCaptureLiveProfile'
import { useFocusedArtifact } from '@/lib/goide/goStudioRemote'
import { markdownFileName, profileToMarkdown } from './goStudioPerfMarkdown'
import { profileHeatFrom, useGoStudioProfileHeat } from './goStudioProfileHeat'

interface GoStudioProfilePanelProps {
  session: GoIDESession
}

type ProfileTab = 'top' | 'flame' | 'graph' | 'callers' | 'diff'
type TopMode = 'flat' | 'cum'

const TABS: Array<{ id: ProfileTab; label: string; icon: typeof Flame }> = [
  { id: 'top', label: 'Top functions', icon: ListTree },
  { id: 'flame', label: 'Flame graph', icon: Flame },
  { id: 'graph', label: 'Call graph', icon: Network },
  { id: 'callers', label: 'Callers', icon: Crosshair },
  { id: 'diff', label: 'Diff', icon: GitCompare },
]

/** Apre il sorgente di una funzione: relativo al progetto, oppure esterno (stdlib) per i file .go. */
function openFunction(fn: ProfileFunction): void {
  const store = useGoIDEStore.getState()
  if (fn.relative) void store.openLocation(fn.relative, fn.line || 1)
  else if (fn.file && fn.file.endsWith('.go')) void store.openExternalLocation(fn.file, fn.line || 1)
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
  const color = codeOriginColor(node.function)
  return (
    <div
      role="row"
      tabIndex={0}
      aria-selected={active}
      onClick={() => onSelect(node.function)}
      onKeyDown={(event) => { if (event.key === 'Enter') onSelect(node.function) }}
      className={`group relative grid cursor-pointer grid-cols-[minmax(0,1fr)_88px_150px] items-center gap-3 px-3 py-1.5 ${active ? 'bg-accent/10' : 'hover:bg-surface-2/60'}`}
    >
      {active && <span aria-hidden="true" className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-accent" />}
      <div className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />
        <div className="min-w-0">
          <div className="truncate font-mono text-[12px] text-text-1" title={node.function.name}>{shortFunctionName(node.function)}</div>
          <div className="truncate text-[11px] text-text-4" title={node.function.name}>{node.function.package || '(unknown)'}</div>
        </div>
      </div>
      <span className="text-right font-mono text-[11.5px] tabular-nums text-text-2">{formatProfileValue(value, unit)}</span>
      <span className="flex items-center justify-end gap-2">
        <VizBar value={value} max={total} color={color} />
        <span className="w-11 text-right font-mono text-[11px] tabular-nums text-text-3">{formatProfilePercent(value, total)}</span>
        {node.function.relative || node.function.file?.endsWith('.go') ? (
          <button
            type="button"
            title="Open source"
            aria-label={`Open source of ${shortFunctionName(node.function)}`}
            onClick={(event) => { event.stopPropagation(); openFunction(node.function) }}
            className="rounded p-0.5 text-text-4 opacity-60 hover:text-accent group-hover:opacity-100"
          >
            <Crosshair size={12} />
          </button>
        ) : <span className="w-[16px]" />}
      </span>
    </div>
  )
}

const ORIGIN_LEGEND = CODE_ORIGINS.map((origin) => ({ id: origin.id, label: origin.label, color: origin.color }))

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
  const heatEnabled = useGoStudioProfileHeat((state) => state.enabled)
  const [search, setSearch] = useState('')
  const [hideRuntime, setHideRuntime] = useState(false)
  const [grouped, setGrouped] = useState(false)
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
  useFocusedArtifact('profile', useCallback((path: string) => { setSelectedPath(path); void refresh() }, [refresh]))

  const profileCreated = useCallback((path: string) => {
    setSelectedPath(path)
    void refresh()
    void useGoIDEStore.getState().refreshProject()
  }, [refresh])

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
  const selectedName = selectedFunction?.name ?? ''
  const callers = useMemo(() => report?.edges.filter((edge) => edge.callee.name === selectedName) ?? [], [report, selectedName])
  const callees = useMemo(() => report?.edges.filter((edge) => edge.caller.name === selectedName) ?? [], [report, selectedName])
  // Il profilo aperto colora il costo per riga nell'editor della stessa sessione.
  useEffect(() => {
    useGoStudioProfileHeat.getState().publish(sessionId, report ? profileHeatFrom(report, sampleIndex) : null)
  }, [report, sampleIndex, sessionId])
  const topEdges = useMemo(() => (report?.edges ?? []).slice(0, 200), [report])
  const deltas = useMemo(() => (report && diffReport ? diffProfiles(report, diffReport, sampleIndex, mode) : []), [report, diffReport, sampleIndex, mode])
  const changedCount = useMemo(() => deltas.filter((delta) => delta.delta !== 0).length, [deltas])
  const maxDelta = useMemo(() => deltas.reduce((max, delta) => Math.max(max, Math.abs(delta.delta)), 0), [deltas])

  if (!session.project.authorization) {
    return <p className="p-4 text-[12px] text-text-4">Trust the project to inspect its profiles.</p>
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="go-studio-tool-header flex-wrap gap-2">
        <span className="go-studio-tool-title">Performance</span>
        <GoStudioCreateProfile key={sessionId} session={session} onCreated={profileCreated} />
        <GoStudioCaptureLiveProfile key={`live-${sessionId}`} session={session} onCreated={profileCreated} />
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
        <label className="flex items-center gap-1.5 text-[11.5px] text-text-3" title="Show the cost of each source line in the editor"><input type="checkbox" checked={heatEnabled} onChange={(event) => useGoStudioProfileHeat.getState().setEnabled(event.target.checked)} className="h-[14px] w-[14px] accent-[var(--color-accent)]" />Cost in editor</label>
        <label className="flex items-center gap-1.5 text-[11.5px] text-text-3"><input type="checkbox" checked={hideRuntime} onChange={(event) => setHideRuntime(event.target.checked)} className="h-[14px] w-[14px] accent-[var(--color-accent)]" />Hide runtime</label>
        <button type="button" onClick={() => void refresh()} aria-label="Refresh profiles" title="Refresh" className="go-studio-icon-button h-7 w-7"><RefreshCw size={13} className={filesLoading ? 'animate-spin' : ''} /></button>
        {reportLoading && <Loader2 size={14} className="animate-spin text-accent" aria-label="Loading profile" />}
        {report && (
          <span className="ml-auto">
            <GoStudioPerfExport
              fileName={markdownFileName(report.name, report.sampleTypes[sampleIndex]?.name ?? 'profile')}
              build={() => profileToMarkdown(report, { sampleIndex, compareWith: diffReport && matchingSampleIndex(report, diffReport, sampleIndex) >= 0 ? diffReport : null })}
            />
          </span>
        )}
      </div>

      {error && <p className="border-b border-danger/30 bg-danger/10 px-3 py-1 text-[11.5px] text-danger">{error}</p>}

      {!report && !reportLoading && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-text-4">
          <Flame size={22} />
          <p className="text-[12.5px]">Use Create .pprof to run package tests and open the generated profile, or select an existing file above.</p>
        </div>
      )}

      {report && (
        <>
          <div className="flex items-center gap-3 border-b border-border-1 px-3 py-1.5">
            <VizSegmented segments={TABS} value={tab} onChange={setTab} label="Profile views" />
            <span className="ml-auto text-[11px] text-text-4"><span className="font-mono tabular-nums text-text-3">{report.samples.toLocaleString('en-US')}</span> samples · {report.kind}{report.time ? ` · ${report.time}` : ''}</span>
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
              <div className="border-b border-border-1 px-3 py-1.5"><VizLegend items={ORIGIN_LEGEND} /></div>
              <div role="row" className="grid grid-cols-[minmax(0,1fr)_88px_150px] gap-3 border-b border-border-1 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">
                <span className="pl-5">Function</span><span className="text-right">{mode === 'flat' ? 'Flat' : 'Cumulative'}</span><span className="pr-5 text-right">Share</span>
              </div>
              <div role="table" aria-label="Top functions" className="min-h-0 flex-1 overflow-auto">
                {topNodes.length === 0 && <p className="p-4 text-[12px] text-text-4">No function matches the filter.</p>}
                {!grouped && topNodes.map((node) => (
                  <TopRow key={node.function.name} node={node} index={sampleIndex} mode={mode} total={total} unit={unit} selected={selectedName} onSelect={setSelectedFunction} />
                ))}
                {grouped && topGroups.map((group) => (
                  <div key={group.package}>
                    <div className="sticky top-0 z-[1] flex items-center gap-2 border-y border-border-1/60 bg-[var(--gs-island)] px-3 py-1.5 text-[11.5px] font-semibold text-text-2">
                      <Layers size={12} className="text-text-4" />{group.package}
                      <span className="ml-auto flex items-center gap-2 font-mono font-normal text-text-3">
                        <VizBar value={group.value} max={total} color={codeOriginColor(group.nodes[0]?.function ?? { package: group.package })} width={56} />
                        {formatProfileValue(group.value, unit)} · {formatProfilePercent(group.value, total)}
                      </span>
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
            <GoStudioFlameGraph flame={report.flame ?? null} total={total} sampleIndex={sampleIndex} unit={unit} query={search} selected={selectedName || null} onSelect={setSelectedFunction} />
          )}

          {tab === 'graph' && (
            <GoStudioCallGraph top={report.topCum ?? []} edges={report.edges ?? []} sampleIndex={sampleIndex} total={total} unit={unit} hideRuntime={hideRuntime} selected={selectedName || null} onSelect={setSelectedFunction} onOpen={openFunction} />
          )}

          {tab === 'callers' && (
            <div className="min-h-0 flex-1 overflow-auto">
              {!selectedFunction && (
                <div className="p-3">
                  <p className="mb-2 text-[12px] text-text-4">Select a function in Top functions or the flame graph to see who calls it and what it calls. Below, the heaviest call edges.</p>
                  <EdgeList title="Heaviest call edges" edges={topEdges.map((edge) => ({ fn: edge.callee, value: sampleValue(edge.value, sampleIndex), caller: edge.caller }))} total={total} unit={unit} onSelect={setSelectedFunction} />
                </div>
              )}
              {selectedFunction && (
                <div className="grid min-h-full grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)_minmax(0,1fr)] gap-3 p-3 max-lg:grid-cols-1">
                  <EdgeList title={`Callers · ${callers.length}`} icon={<ArrowRight size={12} />} edges={callers.map((edge) => ({ fn: edge.caller, value: sampleValue(edge.value, sampleIndex) }))} total={total} unit={unit} onSelect={setSelectedFunction} align="right" />
                  <div className="self-start rounded-xl p-3 shadow-[inset_0_0_0_1px_var(--color-border-1)]" style={{ background: `color-mix(in srgb, ${codeOriginColor(selectedFunction)} 10%, var(--gs-island))` }}>
                    <div className="mb-1 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">
                      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ background: codeOriginColor(selectedFunction) }} />Selected
                    </div>
                    <div className="break-all font-mono text-[12.5px] font-semibold text-text-1">{shortFunctionName(selectedFunction)}</div>
                    <div className="mb-2 truncate text-[11px] text-text-4" title={selectedFunction.name}>{selectedFunction.package}</div>
                    <div className="flex items-baseline justify-between text-[11.5px]"><span className="text-text-4">Flat</span><span className="font-mono tabular-nums text-text-1">{formatProfileValue(sampleValue(findNode(report.topFlat, selectedName)?.flat, sampleIndex), unit)}</span></div>
                    <div className="flex items-baseline justify-between text-[11.5px]"><span className="text-text-4">Cumulative</span><span className="font-mono tabular-nums text-text-1">{formatProfileValue(sampleValue(findNode(report.topCum, selectedName)?.cum, sampleIndex), unit)}</span></div>
                    {(selectedFunction.relative || selectedFunction.file?.endsWith('.go')) && (
                      <button type="button" onClick={() => openFunction(selectedFunction)} className="mt-2 w-full rounded-lg bg-accent/15 py-1 text-[11.5px] font-medium text-accent hover:bg-accent/25">Open source</button>
                    )}
                  </div>
                  <EdgeList title={`Callees · ${callees.length}`} icon={<ArrowRight size={12} />} edges={callees.map((edge) => ({ fn: edge.callee, value: sampleValue(edge.value, sampleIndex) }))} total={total} unit={unit} onSelect={setSelectedFunction} />
                </div>
              )}
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
              {diffReport && deltas.length > 0 && (
                <div className="flex items-center gap-4 border-b border-border-1 px-3 py-1.5 text-[11px] text-text-3">
                  <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-3 rounded-[2px]" style={{ background: 'var(--gs-viz-slower)' }} /><ArrowUp size={11} />Slower / more</span>
                  <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-3 rounded-[2px]" style={{ background: 'var(--gs-viz-faster)' }} /><ArrowDown size={11} />Faster / less</span>
                  <span className="ml-auto">{changedCount} of {deltas.length} functions changed</span>
                </div>
              )}
              {diffReport && deltas.slice(0, 300).map((delta) => (
                <DiffRow key={delta.function.name} delta={delta} maxDelta={maxDelta} unit={unit} onSelect={setSelectedFunction} />
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

function EdgeList({ title, icon, edges, total, unit, onSelect, align = 'left' }: {
  title: string
  icon?: React.ReactNode
  edges: Array<{ fn: ProfileFunction; value: number; caller?: ProfileFunction }>
  total: number
  unit: string
  onSelect: (fn: ProfileFunction) => void
  align?: 'left' | 'right'
}) {
  const max = edges.reduce((value, edge) => Math.max(value, edge.value), 0)
  return (
    <section className="min-w-0">
      <h4 className={`mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-4 ${align === 'right' ? 'justify-end' : ''}`}>{title}{icon}</h4>
      {edges.length === 0 && <p className={`text-[11.5px] text-text-4 ${align === 'right' ? 'text-right' : ''}`}>None.</p>}
      {edges.slice(0, 100).map((edge, index) => {
        const color = codeOriginColor(edge.fn)
        const label = `${edge.caller ? `${shortFunctionName(edge.caller)} → ` : ''}${shortFunctionName(edge.fn)}`
        return (
          <button
            key={`${edge.fn.name}-${index}`}
            type="button"
            onClick={() => onSelect(edge.fn)}
            onDoubleClick={() => openFunction(edge.fn)}
            title={`${edge.fn.name}\nClick to select · double-click to open source`}
            className="mb-1 block w-full rounded-lg px-2 py-1 text-left hover:bg-surface-2/70"
          >
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: color }} />
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-1">{label}</span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-3">{formatProfileValue(edge.value, unit)}</span>
            </span>
            <span className="mt-1 flex items-center gap-2 pl-4">
              <VizBar value={edge.value} max={max} color={color} width={120} />
              <span className="font-mono text-[10.5px] tabular-nums text-text-4">{formatProfilePercent(edge.value, total)}</span>
            </span>
          </button>
        )
      })}
    </section>
  )
}

/** Riga del diff: barra divergente centrata sullo zero, rosso più lento, blu più veloce, freccia per chi non distingue i colori. */
function DiffRow({ delta, maxDelta, unit, onSelect }: {
  delta: ReturnType<typeof diffProfiles>[number]
  maxDelta: number
  unit: string
  onSelect: (fn: ProfileFunction) => void
}) {
  const slower = delta.delta > 0
  const color = slower ? 'var(--gs-viz-slower)' : 'var(--gs-viz-faster)'
  const half = maxDelta > 0 ? Math.min(50, (Math.abs(delta.delta) / maxDelta) * 50) : 0
  const Arrow = slower ? ArrowUp : ArrowDown
  return (
    <button
      type="button"
      onClick={() => onSelect(delta.function)}
      onDoubleClick={() => openFunction(delta.function)}
      className={`grid w-full grid-cols-[minmax(0,1fr)_76px_76px_150px_150px] items-center gap-3 border-b border-border-1/50 px-3 py-1.5 text-left hover:bg-surface-2/60 ${delta.delta === 0 ? 'opacity-55' : ''}`}
    >
      <span className="min-w-0">
        <span className="block truncate font-mono text-[12px] text-text-1" title={delta.function.name}>{shortFunctionName(delta.function)}</span>
        <span className="block truncate text-[11px] text-text-4">{delta.function.package}</span>
      </span>
      <span className="text-right font-mono text-[11px] tabular-nums text-text-4">{formatProfileValue(delta.base, unit)}</span>
      <span className="text-right font-mono text-[11px] tabular-nums text-text-3">{formatProfileValue(delta.target, unit)}</span>
      <span aria-hidden="true" className="relative h-2.5 rounded-full" style={{ background: 'var(--gs-viz-track)' }}>
        <span className="absolute inset-y-[-3px] left-1/2 w-px bg-[var(--gs-viz-grid)]" />
        <span className="absolute inset-y-0 rounded-full" style={{ background: color, width: `${half}%`, left: slower ? '50%' : `${50 - half}%` }} />
      </span>
      <span className="flex items-center justify-end gap-1 font-mono text-[11.5px] tabular-nums text-text-1">
        {delta.delta !== 0 && <Arrow size={11} style={{ color }} aria-label={slower ? 'slower' : 'faster'} />}
        <span className="text-text-3">{delta.delta > 0 ? '+' : ''}{formatProfileValue(delta.delta, unit)}</span>
        <span className="w-12 text-right">{delta.base > 0 ? `${delta.delta > 0 ? '+' : ''}${(delta.ratio * 100).toFixed(0)}%` : 'new'}</span>
      </span>
    </button>
  )
}
