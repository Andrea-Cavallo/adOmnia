import { useMemo, useState } from 'react'
import { Download, Pencil, Play, Square } from 'lucide-react'
import type { AgentTask } from '@/lib/agent-task-api'
import type { GoIDESession } from '@/lib/code-studio-api'
import { prepareStudioChat } from '@/lib/code-studio/studioChatContext'
import { downloadText } from '@/lib/fileUtils'
import { useAgentTaskStore } from '@/stores/agentTasks'
import { useAgentReviewStore } from '@/stores/codeStudioAgentReview'
import { useClaudeCodeStore } from '@/stores/claudeCode'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { usePiAgentStore } from '@/stores/piAgent'
import { useMilkStore } from '@/stores/milk'
import { agentTaskDraft, agentTaskMessage, agentTaskReceipt, type AgentTaskPreview } from './agentTaskComposer'
import { selectedRange } from './CodeStudioCopilotChat'
import { CodeStudioAlert, CodeStudioButton } from './CodeStudioModal'

interface Props {
  session: GoIDESession
  document: GoIDEEditorDocument | null
  task: AgentTask
  onEdit: () => void
}

const activeStatus = (task: AgentTask) => ['running', 'waiting_permission', 'stopping'].includes(task.status)

export function CodeStudioAgentTaskDetail({ session, document, task, onEdit }: Props) {
  const root = session.project.realPath
  const [includeDocument, setIncludeDocument] = useState(true)
  const [includeWorkspace, setIncludeWorkspace] = useState(true)
  const [includeRules, setIncludeRules] = useState(true)
  const [includeUnsaved, setIncludeUnsaved] = useState(false)
  const [preview, setPreview] = useState<(AgentTaskPreview & { signature: string }) | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [actionError, setActionError] = useState('')
  const [attemptChoice, setAttemptChoice] = useState('')
  const busy = useAgentTaskStore((state) => state.busyById[task.id])
  const milkStatus = useMilkStore((state) => state.status)
  const claudeStatus = useClaudeCodeStore((state) => state.status)
  const milkPermissions = useMilkStore((state) => state.permissions)
  const claudePermissions = useClaudeCodeStore((state) => state.permissions)
  const piStatus = usePiAgentStore(state => state.status)
  const piPermissions = usePiAgentStore(state => state.permissions)
  const status = task.agent === 'pi' ? piStatus : task.agent === 'claude' ? claudeStatus : milkStatus
  const ready = status?.state === 'ready'
  const active = activeStatus(task)
  const signature = useMemo(() => agentTaskMessage(agentTaskDraft(task)), [task])
  const previewValid = preview?.signature === signature
  const attempt = task.attempts.find((item) => item.id === attemptChoice) ?? task.attempts[task.attempts.length - 1]
  const events = useMemo(() => attempt?.events ?? [], [attempt])
  const text = events.filter((event) => event.kind === 'text').map((event) => event.message ?? '').join('')
  const thought = events.filter((event) => event.kind === 'thought').map((event) => event.message ?? '').join('')
  const plan = [...events].reverse().find((event) => event.plan?.length)?.plan
  const tools = events.filter((event) => event.kind === 'tool')
  const notices = events.filter((event) => ['lifecycle', 'error', 'warning', 'route', 'end'].includes(event.kind))
  const permissions = (task.agent === 'pi' ? piPermissions : task.agent === 'claude' ? claudePermissions : milkPermissions).filter((permission) => permission.sessionKey === task.activeAttemptId)

  const invalidate = (change: () => void) => { change(); setPreview(null); setActionError('') }
  const makePreview = async () => {
    setPreviewing(true); setActionError('')
    try {
      const prepared = await prepareStudioChat(root, signature, {
        documentId: document?.document.id,
        selection: includeDocument ? selectedRange(document) : null,
        includeDocument,
        includeWorkspace,
        includeRules,
        includeUnsaved,
        additionalPaths: task.paths,
        maxContextBytes: task.limits.maxContextBytes,
      }, false, false) as AgentTaskPreview
      setPreview({ ...prepared, signature })
    } catch (error) {
      setPreview(null)
      setActionError(error instanceof Error ? error.message : String(error))
    } finally { setPreviewing(false) }
  }
  const start = async () => {
    if (!preview || !previewValid || !ready) return
    setActionError('')
    try {
      await useAgentTaskStore.getState().start(task.id, preview.message, agentTaskReceipt(preview))
      setPreview(null)
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)) }
  }
  const exportTask = async () => {
    setActionError('')
    try { downloadText(`agent-${task.id}.json`, await useAgentTaskStore.getState().export(task.id), 'application/json') }
    catch (error) { setActionError(error instanceof Error ? error.message : String(error)) }
  }
  const respondPermission = (requestId: string, allow: boolean) => {
    void (task.agent === 'pi' ? usePiAgentStore.getState().respondPermission(requestId, allow) : task.agent === 'claude'
      ? useClaudeCodeStore.getState().respondPermission(requestId, allow)
      : useMilkStore.getState().respondPermission(requestId, allow))
  }

  return <div className="agent-task-detail flex flex-col gap-3">
    <header className="flex items-start gap-2">
      <div className="min-w-0 flex-1"><h2 className="break-words text-[13px] font-semibold">{task.objective}</h2><p className="mt-1 text-[11px] text-text-3" role="status" aria-live="polite">{task.agent === 'pi' ? 'Pi' : task.agent === 'claude' ? 'Claude Code' : task.agent} · {task.status.replace(/_/g, ' ')} · {task.intent}</p></div>
      <button type="button" className="code-studio-icon-button h-7 w-7" disabled={active} title="Edit task" aria-label="Edit task" onClick={onEdit}><Pencil size={13} /></button>
      <button type="button" className="code-studio-icon-button h-7 w-7" disabled={busy} title="Export task" aria-label="Export task" onClick={() => void exportTask()}><Download size={13} /></button>
    </header>
    {actionError && <CodeStudioAlert>{actionError}</CodeStudioAlert>}
    {!ready && !active && <CodeStudioAlert tone="warning">The selected agent is not ready. Open its provider tab to check configuration, then return to this task.</CodeStudioAlert>}
    <p className="text-[11px] text-text-3">The agent works directly in this project's working tree. Only one task per project can run at a time; its changes appear in Review changes. Worktree isolation and Docker sandboxing are not available yet.</p>

    <section className="agent-task-section flex flex-col gap-2">
      <h3 className="gs-section-title">Context and attempt</h3>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <label className="gs-check"><input type="checkbox" checked={includeDocument} disabled={!document || active} onChange={(event) => invalidate(() => setIncludeDocument(event.target.checked))} />Active file</label>
        <label className="gs-check"><input type="checkbox" checked={includeWorkspace} disabled={active} onChange={(event) => invalidate(() => setIncludeWorkspace(event.target.checked))} />Workspace</label>
        <label className="gs-check"><input type="checkbox" checked={includeRules} disabled={active} onChange={(event) => invalidate(() => setIncludeRules(event.target.checked))} />Project rules</label>
        <label className="gs-check"><input type="checkbox" checked={includeUnsaved} disabled={active} onChange={(event) => invalidate(() => setIncludeUnsaved(event.target.checked))} />Unsaved changes</label>
      </div>
      <div className="flex flex-wrap gap-2">
        <CodeStudioButton small loading={previewing} disabled={active} onClick={() => void makePreview()}>Preview context</CodeStudioButton>
        {active ? <CodeStudioButton small variant="danger" icon={Square} loading={busy || task.status === 'stopping'} onClick={() => void useAgentTaskStore.getState().stop(task.id).catch(() => undefined)}>Stop</CodeStudioButton>
          : <CodeStudioButton small variant="primary" icon={Play} loading={busy} disabled={!previewValid || !ready} title={!previewValid ? 'Preview the current context first' : !ready ? 'The selected agent is not ready' : undefined} onClick={() => void start()}>{task.attempts.length ? 'Start new attempt' : 'Start task'}</CodeStudioButton>}
        <CodeStudioButton small onClick={() => useAgentReviewStore.getState().open(root)}>Review changes</CodeStudioButton>
      </div>
      {!previewValid && !active && <p className="text-[11px] text-text-3">Preview is required for every new attempt. Changes to the draft or context options invalidate it.</p>}
      {preview && previewValid && <div className="gs-surface flex min-h-0 flex-col gap-2 p-2">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-3"><span>{preview.bytes} bytes</span><span>{preview.sources.filter((item) => !item.excluded).length} sources</span><span>{preview.excludedPaths.length} excluded</span>{preview.truncated && <span>Truncated</span>}{preview.includesUnsaved && <span>Includes unsaved changes</span>}</div>
        <pre className="milk-output agent-task-preview">{preview.message}</pre>
        <ul className="text-[11px] text-text-3">{preview.sources.map((item) => <li key={`${item.kind}-${item.label}`} className="break-words">{item.excluded ? 'Excluded: ' : ''}{item.label}{item.unsaved ? ' (unsaved)' : ''}{item.truncated ? ' (truncated)' : ''}</li>)}</ul>
      </div>}
    </section>

    {permissions.map((permission) => <div key={permission.requestId} className="milk-permission" role="alertdialog" aria-label="Task tool permission"><p className="milk-permission-title">{permission.title || 'The agent requests tool access'}</p>{permission.description && <p className="milk-permission-detail">{permission.description}</p>}<div className="milk-permission-actions"><CodeStudioButton small variant="primary" onClick={() => respondPermission(permission.requestId, true)}>Allow</CodeStudioButton><CodeStudioButton small onClick={() => respondPermission(permission.requestId, false)}>Deny</CodeStudioButton></div></div>)}

    {task.attempts.length > 0 && <section className="agent-task-section flex flex-col gap-2">
      <div className="flex items-center gap-2"><h3 className="gs-section-title flex-1">Attempt output</h3><select aria-label="Attempt" className="gs-input h-7 w-auto text-[11px]" value={attempt?.id ?? ''} onChange={(event) => setAttemptChoice(event.target.value)}>{[...task.attempts].reverse().map((item, index) => <option key={item.id} value={item.id}>Attempt {task.attempts.length - index} · {item.status.replace(/_/g, ' ')}</option>)}</select></div>
      {attempt?.error && <CodeStudioAlert>{attempt.error}</CodeStudioAlert>}
      {attempt?.prompt && <details className="milk-thought"><summary>Approved prompt</summary><pre className="milk-output agent-task-preview">{attempt.prompt}</pre></details>}
      {!!plan?.length && <details className="milk-thought" open><summary>Plan · {plan.filter((item) => item.status === 'completed').length}/{plan.length}</summary><ol className="flex flex-col gap-1 py-2">{plan.map((item) => <li key={`${item.content}-${item.status}`} className="text-[11px]"><span className="text-text-3">{item.status.replace(/_/g, ' ')}: </span>{item.content}</li>)}</ol></details>}
      {!!tools.length && <ul className="milk-tools" aria-label="Task tool calls">{tools.map((event) => <li key={event.id}><details><summary><span className="milk-tool-name">{event.toolName || 'Tool'}</span><span className="milk-tool-status">{event.toolStatus}</span></summary>{event.message && <pre className="milk-output">{event.message}</pre>}</details></li>)}</ul>}
      {thought && <details className="milk-thought"><summary>Reasoning</summary><p>{thought}</p></details>}
      {text ? <pre className="milk-output agent-task-stream">{text}</pre> : <p className="text-[11px] text-text-3">No text output in this attempt yet.</p>}
      {!!notices.length && <ul className="flex flex-col gap-1 text-[11px] text-text-3">{notices.map((event) => <li key={event.id}>{event.kind}: {event.message}</li>)}</ul>}
    </section>}
  </div>
}
