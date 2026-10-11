import { useEffect, useState } from 'react'
import { FilePlus2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import * as GoIDE from '../../../bindings/adomnia/goide'
import type { DriftReport } from '../../../bindings/adomnia/internal/ide/graph/models'
import type { ArchitectureDiff } from '../../../bindings/adomnia/internal/goide/models'
import { useGoIDEStore } from '@/stores/goide'

const RULE_LABEL: Record<string, string> = {
  layer: 'Layer dependency', 'forbidden-import': 'Forbidden import', domain: 'Domain boundary', service: 'Service boundary', database: 'DB access outside repository', broker: 'Broker call outside allowed layers', cycle: 'Import cycle',
}

/** Architectural drift: the rules in .adomnia/architecture.json checked against the workspace graph. */
export function GoStudioArchitectureRules({ sessionId }: { sessionId: string }) {
  const [report, setReport] = useState<DriftReport | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [base, setBase] = useState('main')
  const [diff, setDiff] = useState<ArchitectureDiff | null>(null)
  const [comparing, setComparing] = useState(false)
  const compare = async () => {
    setComparing(true)
    setError(null)
    try { setDiff(await GoIDE.CompareArchitecture(sessionId, base.trim())) } catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)) } finally { setComparing(false) }
  }
  const check = async () => {
    setRunning(true)
    setError(null)
    try { setReport(await GoIDE.ArchitectureDrift(sessionId)) } catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)) } finally { setRunning(false) }
  }
  useEffect(() => { void check() }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps
  const createRules = async () => {
    try {
      const path = await GoIDE.CreateArchitectureRules(sessionId)
      await useGoIDEStore.getState().openLocation(path, 1)
      await check()
    } catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)) }
  }
  const violations = report?.violations ?? []
  const byRule = violations.reduce<Record<string, typeof violations>>((groups, violation) => ({ ...groups, [violation.rule]: [...(groups[violation.rule] ?? []), violation] }), {})
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-1 px-2 py-1 text-text-3">
        <button type="button" onClick={() => void check()} disabled={running} className="flex h-6 items-center gap-1 rounded px-1.5 hover:bg-surface-3 disabled:opacity-50">{running ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}Check</button>
        {report && (report.rulesFound
          ? <button type="button" onClick={() => void useGoIDEStore.getState().openLocation('.adomnia/architecture.json', 1)} className="text-accent hover:underline">.adomnia/architecture.json</button>
          : <button type="button" onClick={() => void createRules()} className="flex items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 text-accent hover:bg-accent/25"><FilePlus2 size={11} />Create architecture rules</button>)}
        <span className="ml-auto flex items-center gap-1">
          <label className="text-text-4" htmlFor="arch-base">Compare with</label>
          <input id="arch-base" value={base} onChange={(event) => setBase(event.target.value)} placeholder="branch, tag or commit" className="h-6 w-28 rounded border border-border-1 bg-surface-2 px-1.5 font-mono text-text-1 outline-none focus:border-accent" />
          <button type="button" onClick={() => void compare()} disabled={comparing || !base.trim()} title="Check out that revision in a temporary worktree, analyze it with today's rules and show what changed" className="flex h-6 items-center gap-1 rounded px-1.5 text-accent hover:bg-accent/10 disabled:opacity-50">{comparing ? <Loader2 size={11} className="animate-spin" /> : null}Diff</button>
        </span>
        {report && <span className="text-text-4">{report.packages} packages{Object.keys(report.layers ?? {}).length ? ` · ${Object.entries(report.layers).map(([layer, count]) => `${count} ${layer}`).join(' · ')}` : ''}{report.unassigned?.length ? ` · ${report.unassigned.length} in no layer` : ''}</span>}
      </div>
      {error && <p className="shrink-0 border-b border-danger/30 bg-danger/10 px-2 py-1 text-danger">{error}</p>}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {diff && (
          <section aria-label="Architecture diff" className="mb-3 rounded-md border border-border-1 p-2">
            <h4 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">Since {diff.base} · {diff.newViolations.length} new · {diff.fixedViolations.length} fixed · {diff.addedImports.length} imports added · {diff.removedImports.length} removed</h4>
            {diff.newViolations.map((violation, index) => <p key={`n${index}`} className="truncate text-danger" title={violation.message}>+ {violation.message}</p>)}
            {diff.fixedViolations.map((violation, index) => <p key={`f${index}`} className="truncate text-success" title={violation.message}>− {violation.message}</p>)}
            {diff.addedImports.slice(0, 30).map((edge) => <p key={`a${edge}`} className="truncate font-mono text-[10.5px] text-text-2">+ {edge}</p>)}
            {diff.removedImports.slice(0, 30).map((edge) => <p key={`r${edge}`} className="truncate font-mono text-[10.5px] text-text-4">− {edge}</p>)}
            {!!diff.problems?.length && <p className="text-warning" title={diff.problems.join(String.fromCharCode(10))}>{diff.problems.length} load problem(s) in {diff.base}</p>}
          </section>
        )}
        {report && violations.length === 0 && (
          <p className="flex items-center gap-2 p-2 text-text-3"><ShieldCheck size={14} className="text-success" />{report.rulesFound ? 'The code follows the architecture rules.' : 'No import cycles. Create architecture rules to check layers, forbidden imports, domain boundaries and where DB and broker calls may live.'}</p>
        )}
        {Object.entries(byRule).map(([rule, items]) => (
          <section key={rule} className="mb-2">
            <h4 className="px-1 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">{RULE_LABEL[rule] ?? rule} · {items.length}</h4>
            <ul>
              {items.map((violation, index) => (
                <li key={`${violation.message}-${index}`}>
                  <button type="button" disabled={!violation.file} onClick={() => violation.file && void useGoIDEStore.getState().openLocation(violation.file, violation.line || 1)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-surface-3 disabled:cursor-default">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-text-2" title={violation.message}>{violation.message}</span>
                    {violation.file && <span className="shrink-0 font-mono text-[10px] text-text-4">{violation.file}{violation.line ? `:${violation.line}` : ''}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
