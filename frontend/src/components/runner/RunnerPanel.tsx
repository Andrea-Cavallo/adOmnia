import { useState, useRef, useCallback, useEffect } from 'react'
import { Play, Square, FileText, FileCode, FileJson, Table2, Check, X, Clock, BarChart3 } from 'lucide-react'
import type { RequestItem } from '@/lib/types'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { cn } from '@/lib/utils'
import {
  runCollection,
  flattenRequests,
  parseCsvDataset,
  parseJsonDataset,
  exportRunnerReportMarkdown,
  exportRunnerReportHtml,
  exportRunnerReportJson,
  exportRunnerReportJunit,
  type RunnerConfig,
  type RunnerProgress,
  type RunnerRequestResult,
  type RunnerSummary,
} from '@/lib/runnerEngine'

export function RunnerPanel() {
  const collections = useCollectionsStore((s) => s.collections)
  const getResolvedVars = useEnvironmentsStore((s) => s.getResolvedVars)

  const [selectedColId, setSelectedColId] = useState('')
  const [iterations, setIterations] = useState(1)
  const [delay, setDelay] = useState(0)
  const [stopOnFailure, setStopOnFailure] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [datasetText, setDatasetText] = useState('')
  const [datasetType, setDatasetType] = useState<'csv' | 'json'>('csv')

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<RunnerProgress | null>(null)
  const [summary, setSummary] = useState<RunnerSummary | null>(null)
  const [log, setLog] = useState<RunnerRequestResult[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const logEndRef = useRef<HTMLDivElement | null>(null)

  const selectedCol = collections.find((c) => c.id === selectedColId)
  const selectedRequests = selectedCol ? selectedCol.children.flatMap((n) => flattenRequests(n)) : []
  const canRun = !!selectedCol && selectedRequests.length > 0 && !running

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [log])

  useEffect(() => {
    if (collections.length > 0 && !selectedColId) {
      setSelectedColId(collections[0].id)
    }
  }, [collections, selectedColId])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { data: string; format: 'json' | 'csv' }
      if (detail?.data) {
        setDatasetText(detail.data)
        setDatasetType(detail.format)
      }
    }
    window.addEventListener('adomnia:dataset-from-studio', handler)
    return () => window.removeEventListener('adomnia:dataset-from-studio', handler)
  }, [])

  const start = useCallback(async () => {
    if (!selectedCol) return

    const allRequests: RequestItem[] = selectedCol.children.flatMap((n) => flattenRequests(n))
    if (allRequests.length === 0) return

    const config: RunnerConfig = {
      iterations,
      delayMs: delay,
      stopOnFailure,
      retryCount,
    }

    if (datasetText.trim()) {
      if (datasetType === 'csv') {
        config.dataset = parseCsvDataset(datasetText)
      } else {
        config.dataset = parseJsonDataset(datasetText)
      }
    }

    const vars = getResolvedVars()
    const oaSpec = selectedCol._openapiSpec
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setSummary(null)
    setLog([])

    const results: RunnerRequestResult[] = []

    try {
      const gen = runCollection(allRequests, config, vars, oaSpec)
      while (true) {
        const next = await gen.next()
        if (next.done) {
          setSummary(next.value)
          setProgress((p) => p ? { ...p, phase: 'done' } : p)
          break
        }
        if (controller.signal.aborted) break
        const p = next.value
        setProgress(p)
        if (p.lastResult) {
          results.push(p.lastResult)
          setLog([...results])
        }
      }
    } catch {
      // generator ended
    } finally {
      setRunning(false)
    }
  }, [selectedCol, iterations, delay, stopOnFailure, retryCount, datasetText, datasetType, getResolvedVars])

  const stop = () => {
    abortRef.current?.abort()
    setRunning(false)
  }

  const datasetRows = datasetText.trim()
    ? (datasetType === 'csv' ? parseCsvDataset(datasetText).length : parseJsonDataset(datasetText).length) || 1
    : 1

  const totalSteps = selectedRequests.length * iterations * datasetRows

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Config bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border-1 bg-surface-1">
        <span className="text-xs font-medium text-text-2">Collection Runner</span>

        <select
          value={selectedColId}
          onChange={(e) => setSelectedColId(e.target.value)}
          className="h-7 px-2 text-xs bg-surface-2 border border-border-1 rounded text-text-1"
          disabled={running}
        >
          {collections.length === 0 && <option value="">No collections</option>}
          {collections.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <span className="text-[10px] text-text-4">Iter:</span>
          <input
            type="number"
            min={1}
            max={999}
            value={iterations}
            onChange={(e) => setIterations(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-14 h-7 px-1 text-xs bg-surface-2 border border-border-1 rounded text-text-1 text-center"
            disabled={running}
          />
        </div>

        <div className="flex items-center gap-1">
          <span className="text-[10px] text-text-4">Delay:</span>
          <input
            type="number"
            min={0}
            value={delay}
            onChange={(e) => setDelay(Math.max(0, parseInt(e.target.value) || 0))}
            className="w-16 h-7 px-1 text-xs bg-surface-2 border border-border-1 rounded text-text-1 text-center"
            disabled={running}
          />
          <span className="text-[10px] text-text-4">ms</span>
        </div>

        <div className="flex items-center gap-1">
          <span className="text-[10px] text-text-4">Retry:</span>
          <input
            type="number"
            min={0}
            max={9}
            value={retryCount}
            onChange={(e) => setRetryCount(Math.max(0, parseInt(e.target.value) || 0))}
            className="w-12 h-7 px-1 text-xs bg-surface-2 border border-border-1 rounded text-text-1 text-center"
            disabled={running}
          />
        </div>

        <label className="flex items-center gap-1 text-[10px] text-text-3 cursor-pointer">
          <input
            type="checkbox"
            checked={stopOnFailure}
            onChange={(e) => setStopOnFailure(e.target.checked)}
            className="w-3 h-3"
            disabled={running}
          />
          Stop on failure
        </label>

        <div className="flex items-center gap-1 ml-auto">
          {running ? (
            <button onClick={stop} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-error/20 text-error hover:bg-error/30">
              <Square size={12} /> Stop
            </button>
          ) : (
            <button
              onClick={start}
              disabled={!canRun}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed"
              title={!selectedCol ? 'Select a collection' : selectedRequests.length === 0 ? 'Selected collection has no requests' : 'Run selected collection'}
            >
              <Play size={12} /> Run
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Dataset panel */}
        <div className="w-60 flex-shrink-0 border-r border-border-1 flex flex-col">
          <div className="px-3 py-2 border-b border-border-1 flex items-center gap-2">
            <span className="text-[10px] font-medium text-text-3 uppercase">Dataset</span>
            <select
              value={datasetType}
              onChange={(e) => setDatasetType(e.target.value as 'csv' | 'json')}
              className="h-6 px-1 text-[10px] bg-surface-2 border border-border-1 rounded text-text-1"
              disabled={running}
            >
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </div>
          <textarea
            value={datasetText}
            onChange={(e) => setDatasetText(e.target.value)}
            placeholder={
              datasetType === 'csv'
                ? 'name,email\nJohn,john@x.com\nJane,jane@x.com'
                : '[{"name":"John","email":"john@x.com"}]'
            }
            className="flex-1 p-2 text-[10px] font-mono bg-surface-1 resize-none outline-none text-text-2 placeholder-text-4"
            disabled={running}
          />
        </div>

        {/* Run log */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {progress && (
            <div className="px-3 py-1.5 border-b border-border-1">
              <div className="w-full h-1.5 bg-surface-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-300"
                  style={{ width: `${totalSteps > 0 ? Math.round((progress.current / progress.total) * 100) : 0}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex-1 overflow-auto p-2">
            {log.length === 0 && !running && !summary && (
              <div className="flex flex-col items-center justify-center h-full gap-2">
                <Play size={24} className="text-text-4" />
                <p className="text-xs text-text-3">
                  {!selectedCol
                    ? 'Create or import a collection to run it here'
                    : selectedRequests.length === 0
                      ? 'Selected collection has no requests'
                      : 'Configure a collection and click Run'}
                </p>
              </div>
            )}

            {log.map((r, i) => (
              <div
                key={i}
                className={cn(
                  'flex items-center gap-2 px-2 py-1 text-[11px] font-mono',
                  r.passed ? 'text-text-2' : 'text-error',
                )}
              >
                {r.passed
                  ? <Check size={12} className="text-success flex-shrink-0" />
                  : <X size={12} className="text-error flex-shrink-0" />
                }
                <span className="w-6 text-text-4 text-right flex-shrink-0">{i + 1}</span>
                <span className={cn('px-1 py-0.5 rounded text-[10px] font-medium flex-shrink-0 w-11 text-center',
                  r.method === 'GET' ? 'bg-blue-500/15 text-blue-400' :
                  r.method === 'POST' ? 'bg-green-500/15 text-green-400' :
                  r.method === 'PUT' ? 'bg-orange-500/15 text-orange-400' :
                  r.method === 'DELETE' ? 'bg-red-500/15 text-red-400' :
                  'bg-surface-2 text-text-3'
                )}>{r.method}</span>
                <span className={cn('w-10 text-right flex-shrink-0',
                  r.passed ? 'text-text-3' : 'text-error'
                )}>{r.status || 'ERR'}</span>
                <span className="w-16 text-right text-text-4 flex-shrink-0">{r.durationMs}ms</span>
                <span className="truncate">{r.requestName}</span>
                {r.error && (
                  <span className="text-[10px] text-error truncate ml-2" title={r.error}>
                    {r.error.length > 40 ? r.error.slice(0, 37) + '...' : r.error}
                  </span>
                )}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>

          {/* Summary */}
          {summary && (
            <div className="border-t border-border-1 p-3">
              <div className="flex items-center gap-4 mb-2">
                <span className="text-xs font-medium text-text-2">Summary</span>
                <div className="flex items-center gap-3 text-[10px]">
                  <span className="flex items-center gap-1 text-success"><Check size={10} /> {summary.passed} passed</span>
                  {summary.failed > 0 && (
                    <span className="flex items-center gap-1 text-error"><X size={10} /> {summary.failed} failed</span>
                  )}
                  <span className="flex items-center gap-1 text-text-4"><Clock size={10} /> {summary.totalDurationMs}ms</span>
                  <span className="flex items-center gap-1 text-text-4"><BarChart3 size={10} /> avg {summary.avgMs}ms</span>
                </div>

                <div className="flex items-center gap-1 ml-auto">
                  <button onClick={() => downloadBlob(exportRunnerReportMarkdown(summary), 'runner-report.md', 'text/markdown')} className="p-1 text-text-4 hover:text-text-2" title="Download Markdown"><FileText size={12} /></button>
                  <button onClick={() => downloadBlob(exportRunnerReportHtml(summary), 'runner-report.html', 'text/html')} className="p-1 text-text-4 hover:text-text-2" title="Download HTML"><FileCode size={12} /></button>
                  <button onClick={() => downloadBlob(exportRunnerReportJson(summary), 'runner-report.json', 'application/json')} className="p-1 text-text-4 hover:text-text-2" title="Download JSON"><FileJson size={12} /></button>
                  <button onClick={() => downloadBlob(exportRunnerReportJunit(summary), 'runner-report.xml', 'application/xml')} className="p-1 text-text-4 hover:text-text-2" title="Download JUnit XML"><Table2 size={12} /></button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
