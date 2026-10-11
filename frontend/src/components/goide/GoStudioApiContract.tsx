import { useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import * as GoIDE from '../../../bindings/adomnia/goide'
import type { APIContractReport } from '../../../bindings/adomnia/internal/goide/models'
import type { Issue } from '../../../bindings/adomnia/internal/ide/apicontract/models'
import { useGoIDEStore } from '@/stores/goide'

const KIND_LABEL: Record<string, string> = {
  undocumented: 'Served but not documented', unimplemented: 'Documented but not implemented', 'type-mismatch': 'Field type differs',
  'field-missing-in-contract': 'Field missing in the contract', 'field-missing-in-code': 'Field missing in the code', 'required-mismatch': 'Required differs',
  'removed-operation': 'Removed operations', 'added-operation': 'New operations', 'removed-field': 'Removed fields', 'added-field': 'New fields',
  'type-changed': 'Field types changed', 'became-required': 'Fields that became required',
}

function IssueGroups({ issues }: { issues: Issue[] }) {
  const groups = issues.reduce<Record<string, Issue[]>>((all, issue) => ({ ...all, [issue.kind]: [...(all[issue.kind] ?? []), issue] }), {})
  return (
    <>
      {Object.entries(groups).map(([kind, items]) => (
        <section key={kind} className="mb-2">
          <h4 className="px-1 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">{KIND_LABEL[kind] ?? kind} · {items.length}</h4>
          <ul>
            {items.map((issue, index) => (
              <li key={`${issue.message}-${index}`}>
                <button type="button" disabled={!issue.file} onClick={() => issue.file && void useGoIDEStore.getState().openLocation(issue.file, issue.line || 1)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-surface-3 disabled:cursor-default">
                  {issue.breaking && <span className="shrink-0 rounded bg-danger/15 px-1 text-[9.5px] font-semibold text-danger">BREAKING</span>}
                  <span className="min-w-0 flex-1 truncate text-text-2" title={issue.message}>{issue.message}</span>
                  {issue.file && <span className="shrink-0 font-mono text-[10px] text-text-4">{issue.file}:{issue.line}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}

/** API Contract Drift: routes and DTOs of the code against the OpenAPI contract, and against another revision. */
export function GoStudioApiContract({ sessionId }: { sessionId: string }) {
  const [report, setReport] = useState<APIContractReport | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [base, setBase] = useState('main')
  const [diff, setDiff] = useState<Issue[] | null>(null)
  const [comparing, setComparing] = useState(false)
  const check = async () => {
    setRunning(true)
    setError(null)
    try { setReport(await GoIDE.APIContractDrift(sessionId)) } catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)) } finally { setRunning(false) }
  }
  const compare = async () => {
    setComparing(true)
    setError(null)
    try { setDiff((await GoIDE.CompareAPI(sessionId, base.trim())) ?? []) } catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)) } finally { setComparing(false) }
  }
  useEffect(() => { void check() }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps
  const breaking = (diff ?? []).filter((issue) => issue.breaking).length
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-1 px-2 py-1 text-text-3">
        <button type="button" onClick={() => void check()} disabled={running} className="flex h-6 items-center gap-1 rounded px-1.5 hover:bg-surface-3 disabled:opacity-50">{running ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}Check</button>
        {report && (report.contract
          ? <button type="button" onClick={() => void useGoIDEStore.getState().openLocation(report.contract, 1)} className="text-accent hover:underline">{report.contract}</button>
          : <span className="text-text-4">No OpenAPI file found (openapi.yaml, swagger.json…)</span>)}
        {report && <span className="text-text-4">{report.operations} routes in the code · {report.documented} documented</span>}
        <span className="ml-auto flex items-center gap-1">
          <label htmlFor="api-base" className="text-text-4">API changes since</label>
          <input id="api-base" value={base} onChange={(event) => setBase(event.target.value)} className="h-6 w-28 rounded border border-border-1 bg-surface-2 px-1.5 font-mono text-text-1 outline-none focus:border-accent" />
          <button type="button" onClick={() => void compare()} disabled={comparing || !base.trim()} className="flex h-6 items-center gap-1 rounded px-1.5 text-accent hover:bg-accent/10 disabled:opacity-50">{comparing && <Loader2 size={11} className="animate-spin" />}Diff</button>
        </span>
      </div>
      {error && <p className="shrink-0 border-b border-danger/30 bg-danger/10 px-2 py-1 text-danger">{error}</p>}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {diff && (
          <section aria-label="API diff" className="mb-3 rounded-md border border-border-1 p-2">
            <h4 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">Since {base} · {diff.length} changes · {breaking} breaking</h4>
            {diff.length === 0 ? <p className="text-text-4">The API did not change.</p> : <IssueGroups issues={diff} />}
          </section>
        )}
        {report?.contract && (report.issues.length === 0 ? <p className="p-1 text-text-3">Routes and DTOs match {report.contract}.</p> : <IssueGroups issues={report.issues} />)}
      </div>
    </div>
  )
}
