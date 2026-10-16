import { ThemeProvider } from '@/components/themes/ThemeProvider'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { ConfirmDialogHost } from '@/components/ui/ConfirmDialogHost'
import { useAppInit } from '@/hooks/useAppInit'
import { useAppearance } from '@/hooks/useAppearance'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useAppStore } from '@/stores/app'
import { PanelActiveContext, PanelVisibleContext } from '@/components/layout/PanelActivity'
const PdfEditorPanel = lazy(() => import('@/components/pdfeditor/PdfEditorPanel').then(m => ({ default: m.PdfEditorPanel })))
import { goStudioWindowContext } from '@/lib/goide-window-api'
import { startModuleActionListener } from '@/lib/moduleRouting'
import { GoStudioCloseGuard } from './GoStudioCloseGuard'
import { GoStudioPanel } from './GoStudioPanel'

/**
 * Finestra Go Studio separata: un solo progetto, senza rail né pannelli adOmnia. Il backend è lo
 * stesso della finestra principale; i buffer non salvati vivono solo qui.
 */
export function DetachedGoStudioWindow() {
  const pdfOpen = useAppStore(s => s.activeRail === 'pdfeditor')
  const [pdfMounted, setPdfMounted] = useState(false)
  useEffect(() => { if (pdfOpen) setPdfMounted(true) }, [pdfOpen])
  useAppInit()
  useAppearance()
  const { windowId } = goStudioWindowContext()
  // Links from this project (open in API client, database, broker…) go to the window that owns the module.
  useEffect(() => { startModuleActionListener() }, [])

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-0">
          <div className={pdfOpen ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}><PanelActiveContext value={!pdfOpen}><PanelVisibleContext value={!pdfOpen}><GoStudioPanel /></PanelVisibleContext></PanelActiveContext></div>
          {(pdfOpen || pdfMounted) && <div className={pdfOpen ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
            <button type="button" className="shrink-0 self-start px-3 py-2 text-xs text-accent" onClick={() => useAppStore.getState().setActiveRail('goide')}>← gO Studio</button>
            <div className="min-h-0 flex-1"><Suspense fallback={null}><PdfEditorPanel /></Suspense></div>
          </div>}
        </div>
        <ConfirmDialogHost />
        <GoStudioCloseGuard windowId={windowId} />
      </ThemeProvider>
    </ErrorBoundary>
  )
}
