import { useState } from 'react'
import { ArrowDown, ArrowUp, Check, GitCommitHorizontal, ListChecks, Pencil, Play, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { agentTaskStepPrompt, previewAgentTaskStepCommit, type AgentPlanStep, type AgentPlanStepDraft, type AgentTask } from '@/lib/agent-task-api'
import { draftsFromTask, moveDraft, planApproved, stepBlocker } from '@/lib/code-studio/agentPlan'
import { confirm } from '@/lib/confirmDialog'
import { useAgentTaskStore } from '@/stores/agentTasks'
import { CodeStudioAlert, CodeStudioButton, CodeStudioField } from './CodeStudioModal'

const STEP_STATUS: Record<string, { label: string; className: string }> = {
  todo: { label: 'To do', className: 'text-text-3' },
  running: { label: 'Running', className: 'text-accent' },
  to_verify: { label: 'To verify', className: 'text-warning' },
  completed: { label: 'Completed', className: 'text-success' },
  failed: { label: 'Failed', className: 'text-danger' },
  cancelled: { label: 'Cancelled', className: 'text-text-3' },
}

/** New steps get an ID on the client so later steps can depend on them before the first save. */
const newDraft = (): AgentPlanStepDraft => ({ id: `step-${crypto.randomUUID().slice(0, 8)}`, title: '', goal: '', dependsOn: [], expectedFiles: [], verificationIds: [] })

const splitList = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean)

function StepEditor({ task, drafts, index, onChange }: { task: AgentTask; drafts: AgentPlanStepDraft[]; index: number; onChange: (drafts: AgentPlanStepDraft[]) => void }) {
  const draft = drafts[index]
  const update = (patch: Partial<AgentPlanStepDraft>) => onChange(drafts.map((item, position) => position === index ? { ...item, ...patch } : item))
  const toggle = (list: string[] | undefined, id: string) => (list ?? []).includes(id) ? (list ?? []).filter((item) => item !== id) : [...(list ?? []), id]
  return <li className="flex flex-col gap-2 rounded border border-border-1 p-2">
    <div className="flex items-center gap-1">
      <span className="w-5 text-[11px] text-text-4">{index + 1}.</span>
      <input className="gs-input h-7 flex-1 text-[12px]" aria-label={`Step ${index + 1} title`} placeholder="What this step does" value={draft.title} onChange={(event) => update({ title: event.target.value })} />
      <button type="button" className="gs-btn gs-btn-ghost gs-btn-sm" aria-label="Move up" disabled={index === 0} onClick={() => onChange(moveDraft(drafts, index, -1))}><ArrowUp size={12} /></button>
      <button type="button" className="gs-btn gs-btn-ghost gs-btn-sm" aria-label="Move down" disabled={index === drafts.length - 1} onClick={() => onChange(moveDraft(drafts, index, 1))}><ArrowDown size={12} /></button>
      <button type="button" className="gs-btn gs-btn-ghost gs-btn-sm" aria-label="Remove step" onClick={() => onChange(drafts.filter((_, position) => position !== index).map((item) => ({ ...item, dependsOn: (item.dependsOn ?? []).filter((id) => id !== draft.id) })))}><Trash2 size={12} /></button>
    </div>
    <textarea className="gs-input min-h-12 text-[11px]" aria-label={`Step ${index + 1} goal`} placeholder="Goal and acceptance in a few lines (optional)" value={draft.goal ?? ''} onChange={(event) => update({ goal: event.target.value })} />
    <CodeStudioField label="Files expected to change" hint="Comma separated, relative to the project">
      <input className="gs-input h-7 font-mono text-[11px]" value={(draft.expectedFiles ?? []).join(', ')} onChange={(event) => update({ expectedFiles: splitList(event.target.value) })} />
    </CodeStudioField>
    {(task.verifications?.length ?? 0) > 0 && <fieldset className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]"><legend className="mb-1 text-text-3">Completed when these verifications pass</legend>
      {task.verifications!.map((verification) => <label key={verification.id} className="gs-check"><input type="checkbox" checked={(draft.verificationIds ?? []).includes(verification.id)} onChange={() => update({ verificationIds: toggle(draft.verificationIds, verification.id) })} />{verification.label}</label>)}
    </fieldset>}
    {index > 0 && <fieldset className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]"><legend className="mb-1 text-text-3">Depends on</legend>
      {drafts.slice(0, index).map((earlier, position) => <label key={earlier.id || position} className="gs-check"><input type="checkbox" checked={(draft.dependsOn ?? []).includes(earlier.id ?? '')} onChange={() => update({ dependsOn: toggle(draft.dependsOn, earlier.id ?? '') })} />{earlier.title || `Step ${position + 1}`}</label>)}
    </fieldset>}
  </li>
}

function StepRow({ task, step, active, onError }: { task: AgentTask; step: AgentPlanStep; active: boolean; onError: (message: string) => void }) {
  const status = STEP_STATUS[step.status] ?? STEP_STATUS.todo
  const blocker = stepBlocker(task, step, active)
  const verifications = (step.verificationIds ?? []).map((id) => task.verifications?.find((item) => item.id === id)?.label ?? id)
  const run = async () => {
    const prompt = await agentTaskStepPrompt(task.id, step.id)
    const ok = await confirm({ title: `Run step: ${step.title}`, message: `The agent receives this text (no file is attached; it reads the workspace itself):\n\n${prompt}`, confirmLabel: 'Run step' })
    if (ok) await useAgentTaskStore.getState().startStep(task.id, step.id)
  }
  const commit = async () => {
    const preview = await previewAgentTaskStepCommit(task.id, step.id)
    const ok = await confirm({
      title: `Commit step on ${preview.branch}`,
      message: `${preview.files.length} file(s) are committed on the task branch (the project branch is not touched):\n${preview.files.join('\n')}\n\nMessage:\n${preview.message}`,
      confirmLabel: 'Commit',
    })
    if (ok) await useAgentTaskStore.getState().commitStep(task.id, step.id)
  }
  const canCommit = step.status === 'completed' && !step.commitSha && task.workspace?.state === 'ready'
  return <li className="flex flex-col gap-1 rounded px-2 py-1.5 hover:bg-surface-2">
    <div className="flex items-center gap-2">
      <span className={`w-20 shrink-0 text-[10px] font-medium ${status.className}`}>{status.label}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-text-1" title={step.goal || step.title}>{step.title}</span>
      {step.status === 'to_verify' && verifications.length === 0 && <CodeStudioButton small icon={Check} disabled={active} title="This step has no verification: complete it by explicit confirmation" onClick={() => void useAgentTaskStore.getState().confirmStep(task.id, step.id)}>Confirm</CodeStudioButton>}
      {canCommit && <CodeStudioButton small icon={GitCommitHorizontal} disabled={active} title="Commit this step's changes on the task branch" onClick={() => void commit().catch((cause: unknown) => onError(cause instanceof Error ? cause.message : String(cause)))}>Commit</CodeStudioButton>}
      <CodeStudioButton small icon={Play} disabled={!!blocker} title={blocker || 'Show the prompt, then run the agent on this step'} onClick={() => void run().catch(() => undefined)}>{step.status === 'failed' || step.status === 'cancelled' ? 'Run again' : 'Run'}</CodeStudioButton>
    </div>
    <p className="pl-[88px] text-[10px] text-text-4">
      {verifications.length ? <span className="inline-flex items-center gap-1"><ShieldCheck size={10} />{verifications.join(', ')}</span> : 'No verification: needs your confirmation'}
      {(step.expectedFiles?.length ?? 0) > 0 && <> · <span className="font-mono">{step.expectedFiles!.join(', ')}</span></>}
      {(step.attemptIds?.length ?? 0) > 0 && <> · {step.attemptIds!.length} attempt{step.attemptIds!.length === 1 ? '' : 's'}</>}
      {step.confirmedWithoutVerification && <> · confirmed without verification</>}
      {step.commitSha && <> · committed <span className="font-mono">{step.commitSha.slice(0, 8)}</span></>}
      {step.note && <> · {step.note}</>}
    </p>
  </li>
}

/** Persistent plan: edit, approve, then run step by step; a step is completed by its verifications. */
export function CodeStudioAgentTaskPlan({ task, active }: { task: AgentTask; active: boolean }) {
  const [drafts, setDrafts] = useState<AgentPlanStepDraft[] | null>(null)
  const [error, setError] = useState('')
  const plan = task.plan
  const approved = planApproved(task)
  const act = async (action: () => Promise<unknown>) => {
    setError('')
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const save = () => act(async () => {
    if (!drafts) return
    await useAgentTaskStore.getState().setPlan(task.id, drafts)
    setDrafts(null)
  })
  return <section className="agent-task-section flex flex-col gap-2" aria-label="Plan">
    <div className="flex items-center gap-2">
      <h3 className="gs-section-title flex-1"><ListChecks size={13} className="mr-1 inline" />Plan</h3>
      {plan && !drafts && <span className={`text-[10px] ${approved ? 'text-success' : 'text-warning'}`}>Revision {plan.revision} · {approved ? 'approved' : 'not approved'}</span>}
      {!drafts && <CodeStudioButton small icon={plan ? Pencil : Plus} disabled={active} title={active ? 'Stop the task first' : undefined} onClick={() => setDrafts(plan ? draftsFromTask(task) : [newDraft()])}>{plan ? 'Edit' : 'Create plan'}</CodeStudioButton>}
      {plan && !drafts && !approved && <CodeStudioButton small variant="primary" icon={Check} onClick={() => void act(() => useAgentTaskStore.getState().approvePlan(task.id))}>Approve</CodeStudioButton>}
    </div>
    {error && <CodeStudioAlert>{error}</CodeStudioAlert>}
    {drafts ? <>
      <ol className="flex flex-col gap-2">{drafts.map((_, index) => <StepEditor key={drafts[index].id || `new-${index}`} task={task} drafts={drafts} index={index} onChange={setDrafts} />)}</ol>
      <div className="flex flex-wrap gap-2">
        <CodeStudioButton small icon={Plus} onClick={() => setDrafts([...drafts, newDraft()])}>Add step</CodeStudioButton>
        <span className="flex-1" />
        <CodeStudioButton small onClick={() => setDrafts(null)}>Cancel</CodeStudioButton>
        <CodeStudioButton small variant="primary" disabled={!drafts.length} onClick={() => void save()}>Save revision</CodeStudioButton>
      </div>
      <p className="text-[10px] text-text-4">Saving creates a new revision that must be approved again. Steps that keep the same content keep their state.</p>
    </> : plan ? <>
      <ol className="flex flex-col">{plan.steps.map((step) => <StepRow key={step.id} task={task} step={step} active={active} onError={setError} />)}</ol>
      {(plan.revisions?.length ?? 0) > 1 && <details className="text-[10px] text-text-4"><summary className="cursor-pointer">{plan.revisions!.length} revisions</summary>
        <ul>{[...plan.revisions!].reverse().map((revision) => <li key={revision.revision}>Revision {revision.revision} · {revision.steps.length} steps · {new Date(revision.at).toLocaleString()}</li>)}</ul>
      </details>}
    </> : <p className="text-[11px] text-text-3">Split the work into steps. Each step runs separately and is completed only when its verifications pass, or by your explicit confirmation when it has none.</p>}
  </section>
}
