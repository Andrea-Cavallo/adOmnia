import { useEffect, useRef, useState } from 'react'
import { Layers } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import { confirm } from '@/lib/confirmDialog'
import { useModalFocusTrap } from '@/lib/accessibility'
import { DEFAULT_STUDIO_WORKSPACE_ID } from '@/lib/goide-workspaces-api'
import { goStudioWindowContext } from '@/lib/goide-window-api'
import { sessionsInWorkspace, useGoIDEStore } from '@/stores/goide'
import { createGoStudioWorkspace, deleteGoStudioWorkspace, renameGoStudioWorkspace, switchGoStudioWorkspace } from '@/stores/goideWorkspaces'

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
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useModalFocusTrap(true, onClose, dialogRef)
  useEffect(() => { inputRef.current?.select() }, [])

  const submit = async () => {
    if (busy || !name.trim()) return
    setBusy(true)
    const done = dialog.mode === 'create' ? await createGoStudioWorkspace(name) : await renameGoStudioWorkspace(dialog.id, name)
    if (done) onClose()
    else setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[18vh] backdrop-blur-[2px]" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={dialog.mode === 'create' ? 'New Go Studio workspace' : 'Rename Go Studio workspace'} tabIndex={-1} className="w-[min(420px,92vw)] rounded-xl border border-border-2 bg-surface-1 p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <h2 className="text-xs font-semibold text-text-1">{dialog.mode === 'create' ? 'New Go Studio Workspace' : 'Rename Workspace'}</h2>
        <p className="mt-1 text-[10px] leading-relaxed text-text-4">A Go Studio workspace groups open projects. It is separate from adOmnia API workspaces, and the same project can be open in several of them.</p>
        <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <input ref={inputRef} autoFocus value={name} maxLength={MAX_NAME_LENGTH} onChange={(event) => setName(event.target.value)} placeholder="Workspace name" aria-label="Workspace name"
            className="h-7 min-w-0 flex-1 rounded border border-border-1 bg-surface-0 px-2 text-[11px] text-text-1 outline-none focus:border-accent" />
          <button type="submit" disabled={busy || !name.trim()} className="h-7 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">{dialog.mode === 'create' ? 'Create' : 'Rename'}</button>
        </form>
      </div>
    </div>
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
      label: `${workspace.id === activeId ? '● ' : ''}${workspace.name} · ${projectCount(sessionsInWorkspace(sessions, workspace.id).length)}`,
      disabled: workspace.id === activeId,
    })),
    { id: NEW_ITEM, label: 'New Workspace…', separatorBefore: true },
    { id: RENAME_ITEM, label: `Rename “${active.name}”…` },
    {
      id: DELETE_ITEM, label: `Delete “${active.name}”`, danger: true,
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
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onSelect={select} onClose={() => setMenu(null)} />}
      {dialog && <WorkspaceNameDialog dialog={dialog} onClose={() => setDialog(null)} />}
    </>
  )
}
