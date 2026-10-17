import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import * as GoIDE from '../../../bindings/adomnia/goide'
import type { PackageHeatmap } from '../../../bindings/adomnia/internal/goide/models'
import { dependencyHeatmap } from '@/lib/code-studio/dependencyHeatmap'
import { useCodeStudioRuntimeProfile } from '@/stores/codeStudioRuntimeProfile'

/** Live Dependency Heatmap: static coupling and blast radius of each package, heated by the last loaded profile. */
export function CodeStudioDependencyHeatmap({ sessionId, query }: { sessionId: string; query: string }) {
  const [data, setData] = useState<PackageHeatmap | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runtime = useCodeStudioRuntimeProfile((state) => state.packages[sessionId] ?? null)
  useEffect(() => {
    let cancelled = false
    GoIDE.PackageHeatmap(sessionId).then((result) => { if (!cancelled) setData(result) }, (problem) => { if (!cancelled) setError(problem instanceof Error ? problem.message : String(problem)) })
    return () => { cancelled = true }
  }, [sessionId])
  const heat = useMemo(() => (data ? dependencyHeatmap({ packages: data.packages ?? [], imports: (data.imports ?? []) as Array<[string, string]> }, runtime) : null), [data, runtime])
  if (error) return <p className="p-3 text-danger">{error}</p>
  if (!heat) return <p className="flex items-center gap-2 p-3 text-text-3"><Loader2 size={12} className="animate-spin" />Measuring packages…</p>
  const needle = query.trim().toLowerCase()
  const rows = heat.rows.filter((row) => !needle || row.package.toLowerCase().includes(needle))
  const maxCoupling = Math.max(1, ...heat.rows.map((row) => row.coupling))
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      <p className="mb-2 text-text-4">{runtime ? `Heat from ${runtime.profile} (${runtime.metric}): where the program actually spends it.` : 'Load a CPU or memory profile in Performance Studio to heat this map with runtime data.'} Coupling = importers × imports; blast radius = packages that depend on it, directly or not.</p>
      <table className="w-full text-left">
        <thead className="text-[10px] uppercase tracking-wide text-text-4">
          <tr><th className="py-1 font-semibold">Package</th>{runtime && <th className="font-semibold">Runtime</th>}<th className="font-semibold">Coupling</th><th className="font-semibold">In / out</th><th className="font-semibold">Blast radius</th><th className="font-semibold">Functions</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.package} className="border-t border-border-1">
              <td className="max-w-80 truncate py-1 font-mono text-text-1" title={row.package}>{row.package}</td>
              {runtime && (
                <td className="w-40">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 rounded-sm bg-danger" style={{ width: `${Math.max(2, (row.runtimeShare ?? 0) * 100)}px`, opacity: 0.25 + (row.runtimeShare ?? 0) * 0.75 }} aria-hidden="true" />
                    <span className="font-mono text-text-2">{((row.runtimeShare ?? 0) * 100).toFixed(1)}%</span>
                  </div>
                </td>
              )}
              <td className="w-32"><span className="inline-block h-2 rounded-sm bg-warning align-middle" style={{ width: `${Math.max(2, (row.coupling / maxCoupling) * 80)}px` }} aria-hidden="true" /> <span className="font-mono text-text-3">{row.coupling}</span></td>
              <td className="font-mono text-text-3">{row.fanIn} / {row.fanOut}</td>
              <td className="font-mono text-text-3">{row.blastRadius}</td>
              <td className="font-mono text-text-3">{row.functions}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {runtime && (
        <section className="mt-3">
          <h4 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">Static dependencies never crossed in {runtime.profile} · {heat.untraversed.length}</h4>
          {heat.untraversed.length === 0 ? <p className="text-text-4">Every import between project packages was crossed by a profiled call.</p>
            : <ul>{heat.untraversed.slice(0, 80).map((edge) => <li key={edge} className="truncate font-mono text-[10.5px] text-text-3">{edge}</li>)}</ul>}
        </section>
      )}
    </div>
  )
}
