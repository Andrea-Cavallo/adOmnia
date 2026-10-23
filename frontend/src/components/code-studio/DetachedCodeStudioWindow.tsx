import { ThemeProvider } from '@/components/themes/ThemeProvider'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { ConfirmDialogHost } from '@/components/ui/ConfirmDialogHost'
import { useAppInit } from '@/hooks/useAppInit'
import { useAppearance } from '@/hooks/useAppearance'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useAppStore } from '@/stores/app'
import { PanelActiveContext, PanelVisibleContext } from '@/components/layout/PanelActivity'
const PdfEditorPanel = lazy(() => import('@/components/pdfeditor/PdfEditorPanel').then(m => ({ default: m.PdfEditorPanel })))
import { codeStudioWindowContext } from '@/lib/code-studio-window-api'
import { startModuleActionListener } from '@/lib/moduleRouting'
import { CodeStudioCloseGuard } from './CodeStudioCloseGuard'
import { CodeStudioPanel } from './CodeStudioPanel'

/**
 * Finestra Code Studio separata: un solo progetto, senza rail né pannelli adOmnia. Il backend è lo
 * stesso della finestra principale; i buffer non salvati vivono solo qui.
 */
export function DetachedCodeStudioWindow() {
  const pdfOpen = useAppStore(s => s.activeRail === 'pdfeditor')
  const [pdfMounted, setPdfMounted] = useState(false)
  if (pdfOpen && !pdfMounted) setPdfMounted(true)
  useAppInit()
  useAppearance()
  const { windowId } = codeStudioWindowContext()
  // Links from this project (open in API client, database, broker…) go to the window that owns the module.
  useEffect(() => { startModuleActionListener() }, [])

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-0">
          <div className={pdfOpen ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}><PanelActiveContext value={!pdfOpen}><PanelVisibleContext value={!pdfOpen}><CodeStudioPanel /></PanelVisibleContext></PanelActiveContext></div>
          {(pdfOpen || pdfMounted) && <div className={pdfOpen ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
            <button type="button" className="shrink-0 self-start px-3 py-2 text-xs text-accent" onClick={() => useAppStore.getState().setActiveRail('codestudio')}>← Code Studio</button>
            <div className="min-h-0 flex-1"><Suspense fallback={null}><PdfEditorPanel /></Suspense></div>
          </div>}
        </div>
        <ConfirmDialogHost />
        <CodeStudioCloseGuard windowId={windowId} />
      </ThemeProvider>
    </ErrorBoundary>
  )
}
