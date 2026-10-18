import { useCodeStudioStore } from '@/stores/codeStudio'
import { readRunHistory } from '@/lib/code-studio/codeStudioRunHistory'
import type { GoIDERunConfiguration } from '@/lib/code-studio-api'
export function CodeStudioRunConfigHistory({ draft }: { draft: GoIDERunConfiguration }) {
  const projectPath = useCodeStudioStore(state => state.sessions.find(session => session.id === draft.sessionId)?.project.realPath ?? '')
  const history = draft.id ? readRunHistory(projectPath, draft.id).slice(0, 8) : []
  if (!history.length) return null
  return <details className="rounded-md border border-border-1 p-3"><summary className="gs-label cursor-pointer">Recent runs</summary>
    <ul className="gs-list mt-2">{history.map(entry => <li key={`${entry.startedAt}-${entry.command}`} className="gs-list-row text-[12px]" title={entry.command}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${entry.exitCode === 0 ? 'bg-success' : entry.status === 'exited' ? 'bg-danger' : 'bg-text-4'}`} />
      <span>{new Date(entry.startedAt).toLocaleString()}</span><span className="text-text-4">{entry.exitCode === null ? entry.status : `exit ${entry.exitCode}`}</span>
    </li>)}</ul>
  </details>
}
