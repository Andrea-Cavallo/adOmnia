import { useEffect, useRef, useState } from 'react'
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import { confirm } from '@/lib/confirmDialog'
import { DEFAULT_STUDIO_WORKSPACE_ID } from '@/lib/goide-workspaces-api'
import { goStudioWindowContext } from '@/lib/goide-window-api'
import { sessionsInWorkspace, useGoIDEStore } from '@/stores/goide'
import { createGoStudioWorkspace, deleteGoStudioWorkspace, renameGoStudioWorkspace, switchGoStudioWorkspace } from '@/stores/goideWorkspaces'
import { GoStudioButton, GoStudioField, GoStudioModal } from './GoStudioModal'

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
    const done = dialog.mode === 'create' ? await createGoStudioWorkspace(name) : await renameGoStudioWorkspace(dialog.id, name)
    if (done) onClose()
    else setBusy(false)
  }

  const creating = dialog.mode === 'create'
  return (
    <GoStudioModal
      open
      onClose={onClose}
      top
      size="sm"
      icon={Layers}
      title={creating ? 'New Go Studio workspace' : 'Rename workspace'}
      subtitle="A workspace groups open projects. It is separate from adOmnia API workspaces, and a project can be open in several."
      footer={<>
        <GoStudioButton variant="ghost" onClick={onClose}>Cancel</GoStudioButton>
        <GoStudioButton variant="primary" type="submit" form="go-studio-workspace-form" loading={busy} disabled={!name.trim()}>{creating ? 'Create' : 'Rename'}</GoStudioButton>
      </>}
    >
      <form id="go-studio-workspace-form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <GoStudioField label="Name">
          <input ref={inputRef} autoFocus value={name} maxLength={MAX_NAME_LENGTH} onChange={(event) => setName(event.target.value)} placeholder="e.g. Payments" className="gs-input" />
        </GoStudioField>
      </form>
    </GoStudioModal>
  )
}

/** Selettore del workspace Go Studio nella menu bar: sempre visibile, anche quando il workspace è vuoto. */
export function GoStudioWorkspaceSwitcher() {
  // Una finestra separata mostra un solo progetto: i workspace si gestiscono dalla finestra principale.
  if (goStudioWindowContext().pinnedSessionId) return null
  return <WorkspaceSwitcher />
}

function WorkspaceSwitcher() {
  const workspaces = useGoIDEStore((state) => state.studioWorkspaces)
  const activeId = useGoIDEStore((state) => state.activeWorkspaceId)
  const sessions = useGoIDEStore((state) => state.sessions)
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
    if (approved) await deleteGoStudioWorkspace(active.id)
  }

  const select = (id: string) => {
    setMenu(null)
    if (id === NEW_ITEM) return setDialog({ mode: 'create' })
    if (id === RENAME_ITEM) return setDialog({ mode: 'rename', id: active.id, name: active.name })
    if (id === DELETE_ITEM) return void remove()
    if (id.startsWith(SWITCH_PREFIX)) void switchGoStudioWorkspace(id.slice(SWITCH_PREFIX.length))
  }

  return (
    <>
      <button type="button" aria-haspopup="menu" title={`Go Studio workspace: ${active.name} (${projectCount(activeCount)}) · separate from adOmnia API workspaces`}
        onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom + 2 }) }}
        className={`go-studio-widget max-w-48 ${menu ? 'is-active' : ''}`}>
        <Layers size={13} className="shrink-0 text-text-3" />
        <span className="truncate">{active.name}</span>
        <span className="shrink-0 text-text-4">{activeCount}</span>
      </button>
      {menu && <ContextMenu appearance="studio" x={menu.x} y={menu.y} items={items} onSelect={select} onClose={() => setMenu(null)} />}
      {dialog && <WorkspaceNameDialog dialog={dialog} onClose={() => setDialog(null)} />}
    </>
  )
}
