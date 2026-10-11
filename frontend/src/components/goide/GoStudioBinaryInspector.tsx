import { Fragment, useState } from 'react'
import { Loader2, Package } from 'lucide-react'
import * as GoIDE from '../../../bindings/adomnia/goide'
import type { BinaryReport } from '../../../bindings/adomnia/internal/languages/golang/models'
import type { BinaryComparison } from '../../../bindings/adomnia/internal/goide/models'

export function formatBytes(bytes: number): string {
  const sign = bytes < 0 ? '-' : ''
  const value = Math.abs(bytes)
  if (value >= 1024 * 1024) return `${sign}${(value / 1024 / 1024).toFixed(2)} MB`
  if (value >= 1024) return `${sign}${(value / 1024).toFixed(1)} KB`
  return `${sign}${value} B`
}

function Bars({ items, total }: { items: Array<{ name: string; size: number }>; total: number }) {
  const max = Math.max(1, ...items.map((item) => item.size))
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.name} className="flex items-center gap-2">
          <span className="w-72 shrink-0 truncate font-mono text-text-2" title={item.name}>{item.name}</span>
          <span className="h-2 rounded-sm bg-accent/60" style={{ width: `${Math.max(2, (item.size / max) * 220)}px` }} aria-hidden="true" />
          <span className="font-mono text-text-3">{formatBytes(item.size)}{total > 0 ? ` · ${((item.size / total) * 100).toFixed(1)}%` : ''}</span>
        </li>
      ))}
    </ul>
  )
}

const SETTINGS = ['GOOS', 'GOARCH', 'CGO_ENABLED', '-ldflags', '-tags', '-trimpath', 'vcs.revision', 'vcs.time', 'vcs.modified']

/** Binary Inspector: builds a main package and shows what the executable is made of. */
export function GoStudioBinaryInspector({ sessionId, targets }: { sessionId: string; targets: string[] }) {
  const [target, setTarget] = useState(targets[0] ?? '.')
  const [report, setReport] = useState<BinaryReport | null>(null)
  const [base, setBase] = useState('main')
  const [comparison, setComparison] = useState<BinaryComparison | null>(null)
  const [busy, setBusy] = useState<'build' | 'compare' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const act = async (kind: 'build' | 'compare') => {
    setBusy(kind)
    setError(null)
    try {
      if (kind === 'build') setReport(await GoIDE.InspectBinary(sessionId, target))
      else setComparison(await GoIDE.CompareBinary(sessionId, target, base.trim()))
    } catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)) } finally { setBusy(null) }
  }
  const settings = report?.settings ?? {}
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-1 px-2 py-1 text-text-3">
        <label htmlFor="binary-target" className="text-text-4">Main package</label>
        <input id="binary-target" list="binary-targets" value={target} onChange={(event) => setTarget(event.target.value)} className="h-6 w-44 rounded border border-border-1 bg-surface-2 px-1.5 font-mono text-text-1 outline-none focus:border-accent" />
        <datalist id="binary-targets">{targets.map((item) => <option key={item} value={item} />)}</datalist>
        <button type="button" onClick={() => void act('build')} disabled={!!busy} className="flex h-6 items-center gap-1 rounded bg-accent px-2 font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy === 'build' ? <Loader2 size={11} className="animate-spin" /> : <Package size={11} />}Build &amp; inspect</button>
        <span className="ml-auto flex items-center gap-1">
          <label htmlFor="binary-base" className="text-text-4">Compare size with</label>
          <input id="binary-base" value={base} onChange={(event) => setBase(event.target.value)} className="h-6 w-28 rounded border border-border-1 bg-surface-2 px-1.5 font-mono text-text-1 outline-none focus:border-accent" />
          <button type="button" onClick={() => void act('compare')} disabled={!!busy || !base.trim()} className="flex h-6 items-center gap-1 rounded px-1.5 text-accent hover:bg-accent/10 disabled:opacity-50">{busy === 'compare' && <Loader2 size={11} className="animate-spin" />}Compare</button>
        </span>
      </div>
      {error && <p className="shrink-0 whitespace-pre-wrap border-b border-danger/30 bg-danger/10 px-2 py-1 text-danger">{error}</p>}
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-2">
        {!report && !comparison && !busy && <p className="text-text-4">Builds the package to a temporary file (nothing is written to the project) and shows its size by package and symbol, the embedded files, the Go version, the module versions and the build settings.</p>}
        {comparison && (
          <section aria-label="Binary size comparison">
            <h4 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">{comparison.base}: {formatBytes(comparison.baseSize)} → now: {formatBytes(comparison.headSize)} ({formatBytes(comparison.headSize - comparison.baseSize)})</h4>
            <ul className="space-y-0.5">
              {comparison.packages.map((change) => (
                <li key={change.name} className="flex items-center gap-2 font-mono">
                  <span className="w-72 shrink-0 truncate text-text-2" title={change.name}>{change.name}</span>
                  <span className={change.head > change.base ? 'text-danger' : 'text-success'}>{change.head > change.base ? '+' : ''}{formatBytes(change.head - change.base)}</span>
                  <span className="text-text-4">{formatBytes(change.base)} → {formatBytes(change.head)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {report && (
          <>
            <section aria-label="Binary summary" className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-0.5">
              <span className="text-text-4">Size</span><span className="font-mono text-text-1">{formatBytes(report.size)} ({formatBytes(report.symbolBytes)} in symbols)</span>
              <span className="text-text-4">Go version</span><span className="font-mono text-text-1">{report.goVersion}</span>
              <span className="text-text-4">Main module</span><span className="font-mono text-text-1">{report.main}</span>
              {SETTINGS.filter((key) => settings[key]).map((key) => <Fragment key={key}><span className="text-text-4">{key}</span><span className="truncate font-mono text-text-2">{settings[key]}</span></Fragment>)}
            </section>
            <section><h4 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">Packages by size</h4><Bars items={(report.packages ?? []).slice(0, 25)} total={report.symbolBytes} /></section>
            <section><h4 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">Largest symbols</h4><Bars items={(report.symbols ?? []).slice(0, 20)} total={report.symbolBytes} /></section>
            <section><h4 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">Embedded files · {report.embedded?.length ?? 0}</h4>{report.embedded?.length ? <Bars items={report.embedded.slice(0, 20)} total={report.size} /> : <p className="text-text-4">No //go:embed in this package.</p>}</section>
            <section>
              <h4 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">Modules · {report.modules.length}</h4>
              <ul>{report.modules.map((module) => <li key={module.path} className="font-mono text-text-2">{module.path} <span className="text-text-4">{module.version}{module.replace ? ` ⇒ ${module.replace}` : ''}</span></li>)}</ul>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
