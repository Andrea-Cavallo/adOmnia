import { useState } from 'react'
import { GitCompareArrows, GitMerge, ShieldCheck } from 'lucide-react'
import { compareAgentTaskWorkspace, integrateAgentTaskWorkspace, type AgentTask, type AgentWorkspaceComparison, type AgentWorkspaceIntegration } from '@/lib/agent-task-api'
import { confirm } from '@/lib/confirmDialog'
import { CodeStudioAlert, CodeStudioButton } from './CodeStudioModal'

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** Which verifications measured exactly the content that would be integrated. */
export function verificationCoverage(task: AgentTask, fingerprint: string): { passed: number; total: number } {
  const verifications = task.verifications ?? []
  const passed = verifications.filter((verification) => {
    const last = [...(task.evidences ?? [])].reverse().find((evidence) => evidence.verificationId === verification.id)
    return last?.outcome === 'passed' && last.diffFingerprint === fingerprint
  }).length
  return { passed, total: verifications.length }
}

function FileList({ files }: { files: string[] }) {
  return <ul className="max-h-24 overflow-auto font-mono text-[10px] text-text-3">{files.map((file) => <li key={file} className="truncate" title={file}>{file}</li>)}</ul>
}

function IntegrationResult({ result }: { result: AgentWorkspaceIntegration }) {
  if (!result.applied) return <CodeStudioAlert tone="warning">{result.checked ? 'The changes would not apply.' : 'Nothing was integrated.'} {result.output}</CodeStudioAlert>
  if (result.conflicts?.length) return <CodeStudioAlert tone="warning">Integrated into {result.targetBranch} with {plural(result.conflicts.length, 'conflict')}. Resolve them in the Git panel; nothing was committed.<FileList files={result.conflicts} /></CodeStudioAlert>
  return <p className="text-[11px] text-success">{result.checked ? `The ${plural(result.files?.length ?? 0, 'file')} apply cleanly to ${result.targetBranch}.` : `${plural(result.files?.length ?? 0, 'file')} staged in ${result.targetBranch}. Nothing was committed.`}</p>
}

/** Compare the task workspace with the project branch and integrate it, staged and never committed. */
export function CodeStudioAgentTaskIntegration({ task, disabled }: { task: AgentTask; disabled: boolean }) {
  const [comparison, setComparison] = useState<AgentWorkspaceComparison | null>(null)
  const [result, setResult] = useState<AgentWorkspaceIntegration | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const recorded = task.workspace?.integration
  const act = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }
  const compare = () => act(async () => { setResult(null); setComparison(await compareAgentTaskWorkspace(task.id)) })
  const check = () => act(async () => setResult(await integrateAgentTaskWorkspace(task.id, true)))
  const integrate = () => act(async () => {
    if (!comparison) return
    const coverage = verificationCoverage(task, comparison.fingerprint)
    const ok = await confirm({
      title: `Integrate into ${comparison.targetBranch}`,
      message: `${plural(comparison.changedFiles.length, 'file')} will be applied to the project with a 3-way merge and staged. Nothing is committed. ${coverage.total ? `${coverage.passed} of ${coverage.total} verifications passed on this exact content.` : 'This task has no verifications.'}`,
      confirmLabel: 'Integrate',
    })
    if (!ok) return
    setResult(await integrateAgentTaskWorkspace(task.id, false))
    setComparison(null)
  })
  const coverage = comparison ? verificationCoverage(task, comparison.fingerprint) : null
  const blocked = disabled || busy

  return <div className="flex flex-col gap-2 rounded border border-border-1 p-2">
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex-1 text-[11px] text-text-2">Integration</span>
      <CodeStudioButton small icon={GitCompareArrows} loading={busy && !comparison} disabled={blocked} title={disabled ? 'Wait for the agent and the verifications to finish' : 'Compare the workspace with the project branch'} onClick={() => void compare()}>Compare</CodeStudioButton>
    </div>
    {error && <CodeStudioAlert>{error}</CodeStudioAlert>}
    {comparison && <div className="flex flex-col gap-1 text-[11px]">
      <p className="text-text-2">{comparison.changedFiles.length ? `${plural(comparison.changedFiles.length, 'file')} changed by the task` : 'The workspace has no changes.'} · {comparison.targetBranch} received {plural(comparison.targetCommits, 'commit')} since the start</p>
      {coverage && coverage.total > 0 && <p className={`flex items-center gap-1 ${coverage.passed === coverage.total ? 'text-success' : 'text-warning'}`}><ShieldCheck size={12} />{coverage.passed} of {coverage.total} verifications passed on this exact content{coverage.passed < coverage.total ? ': run them again before integrating' : ''}</p>}
      {comparison.overlaps.length > 0 && <CodeStudioAlert tone="warning">Also changed on {comparison.targetBranch} after the start, conflicts are likely:<FileList files={comparison.overlaps} /></CodeStudioAlert>}
      {comparison.localOverlaps.length > 0 && <CodeStudioAlert tone="warning">These files have uncommitted changes in the project; Git refuses the integration if they differ from the index:<FileList files={comparison.localOverlaps} /></CodeStudioAlert>}
      {comparison.changedFiles.length > 0 && <div className="flex flex-wrap gap-2">
        <CodeStudioButton small disabled={blocked} title="Check that the changes apply, without changing anything" onClick={() => void check()}>Check</CodeStudioButton>
        <CodeStudioButton small variant="primary" icon={GitMerge} disabled={blocked} title={`Apply the changes to ${comparison.targetBranch}, staged and not committed`} onClick={() => void integrate()}>Integrate into {comparison.targetBranch}</CodeStudioButton>
      </div>}
    </div>}
    {result && <IntegrationResult result={result} />}
    {!result && recorded?.applied && <p className="text-[10px] text-text-4">Last integrated into {recorded.targetBranch} · {plural(recorded.files?.length ?? 0, 'file')}{recorded.conflicts?.length ? ` · ${plural(recorded.conflicts.length, 'conflict')}` : ''} · {new Date(recorded.at).toLocaleString()}</p>}
  </div>
}
