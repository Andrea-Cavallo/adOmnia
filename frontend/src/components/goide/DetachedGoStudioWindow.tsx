import { ThemeProvider } from '@/components/themes/ThemeProvider'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { ConfirmDialogHost } from '@/components/ui/ConfirmDialogHost'
import { useAppInit } from '@/hooks/useAppInit'
import { useAppearance } from '@/hooks/useAppearance'
import { goStudioWindowContext } from '@/lib/goide-window-api'
import { GoStudioCloseGuard } from './GoStudioCloseGuard'
import { GoStudioPanel } from './GoStudioPanel'

/**
 * Finestra Go Studio separata: un solo progetto, senza rail né pannelli adOmnia. Il backend è lo
 * stesso della finestra principale; i buffer non salvati vivono solo qui.
 */
export function DetachedGoStudioWindow() {
  useAppInit()
  useAppearance()
  const { windowId } = goStudioWindowContext()

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-0">
          <GoStudioPanel />
        </div>
        <ConfirmDialogHost />
        <GoStudioCloseGuard windowId={windowId} />
      </ThemeProvider>
    </ErrorBoundary>
  )
}
