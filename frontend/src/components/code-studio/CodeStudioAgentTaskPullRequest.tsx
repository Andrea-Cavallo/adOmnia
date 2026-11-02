import { useState } from 'react'
import { ClipboardCopy, GitPullRequestDraft } from 'lucide-react'
import { draftAgentTaskPullRequest, type AgentTask } from '@/lib/agent-task-api'
import { copyToClipboard } from '@/lib/codegen'
import { CodeStudioAlert, CodeStudioButton, CodeStudioField } from './CodeStudioModal'

/** Editable pull request draft built from the task evidence. It is copied, never pushed. */
export function CodeStudioAgentTaskPullRequest({ task }: { task: AgentTask }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const draft = async () => {
    setNotice('')
    try {
      const result = await draftAgentTaskPullRequest(task.id)
      setTitle(result.title)
      setBody(result.body)
      setOpen(true)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const copy = async () => setNotice(await copyToClipboard(`${title}\n\n${body}`) ? 'Copied: paste it into your pull request.' : 'The clipboard is not available.')
  return <section className="agent-task-section flex flex-col gap-2" aria-label="Pull request draft">
    <div className="flex items-center gap-2">
      <h3 className="gs-section-title flex-1"><GitPullRequestDraft size={13} className="mr-1 inline" />Pull request</h3>
      <CodeStudioButton small onClick={() => void draft()} title="Build a title and description from the plan, scenarios and evidence">{open ? 'Rebuild draft' : 'Draft from evidence'}</CodeStudioButton>
    </div>
    {notice && <CodeStudioAlert tone="info">{notice}</CodeStudioAlert>}
    {open && <>
      <CodeStudioField label="Title"><input className="gs-input h-7 text-[12px]" value={title} onChange={(event) => setTitle(event.target.value)} /></CodeStudioField>
      <CodeStudioField label="Description" hint="Markdown; states what adOmnia verified and what it did not"><textarea className="gs-input min-h-48 font-mono text-[11px]" value={body} onChange={(event) => setBody(event.target.value)} /></CodeStudioField>
      <div className="flex gap-2"><span className="flex-1" /><CodeStudioButton small variant="primary" icon={ClipboardCopy} onClick={() => void copy()}>Copy</CodeStudioButton></div>
      <p className="text-[10px] text-text-4">Nothing is pushed: the branch, the remote and the pull request stay your explicit actions.</p>
    </>}
  </section>
}
