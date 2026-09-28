import { useCallback, useEffect, useMemo, type MouseEvent as ReactMouseEvent } from 'react'
import { AlertTriangle, PanelBottomClose, PanelBottomOpen, PanelRightClose, PanelRightOpen, X } from 'lucide-react'
import { GoStudioEmptyState } from './GoStudioEmptyState'
import { GoStudioToolbar } from './GoStudioToolbar'
import { GoStudioWorkspace } from './GoStudioWorkspace'
import { useGoIDEStore } from '@/stores/goide'

export function GoStudioPanel() {
  const sessions = useGoIDEStore((state) => state.sessions)
  const activeSessionId = useGoIDEStore((state) => state.activeSessionId)
  const capabilities = useGoIDEStore((state) => state.capabilities)
  const loading = useGoIDEStore((state) => state.loading)
  const error = useGoIDEStore((state) => state.error)
  const layout = useGoIDEStore((state) => state.layout)
  const initialize = useGoIDEStore((state) => state.initialize)
  const openProject = useGoIDEStore((state) => state.openProject)
  const selectSession = useGoIDEStore((state) => state.selectSession)
  const setToolAuthorization = useGoIDEStore((state) => state.setToolAuthorization)
  const closeActiveSession = useGoIDEStore((state) => state.closeActiveSession)
  const updateLayout = useGoIDEStore((state) => state.updateLayout)
  const clearError = useGoIDEStore((state) => state.clearError)
  const activeSession = useMemo(() => sessions.find((session) => session.id === activeSessionId) ?? null, [activeSessionId, sessions])

  useEffect(() => { void initialize() }, [initialize])

  const onKeyboardOpen = useCallback((event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'o') return
    event.preventDefault()
    void openProject()
  }, [openProject])

  useEffect(() => {
    window.addEventListener('keydown', onKeyboardOpen)
    return () => window.removeEventListener('keydown', onKeyboardOpen)
  }, [onKeyboardOpen])

  const beginResize = useCallback((key: 'projectWidth' | 'structureWidth' | 'bottomHeight', initial: number, direction = 1) => (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const horizontal = key === 'bottomHeight'
    const start = horizontal ? event.clientY : event.clientX
    const onMove = (moveEvent: MouseEvent) => {
      const coordinate = horizontal ? moveEvent.clientY : moveEvent.clientX
      const value = initial + (coordinate - start) * direction
      const min = horizontal ? 112 : 180
      const max = key === 'projectWidth' ? 420 : 360
      updateLayout({ [key]: Math.min(max, Math.max(min, value)) })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [updateLayout])

  if (!activeSession) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-surface-0">
        {error && <ErrorBanner message={error} onClose={clearError} />}
        <GoStudioEmptyState loading={loading} onOpenProject={() => void openProject()} />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-0 text-text-1">
      <GoStudioToolbar
        sessions={sessions}
        activeSession={activeSession}
        loading={loading}
        onSelect={selectSession}
        onOpenProject={() => void openProject()}
        onSetAuthorization={(allowed) => void setToolAuthorization(allowed)}
        onClose={() => void closeActiveSession()}
      />
      {error && <ErrorBanner message={error} onClose={clearError} />}
      <div className="flex h-7 shrink-0 items-center justify-end gap-1 border-b border-border-1 bg-surface-0 px-2">
        <button type="button" onClick={() => updateLayout({ structureOpen: !layout.structureOpen })} title={layout.structureOpen ? 'Hide structure' : 'Show structure'} className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1">
          {layout.structureOpen ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
        </button>
        <button type="button" onClick={() => updateLayout({ bottomOpen: !layout.bottomOpen })} title={layout.bottomOpen ? 'Hide activity' : 'Show activity'} className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1">
          {layout.bottomOpen ? <PanelBottomClose size={13} /> : <PanelBottomOpen size={13} />}
        </button>
      </div>
      <GoStudioWorkspace
        session={activeSession}
        capabilities={capabilities}
        {...layout}
        onProjectResize={beginResize('projectWidth', layout.projectWidth)}
        onStructureResize={beginResize('structureWidth', layout.structureWidth, -1)}
        onBottomResize={beginResize('bottomHeight', layout.bottomHeight, -1)}
      />
      <div className="flex h-6 shrink-0 items-center gap-4 border-t border-border-1 bg-surface-1 px-3 text-[9px] text-text-4">
        <span>{activeSession.project.goWorkPath ? 'go.work' : activeSession.project.goModPath ? 'go.mod' : 'Go project'}</span>
        <span className="truncate">{activeSession.project.rootPath}</span>
        <span className="ml-auto">No language server running</span>
      </div>
    </div>
  )
}

function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger">
      <AlertTriangle size={13} /><span className="flex-1">{message}</span>
      <button type="button" onClick={onClose} title="Dismiss error" className="grid h-5 w-5 place-items-center rounded hover:bg-danger/10"><X size={12} /></button>
    </div>
  )
}
