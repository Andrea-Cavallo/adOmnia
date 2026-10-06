import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { WorkspaceSidebarSkeleton } from '@/components/layout/WorkspaceHydrationShell'
import { useUiTranslation } from '@/lib/uiI18n'

const SIDEBAR_WIDTH_KEY = 'adomnia.sidebarWidth'
const SIDEBAR_WIDTH_MIN = 180
const SIDEBAR_WIDTH_MAX = 0.40

let sidebarModulePromise: Promise<typeof import('@/components/layout/Sidebar')> | undefined
export function loadSidebarModule() {
  return sidebarModulePromise ??= import('@/components/layout/Sidebar')
}
const Sidebar = React.lazy(() => loadSidebarModule().then((module) => ({ default: module.Sidebar })))

function clampSidebarWidth(w: number): number {
  return Math.max(SIDEBAR_WIDTH_MIN, Math.min(w, Math.round(window.innerWidth * SIDEBAR_WIDTH_MAX)))
}

function loadSidebarWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (stored) return clampSidebarWidth(parseInt(stored, 10))
  } catch { /* ignore */ }
  return 256
}

/** The API Workspace collections tree with its resize handle: main window and detached API Workspace window. */
export function WorkspaceSidebarColumn() {
  const tr = useUiTranslation()
  const [sidebarWidth, setSidebarWidth] = useState<number>(loadSidebarWidth)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const isDragging = useRef(false)

  const handleSidebarResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: sidebarWidth }
    isDragging.current = true

    const handleMove = (me: MouseEvent) => {
      if (!dragRef.current) return
      const newW = clampSidebarWidth(dragRef.current.startWidth + (me.clientX - dragRef.current.startX))
      setSidebarWidth(newW)
      try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(newW)) } catch { /* ignore */ }
    }

    const handleUp = () => {
      isDragging.current = false
      dragRef.current = null
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [sidebarWidth])

  useEffect(() => {
    const onResize = () => {
      if (!isDragging.current) setSidebarWidth((w) => clampSidebarWidth(w))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <>
      <div className="shrink-0 flex flex-col min-h-0 overflow-hidden" style={{ width: sidebarWidth }}>
        <Suspense fallback={<WorkspaceSidebarSkeleton quiet />}><Sidebar /></Suspense>
      </div>
      {/* Sidebar drag handle */}
      <ResizeHandle
        label={tr('Drag to resize sidebar')}
        onMouseDown={handleSidebarResizeMouseDown}
        withLine={false}
        className="border-r border-border-1"
      />
    </>
  )
}
