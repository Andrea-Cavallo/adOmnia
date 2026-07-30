import { useCallback, useEffect, useRef, useState } from 'react'
import { Titlebar } from '@/components/layout/Titlebar'
import { Rail } from '@/components/layout/Rail'
import { Sidebar } from '@/components/layout/Sidebar'
import { MainArea } from '@/components/layout/MainArea'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { StatusBar } from '@/components/layout/StatusBar'
import { ThemeProvider } from '@/components/themes/ThemeProvider'
import { DevLogOverlay } from '@/components/ui/DevLogOverlay'
import { ConfirmDialogHost } from '@/components/ui/ConfirmDialogHost'
import { StorageQuotaBanner } from '@/components/layout/StorageQuotaBanner'
import { UpdateBanner } from '@/components/layout/UpdateBanner'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { DropOverlay } from '@/components/layout/DropOverlay'
import { DropToast } from '@/components/layout/DropToast'
import { useAppStore } from '@/stores/app'
import { useAppInit } from '@/hooks/useAppInit'
import { useAppearance } from '@/hooks/useAppearance'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useFileDrop } from '@/hooks/useFileDrop'
import { useSettingsStore } from '@/stores/settings'

const SIDEBAR_WIDTH_KEY = 'adomnia.sidebarWidth'
const SIDEBAR_WIDTH_MIN = 180
const SIDEBAR_WIDTH_MAX = 0.40

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

function App() {
  const { activeWindowChrome, commandPaletteOpen, setCommandPaletteOpen } = useAppInit()
  const { dragOver, dropPreview, dropFeedback, handlers } = useFileDrop()
  const devLogVisible  = useAppStore((s) => s.devToolsVisible)
  const toggleDevTools = useAppStore((s) => s.toggleDevTools)
  const activeRail     = useAppStore((s) => s.activeRail)
  const sidebarCollapsed = useSettingsStore((s) => s.settings.appearance.sidebarCollapsed)
  const showSidebar    = activeRail === 'collections' && !sidebarCollapsed
  useAppearance()
  useKeyboardShortcuts({ setCommandPaletteOpen })

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
    <ErrorBoundary>
      <ThemeProvider>
        <div
          className="h-screen w-screen flex flex-col overflow-hidden bg-surface-0 relative"
          {...handlers}
        >
          {activeWindowChrome !== 'system' && <Titlebar />}
          <UpdateBanner />
          <StorageQuotaBanner />
          <div className="flex flex-1 min-h-0">
            <Rail />
            {/* Resizable sidebar wrapper — hidden on welcome hub */}
            {showSidebar && (
              <>
                <div className="shrink-0 flex flex-col min-h-0 overflow-hidden" style={{ width: sidebarWidth }}>
                  <Sidebar />
                </div>
                {/* Sidebar drag handle */}
                <ResizeHandle
                  label="Drag to resize sidebar"
                  onMouseDown={handleSidebarResizeMouseDown}
                  withLine={false}
                  className="border-r border-border-1"
                />
              </>
            )}
            <ErrorBoundary><MainArea /></ErrorBoundary>
          </div>
          <StatusBar />
          {dragOver && <DropOverlay preview={dropPreview} />}
          {dropFeedback && <DropToast feedback={dropFeedback} />}
        </div>
        <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
        <ConfirmDialogHost />
        {import.meta.env.DEV && <DevLogOverlay visible={devLogVisible} onClose={toggleDevTools} />}
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
