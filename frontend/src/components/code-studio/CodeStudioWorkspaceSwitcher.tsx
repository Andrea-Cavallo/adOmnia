import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Layers, Pencil, Plus, Trash2 } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import { confirm } from '@/lib/confirmDialog'
import { DEFAULT_STUDIO_WORKSPACE_ID } from '@/lib/code-studio-workspaces-api'
import { codeStudioWindowContext } from '@/lib/code-studio-window-api'
import { sessionsInWorkspace, useCodeStudioStore } from '@/stores/codeStudio'
import { createCodeStudioWorkspace, deleteCodeStudioWorkspace, renameCodeStudioWorkspace, switchCodeStudioWorkspace } from '@/stores/codeStudioWorkspaces'
import { CodeStudioButton, CodeStudioField, CodeStudioModal } from './CodeStudioModal'

const NEW_ITEM = 'workspace:new'
const RENAME_ITEM = 'workspace:rename'
const DELETE_ITEM = 'workspace:delete'
const SWITCH_PREFIX = 'workspace:switch:'
const MAX_NAME_LENGTH = 40

type NameDialog = { mode: 'create' } | { mode: 'rename'; id: string; name: string }

function projectCount(count: number): string {
  return count === 1 ? '1 project' : `${count} projects`
}

function WorkspaceNameDialog({ dialog, onClose }: { dialog: NameDialog; onClose: () => void }) {
  const [name, setName] = useState(dialog.mode === 'rename' ? dialog.name : '')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.select() }, [])

  const submit = async () => {
    if (busy || !name.trim()) return
    setBusy(true)
    const done = dialog.mode === 'create' ? await createCodeStudioWorkspace(name) : await renameCodeStudioWorkspace(dialog.id, name)
    if (done) onClose()
    else setBusy(false)
  }

  const creating = dialog.mode === 'create'
  return (
    <CodeStudioModal
      open
      onClose={onClose}
      top
      size="sm"
      icon={Layers}
      title={creating ? 'New Code Studio workspace' : 'Rename workspace'}
      subtitle="A workspace groups open projects. It is separate from adOmnia API workspaces, and a project can be open in several."
      footer={<>
        <CodeStudioButton variant="ghost" onClick={onClose}>Cancel</CodeStudioButton>
        <CodeStudioButton variant="primary" type="submit" form="code-studio-workspace-form" loading={busy} disabled={!name.trim()}>{creating ? 'Create' : 'Rename'}</CodeStudioButton>
      </>}
    >
      <form id="code-studio-workspace-form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <CodeStudioField label="Name">
          <input ref={inputRef} value={name} maxLength={MAX_NAME_LENGTH} onChange={(event) => setName(event.target.value)} placeholder="e.g. Payments" className="gs-input" />
        </CodeStudioField>
      </form>
    </CodeStudioModal>
  )
}

/** Selettore del workspace Code Studio nella menu bar: sempre visibile, anche quando il workspace è vuoto. */
export function CodeStudioWorkspaceSwitcher() {
  // Una finestra separata mostra un solo progetto: i workspace si gestiscono dalla finestra principale.
  if (codeStudioWindowContext().pinnedSessionId) return null
  return <WorkspaceSwitcher />
}

function WorkspaceSwitcher() {
  const workspaces = useCodeStudioStore((state) => state.studioWorkspaces)
  const activeId = useCodeStudioStore((state) => state.activeWorkspaceId)
  const sessions = useCodeStudioStore((state) => state.sessions)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<NameDialog | null>(null)
  const active = workspaces.find((workspace) => workspace.id === activeId)
  if (!active) return null

  const activeCount = sessionsInWorkspace(sessions, activeId).length
  const items: ContextMenuItem[] = [
    ...workspaces.map((workspace) => ({
      id: `${SWITCH_PREFIX}${workspace.id}`,
      label: `${workspace.name} · ${projectCount(sessionsInWorkspace(sessions, workspace.id).length)}`,
      icon: Layers,
      checked: workspace.id === activeId || undefined,
      disabled: workspace.id === activeId,
    })),
    { id: NEW_ITEM, label: 'New Workspace…', icon: Plus, separatorBefore: true },
    { id: RENAME_ITEM, label: `Rename “${active.name}”…`, icon: Pencil },
    {
      id: DELETE_ITEM, label: `Delete “${active.name}”`, danger: true, icon: Trash2,
      disabled: activeId === DEFAULT_STUDIO_WORKSPACE_ID || activeCount > 0,
      disabledReason: activeId === DEFAULT_STUDIO_WORKSPACE_ID ? 'The default workspace always exists' : 'Close its projects first',
    },
  ]

  const remove = async () => {
    const approved = await confirm({ title: `Delete workspace “${active.name}”?`, message: 'The workspace has no open projects. Project folders and adOmnia API workspaces are not touched.', confirmLabel: 'Delete workspace', variant: 'danger' })
    if (approved) await deleteCodeStudioWorkspace(active.id)
  }

  const select = (id: string) => {
    setMenu(null)
    if (id === NEW_ITEM) return setDialog({ mode: 'create' })
    if (id === RENAME_ITEM) return setDialog({ mode: 'rename', id: active.id, name: active.name })
    if (id === DELETE_ITEM) return void remove()
    if (id.startsWith(SWITCH_PREFIX)) void switchCodeStudioWorkspace(id.slice(SWITCH_PREFIX.length))
  }

  return (
    <>
      <button type="button" aria-label={`Code Studio workspace: ${active.name}`} aria-haspopup="menu" title={`Code Studio workspace: ${active.name} (${projectCount(activeCount)}) · separate from adOmnia API workspaces`}
        onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom + 2 }) }}
        className={`code-studio-widget max-w-48 ${menu ? 'is-active' : ''}`}>
        <Layers size={15} className="shrink-0 text-accent" />
        <span className="truncate text-[13.5px] font-medium text-text-1">{active.name}</span>
        <span className="code-studio-count shrink-0">{activeCount}</span>
        <ChevronDown size={12} className="shrink-0 text-text-4" />
      </button>
      {menu && <ContextMenu appearance="studio" x={menu.x} y={menu.y} items={items} onSelect={select} onClose={() => setMenu(null)} />}
      {dialog && <WorkspaceNameDialog dialog={dialog} onClose={() => setDialog(null)} />}
    </>
  )
}
