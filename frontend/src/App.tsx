import { Titlebar } from '@/components/layout/Titlebar'
import { Rail } from '@/components/layout/Rail'
import { Sidebar } from '@/components/layout/Sidebar'
import { MainArea } from '@/components/layout/MainArea'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { StatusBar } from '@/components/layout/StatusBar'
import { ThemeProvider } from '@/components/themes/ThemeProvider'
import { DevLogOverlay } from '@/components/ui/DevLogOverlay'
import { StorageQuotaBanner } from '@/components/layout/StorageQuotaBanner'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { DropOverlay } from '@/components/layout/DropOverlay'
import { DropToast } from '@/components/layout/DropToast'
import { useAppStore } from '@/stores/app'
import { useAppInit } from '@/hooks/useAppInit'
import { useAppearance } from '@/hooks/useAppearance'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useFileDrop } from '@/hooks/useFileDrop'

function App() {
  const { activeWindowChrome, commandPaletteOpen, setCommandPaletteOpen } = useAppInit()
  const { dragOver, dropFeedback, handlers } = useFileDrop()
  const devLogVisible  = useAppStore((s) => s.devToolsVisible)
  const toggleDevTools = useAppStore((s) => s.toggleDevTools)
  useAppearance()
  useKeyboardShortcuts({ setCommandPaletteOpen })

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <div
          className="h-screen w-screen flex flex-col overflow-hidden bg-surface-0 relative"
          {...handlers}
        >
          {activeWindowChrome !== 'system' && <Titlebar />}
          <StorageQuotaBanner />
          <div className="flex flex-1 min-h-0">
            <Rail />
            <Sidebar />
            <ErrorBoundary><MainArea /></ErrorBoundary>
          </div>
          <StatusBar />
          {dragOver && <DropOverlay />}
          {dropFeedback && <DropToast feedback={dropFeedback} />}
        </div>
        <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
        <DevLogOverlay visible={devLogVisible} onClose={toggleDevTools} />
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
