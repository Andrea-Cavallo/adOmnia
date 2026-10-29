import { useEffect, useState } from 'react'
import { ListTodo, Plus, RefreshCw } from 'lucide-react'
import type { GoIDESession } from '@/lib/code-studio-api'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { noAgentTasks, selectedAgentTask, useAgentTaskStore } from '@/stores/agentTasks'
import { useClaudeCodeStore } from '@/stores/claudeCode'
import { usePiAgentStore } from '@/stores/piAgent'
import { useMilkStore } from '@/stores/milk'
import { CodeStudioAgentTaskDetail } from './CodeStudioAgentTaskDetail'
import { CodeStudioAgentTaskEditor } from './CodeStudioAgentTaskEditor'
import { CodeStudioButton } from './CodeStudioModal'
import './codeStudioAgentTasks.css'

export function CodeStudioAgentTasks({ session, document }: { session: GoIDESession; document: GoIDEEditorDocument | null }) {
  const root = session.project.realPath
  const tasks = useAgentTaskStore((state) => state.tasksByRoot[root] ?? noAgentTasks)
  const selectedId = useAgentTaskStore((state) => state.selectedByRoot[root])
  const loading = useAgentTaskStore((state) => state.loadingByRoot[root])
  const error = useAgentTaskStore((state) => state.errorByRoot[root])
  const [editor, setEditor] = useState<{ open: boolean; taskId: string | null }>({ open: false, taskId: null })
  const selected = selectedAgentTask(tasks, selectedId)
  const editingTask = tasks.find((task) => task.id === editor.taskId) ?? null

  useEffect(() => {
    void useAgentTaskStore.getState().load(root)
    void usePiAgentStore.getState().ensure()
    void useMilkStore.getState().ensure()
    void useClaudeCodeStore.getState().ensure()
  }, [root])

  return <section className="agent-tasks" aria-label="Agent tasks">
    <header className="milk-bar">
      <ListTodo size={15} />
      <span className="milk-bar-title">Tasks</span>
      <span className="flex-1" />
      <button type="button" className="code-studio-icon-button h-7 w-7" title="Reload tasks" aria-label="Reload tasks" onClick={() => void useAgentTaskStore.getState().load(root)}><RefreshCw size={13} /></button>
      <CodeStudioButton small icon={Plus} onClick={() => setEditor({ open: true, taskId: null })}>New task</CodeStudioButton>
    </header>
    {error && <div className="milk-error m-2 flex items-center gap-2" role="alert"><span className="min-w-0 flex-1">{error}</span><CodeStudioButton small onClick={() => void useAgentTaskStore.getState().load(root)}>Retry</CodeStudioButton></div>}
    <div className="agent-task-layout">
      <div className="agent-task-list" role="listbox" aria-label="Saved agent tasks">
        {loading && !tasks.length ? <p className="gs-list-empty" role="status">Loading saved tasks…</p>
          : tasks.length === 0 ? <div className="gs-list-empty"><p>No agent tasks in this project.</p><p>Create a draft to prepare the first attempt.</p></div>
            : tasks.map((task) => <button key={task.id} type="button" role="option" aria-selected={task.id === selected?.id} className="agent-task-row" onClick={() => useAgentTaskStore.getState().select(root, task.id)}><span className="agent-task-row-title" title={task.objective}>{task.objective}</span><span className="flex items-center justify-between gap-2 text-[10px] text-text-3"><span>{task.agent === 'pi' ? 'Pi' : task.agent === 'claude' ? 'Claude Code' : task.agent}</span><span>{task.status.replace(/_/g, ' ')}</span></span></button>)}
      </div>
      {selected ? <CodeStudioAgentTaskDetail key={selected.id} session={session} document={document} task={selected} onEdit={() => setEditor({ open: true, taskId: selected.id })} /> : <div className="milk-empty self-center"><ListTodo size={32} /><h2>One task, one explicit attempt</h2><p>Inspect the context, follow the agent output and review its changes without mixing them into your chat.</p></div>}
    </div>
    {tasks.length > 0 && <p className="agent-tasks-note" role="note">The 200 most recently updated tasks are kept locally. Export a task to save its full history.</p>}
    {editor.open && <CodeStudioAgentTaskEditor key={editor.taskId ?? 'new'} session={session} task={editingTask} open={editor.open} onClose={() => setEditor({ open: false, taskId: null })} />}
  </section>
}
