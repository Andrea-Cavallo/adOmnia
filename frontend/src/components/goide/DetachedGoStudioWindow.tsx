import { ThemeProvider } from '@/components/themes/ThemeProvider'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { ConfirmDialogHost } from '@/components/ui/ConfirmDialogHost'
import { useAppInit } from '@/hooks/useAppInit'
import { useAppearance } from '@/hooks/useAppearance'
import { useEffect } from 'react'
import { goStudioWindowContext } from '@/lib/goide-window-api'
import { startModuleActionListener } from '@/lib/moduleRouting'
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
  // Links from this project (open in API client, database, broker…) go to the window that owns the module.
  useEffect(() => { startModuleActionListener() }, [])

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
