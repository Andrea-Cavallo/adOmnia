import { useEffect, useState } from 'react'
import { GitBranch, GitFork, Trash2 } from 'lucide-react'
import * as GitSync from '@/wailsjs/go/main/GitSync'
import type { AgentTask } from '@/lib/agent-task-api'
import { confirm } from '@/lib/confirmDialog'
import { useAgentTaskStore } from '@/stores/agentTasks'
import { useAgentReviewStore } from '@/stores/codeStudioAgentReview'
import { CodeStudioAlert, CodeStudioButton, CodeStudioField } from './CodeStudioModal'

const isActive = (task: AgentTask) => ['running', 'waiting_permission', 'stopping'].includes(task.status)

interface WorkspaceStatus { dirty?: boolean; modified?: string[]; untracked?: string[] }

/** Isolated workspace: the agent changes a Git worktree, never the project's working tree. */
export function CodeStudioAgentTaskWorkspace({ task }: { task: AgentTask }) {
  const busy = useAgentTaskStore((state) => state.busyById[task.id])
  const [baseRef, setBaseRef] = useState('HEAD')
  const [error, setError] = useState('')
  const [status, setStatus] = useState<WorkspaceStatus | null>(null)
  const [projectStatus, setProjectStatus] = useState<WorkspaceStatus | null>(null)
  const [includeLocal, setIncludeLocal] = useState(false)
  const active = isActive(task)
  const workspace = task.workspace

  // Lo stato delle modifiche viene dal servizio Git già esistente, non da una copia UI.
  useEffect(() => {
    if (!workspace || workspace.state !== 'ready') {
      setStatus(null)
      return
    }
    let live = true
    void GitSync.GetStatus(workspace.path)
      .then((raw) => { if (live) setStatus(JSON.parse(raw) as WorkspaceStatus) })
      .catch(() => { if (live) setStatus(null) })
    return () => { live = false }
  }, [workspace, task.updatedAt])

  // Prima della creazione: le modifiche locali del progetto vengono dichiarate, mai copiate in silenzio.
  useEffect(() => {
    if (workspace) {
      setProjectStatus(null)
      return
    }
    let live = true
    void GitSync.GetStatus(task.root)
      .then((raw) => { if (live) setProjectStatus(JSON.parse(raw) as WorkspaceStatus) })
      .catch(() => { if (live) setProjectStatus(null) })
    return () => { live = false }
  }, [workspace, task.root, task.updatedAt])
  const localModified = projectStatus?.modified?.length ?? 0
  const localUntracked = projectStatus?.untracked?.length ?? 0
  const fromHead = (baseRef.trim() || 'HEAD') === 'HEAD'

  const create = async () => {
    setError('')
    try {
      await useAgentTaskStore.getState().createWorkspace(task.id, baseRef.trim() || 'HEAD', includeLocal && fromHead && localModified > 0)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const remove = async () => {
    const ok = await confirm({
      title: 'Remove the isolated workspace',
      message: 'The worktree folder is removed only when Git accepts it. Uncommitted changes block the removal and nothing is discarded.',
      confirmLabel: 'Remove workspace',
      variant: 'danger',
    })
    if (!ok) return
    setError('')
    try {
      await useAgentTaskStore.getState().removeWorkspace(task.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return <section className="agent-task-section flex flex-col gap-2" aria-label="Isolated workspace">
    <div className="flex items-center gap-2">
      <h3 className="gs-section-title flex-1">Isolated workspace</h3>
      {workspace && <span className="gs-badge" title={workspace.state === 'ready' ? 'The workspace exists' : workspace.notice}>{workspace.state}</span>}
    </div>
    {error && <CodeStudioAlert>{error}</CodeStudioAlert>}
    {!workspace ? <>
      <p className="text-[11px] text-text-3">
        Without a workspace the agent writes in this project&apos;s working tree. An isolated workspace is a Git worktree created from the commit you choose; your local changes are not copied into it.
      </p>
      {projectStatus?.dirty && <div className="flex flex-col gap-1 rounded border border-border-1 p-2 text-[11px]">
        <p className="text-text-2">The project has {localModified} modified and {localUntracked} untracked file{localModified + localUntracked === 1 ? '' : 's'} not committed. They stay in the project and are not copied unless you choose to.</p>
        <label className="flex items-center gap-2 text-text-2" title={!fromHead ? 'Local changes are relative to the current commit: start from HEAD to include them' : localModified === 0 ? 'Only changes to tracked files can be included' : undefined}>
          <input type="checkbox" checked={includeLocal && fromHead && localModified > 0} disabled={!fromHead || localModified === 0 || active || busy} onChange={(event) => setIncludeLocal(event.target.checked)} />
          Include the {localModified} modified tracked file{localModified === 1 ? '' : 's'} in the workspace (untracked files are not copied)
        </label>
      </div>}
      <div className="flex flex-wrap items-end gap-2">
        <CodeStudioField label="Start from" hint="Commit, branch or tag">
          <input className="gs-input h-7 w-40 font-mono text-[11px]" value={baseRef} disabled={active || busy} onChange={(event) => setBaseRef(event.target.value)} aria-label="Starting reference for the isolated workspace" />
        </CodeStudioField>
        <CodeStudioButton small icon={GitFork} loading={busy} disabled={active} title={active ? 'Stop the task first' : 'Create a Git worktree for this task'} onClick={() => void create()}>Create workspace</CodeStudioButton>
      </div>
    </> : <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-text-3">Branch</dt><dd className="min-w-0 truncate font-mono" title={workspace.branch}>{workspace.branch}</dd>
        <dt className="text-text-3">From</dt><dd className="min-w-0 truncate font-mono" title={`${workspace.baseRef} ${workspace.baseSha ?? ''}`}>{workspace.baseRef} · {workspace.baseSha ? workspace.baseSha.slice(0, 8) : 'unresolved'}</dd>
        <dt className="text-text-3">Folder</dt><dd className="min-w-0 truncate font-mono" title={workspace.path}>{workspace.path}</dd>
        <dt className="text-text-3">Repository</dt><dd className="min-w-0 truncate font-mono" title={workspace.repository}>{workspace.repository}</dd>
        {!!workspace.includedLocalChanges && <><dt className="text-text-3">Included</dt><dd className="min-w-0 truncate">{workspace.includedLocalChanges} file{workspace.includedLocalChanges === 1 ? '' : 's'} with local changes copied from the project</dd></>}
        <dt className="text-text-3">Changes</dt><dd className="min-w-0 truncate">{status ? status.dirty ? `${status.modified?.length ?? 0} modified · ${status.untracked?.length ?? 0} untracked` : 'Clean working tree' : 'Unavailable'}</dd>
      </dl>
      {workspace.state === 'missing' && <CodeStudioAlert tone="warning">{workspace.notice || 'The workspace folder no longer exists. The task is kept; the agent cannot work in it.'}</CodeStudioAlert>}
      <div className="flex flex-wrap gap-2">
        <CodeStudioButton small icon={GitBranch} disabled={active || busy} title={active ? 'Stop the task first' : 'Review the changes made in this workspace'} onClick={() => useAgentReviewStore.getState().open(workspace.path)}>Workspace changes</CodeStudioButton>
        <CodeStudioButton small variant="danger" icon={Trash2} disabled={active || busy} title={active ? 'Stop the task first' : 'Remove the isolated folder'} onClick={() => void remove()}>Remove</CodeStudioButton>
      </div>
    </div>}
  </section>
}
