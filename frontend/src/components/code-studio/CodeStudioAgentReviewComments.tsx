import { useMemo, useState } from 'react'
import { Check, CircleAlert, CircleSlash, MessageSquarePlus, RotateCcw, Trash2, Wrench, XCircle } from 'lucide-react'
import type { AgentReviewComment, AgentTask } from '@/lib/agent-task-api'
import type { AgentReviewFile } from '@/lib/code-studio-api'
import { confirm } from '@/lib/confirmDialog'
import { useAgentTaskStore } from '@/stores/agentTasks'

/** A line range chosen in the diff: one side only, so the excerpt is exactly what the user saw. */
export interface ReviewSelection {
  path: string
  side: 'new' | 'old'
  start: number
  end: number
}

/** The agent task whose workspace (or project, without workspace) is being reviewed. */
export function useReviewTask(root: string): AgentTask | undefined {
  const tasksByRoot = useAgentTaskStore((state) => state.tasksByRoot)
  return useMemo(() => Object.values(tasksByRoot).flat()
    .find((candidate) => (candidate.workspace?.state === 'ready' ? candidate.workspace.path : candidate.root) === root), [tasksByRoot, root])
}

/** Extends or starts a selection from a clicked line. */
export function nextSelection(current: ReviewSelection | null, path: string, side: 'new' | 'old', line: number, extend: boolean): ReviewSelection {
  if (extend && current && current.path === path && current.side === side) {
    return { path, side, start: Math.min(current.start, line), end: Math.max(current.end, line) }
  }
  return { path, side, start: line, end: line }
}

export function selectionExcerpt(file: AgentReviewFile, selection: ReviewSelection): string {
  const text = selection.side === 'new' ? file.current : file.baseline
  return text.replace(/\r\n/g, '\n').split('\n').slice(selection.start - 1, selection.end).join('\n')
}

const rangeLabel = (selection: { path: string; startLine?: number; endLine?: number; start?: number; end?: number }) => {
  const start = selection.startLine ?? selection.start ?? 0
  const end = selection.endLine ?? selection.end ?? start
  return `${selection.path}:${start}${end !== start ? `-${end}` : ''}`
}

/** Write a comment on the selected lines; optionally send it to the agent right away. */
export function ReviewCommentComposer({ task, file, selection, onDone }: { task: AgentTask; file: AgentReviewFile; selection: ReviewSelection; onDone: () => void }) {
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const busy = useAgentTaskStore((state) => !!state.busyById[task.id])
  const active = ['running', 'waiting_permission', 'stopping'].includes(task.status)
  const excerpt = selectionExcerpt(file, selection)
  const save = async (send: boolean) => {
    setError('')
    try {
      const store = useAgentTaskStore.getState()
      const updated = await store.addComment(task.id, { path: selection.path, side: selection.side, startLine: selection.start, endLine: selection.end, excerpt, body })
      const created = updated.comments?.[updated.comments.length - 1]
      if (send && created) {
        const ok = await confirm({
          title: 'Ask for correction',
          message: `The agent receives ${rangeLabel(selection)} (${selection.side === 'new' ? 'agent version' : 'version before the agent'}), the ${excerpt.split('\n').length} commented line(s) and your comment.`,
          confirmLabel: 'Send',
        })
        if (ok) await store.askCorrection(task.id, [], '', [created.id])
      }
      onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return <div className="sticky top-0 z-[2] flex flex-col gap-2 border-b border-border-1 bg-surface-1 p-2" aria-label="Comment on the selected lines">
    <p className="text-[11px] text-text-2">Comment on <span className="font-mono">{rangeLabel(selection)}</span> · {selection.side === 'new' ? 'agent version' : 'version before the agent'}</p>
    <textarea autoFocus className="gs-input min-h-16 text-[12px]" value={body} placeholder="What should the agent change here?" aria-label="Review comment"
      onChange={(event) => setBody(event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Escape') onDone(); if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void save(false) }} />
    {error && <p role="alert" className="text-[11px] text-danger">{error}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="gs-btn gs-btn-secondary gs-btn-sm" disabled={busy || !body.trim()} onClick={() => void save(false)}><MessageSquarePlus size={12} />Add comment</button>
      <button type="button" className="gs-btn gs-btn-primary gs-btn-sm" disabled={busy || active || !body.trim()} title={active ? 'Stop the running attempt first' : undefined} onClick={() => void save(true)}><Wrench size={12} />Add and ask for correction</button>
      <button type="button" className="gs-btn gs-btn-ghost gs-btn-sm" onClick={onDone}>Cancel</button>
      <span className="text-[10px] text-text-4">Shift+click extends the range · Ctrl+Enter adds</span>
    </div>
  </div>
}

const STATUS: Record<string, { label: string; className: string }> = {
  open: { label: 'Open', className: 'text-text-2' },
  sent: { label: 'Sent · correction running', className: 'text-accent' },
  to_review: { label: 'Re-review the new revision', className: 'text-warning' },
  resolved: { label: 'Resolved', className: 'text-success' },
}

function CommentItem({ task, comment, onOpen }: { task: AgentTask; comment: AgentReviewComment; onOpen: (comment: AgentReviewComment) => void }) {
  const store = () => useAgentTaskStore.getState()
  const status = STATUS[comment.status] ?? STATUS.open
  const sent = comment.status === 'sent'
  return <li className="rounded px-1 py-1 text-[11px] hover:bg-surface-2">
    <button type="button" className="block w-full truncate text-left font-mono text-[10px] text-text-3 hover:text-text-1" title="Show these lines" disabled={!comment.path} onClick={() => onOpen(comment)}>{comment.path ? rangeLabel(comment) : `evidence ${comment.evidenceId?.slice(-8)}`}</button>
    <p className="whitespace-pre-wrap text-text-1">{comment.body}</p>
    <div className="mt-0.5 flex items-center gap-1">
      <span className={`flex-1 text-[10px] ${status.className}`}>{status.label}</span>
      {(comment.status === 'to_review' || comment.status === 'open') && <button type="button" className="gs-btn gs-btn-ghost gs-btn-sm" title="The new revision addresses it" onClick={() => void store().setCommentStatus(task.id, comment.id, true)}><Check size={11} /></button>}
      {(comment.status === 'to_review' || comment.status === 'resolved') && <button type="button" className="gs-btn gs-btn-ghost gs-btn-sm" title="Reopen: not addressed yet" onClick={() => void store().setCommentStatus(task.id, comment.id, false)}><RotateCcw size={11} /></button>}
      {!sent && <button type="button" className="gs-btn gs-btn-ghost gs-btn-sm" title="Delete the comment" onClick={() => void store().removeComment(task.id, comment.id)}><Trash2 size={11} /></button>}
    </div>
  </li>
}

const EVIDENCE_TONE: Record<string, { className: string; icon: typeof Check }> = {
  passed: { className: 'text-success', icon: Check },
  failed: { className: 'text-danger', icon: XCircle },
  error: { className: 'text-warning', icon: CircleAlert },
  not_run: { className: 'text-text-3', icon: CircleSlash },
}

/** Where the reviewed changes come from: task, latest attempt, agent and workspace. */
function ReviewOrigin({ task }: { task: AgentTask }) {
  const attempt = task.attempts?.[task.attempts.length - 1]
  const workspace = task.workspace?.state === 'ready' ? task.workspace : undefined
  return <dl className="mb-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[10px]">
    <dt className="text-text-4">Task</dt><dd className="truncate text-text-2" title={task.objective}>{task.objective}</dd>
    <dt className="text-text-4">Agent</dt><dd className="truncate text-text-2">{task.agent}</dd>
    {attempt && <><dt className="text-text-4">Attempt</dt><dd className="truncate font-mono text-text-2" title={attempt.id}>{attempt.id.slice(-8)}{attempt.correctionOf ? ` · correction of ${attempt.correctionOf.slice(-8)}` : ''} · {attempt.status.replace(/_/g, ' ')}</dd></>}
    <dt className="text-text-4">Workspace</dt><dd className="truncate font-mono text-text-2" title={workspace?.path ?? task.root}>{workspace ? `${workspace.branch} · from ${workspace.baseSha?.slice(0, 8) ?? workspace.baseRef}` : 'project working tree'}</dd>
  </dl>
}

/** Verifications and review comments of the task, next to the diff. */
export function TaskReviewPanel({ task, onOpenComment }: { task: AgentTask; onOpenComment: (comment: AgentReviewComment) => void }) {
  const evidences = [...(task.evidences ?? [])].reverse()
  const comments = task.comments ?? []
  const open = comments.filter((comment) => comment.status === 'open')
  const active = ['running', 'waiting_permission', 'stopping'].includes(task.status)
  const sendOpen = async () => {
    const ok = await confirm({
      title: 'Ask for correction',
      message: `The agent receives ${open.length} comment${open.length === 1 ? '' : 's'} with their file, side, lines and commented text: ${open.map((comment) => comment.path ? rangeLabel(comment) : 'evidence').join(', ')}.`,
      confirmLabel: 'Send',
    })
    if (ok) await useAgentTaskStore.getState().askCorrection(task.id, [], '', open.map((comment) => comment.id))
  }
  return (
    <section className="border-t border-border-1 p-2" aria-label="Task review">
      <ReviewOrigin task={task} />
      <h3 className="gs-section-title mb-1">Comments · {comments.length}</h3>
      {comments.length === 0
        ? <p className="mb-2 text-[11px] text-text-3">Click a line number in the diff to comment on it.</p>
        : <ul className="mb-2 flex flex-col gap-1">{comments.map((comment) => <CommentItem key={comment.id} task={task} comment={comment} onOpen={onOpenComment} />)}</ul>}
      {open.length > 0 && <button type="button" className="gs-btn gs-btn-primary gs-btn-sm mb-2" disabled={active} title={active ? 'Stop the running attempt first' : undefined} onClick={() => void sendOpen()}><Wrench size={12} />Ask for correction ({open.length})</button>}
      <h3 className="gs-section-title mb-1">Verifications · {task.status.replace(/_/g, ' ')}</h3>
      {evidences.length === 0
        ? <p className="text-[11px] text-text-3">No verification recorded for this task. A change without evidence is not verified.</p>
        : <ul className="flex flex-col gap-1">
          {evidences.map((evidence) => {
            const tone = EVIDENCE_TONE[evidence.outcome] ?? EVIDENCE_TONE.not_run
            const Icon = tone.icon
            return <li key={evidence.id} className="rounded px-1 py-1 text-[11px] hover:bg-surface-2">
              <div className={`flex items-center gap-1.5 ${tone.className}`}><Icon size={11} /><span className="truncate">{evidence.label}</span></div>
              <p className="truncate pl-4 font-mono text-[10px] text-text-4" title={evidence.command}>{evidence.command}</p>
              {evidence.log && <details className="pl-4 text-[10px] text-text-3"><summary className="cursor-pointer">Log</summary><pre className="milk-output mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{evidence.log}</pre></details>}
            </li>
          })}
        </ul>}
    </section>
  )
}
