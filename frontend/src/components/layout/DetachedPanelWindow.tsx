import { Suspense, useEffect } from 'react'
import { ArrowDownToLine } from 'lucide-react'
import { ThemeProvider } from '@/components/themes/ThemeProvider'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { ConfirmDialogHost } from '@/components/ui/ConfirmDialogHost'
import { TitlebarWindowControls, useWindowTitlebar } from '@/components/layout/Titlebar'
import { useAppInit } from '@/hooks/useAppInit'
import { useAppearance } from '@/hooks/useAppearance'
import { useWorkspaceHydration } from '@/hooks/useWorkspaceHydration'
import type { RailItem } from '@/lib/navigation'
import { closePanelWindow } from '@/lib/panel-windows-api'
import { startModuleActionListener, useModuleEpoch } from '@/lib/moduleRouting'
import { useUiTranslation } from '@/lib/uiI18n'
import { useAppStore } from '@/stores/app'
import { panelFor } from './MainAreaRouter'
import { usePanelLabel } from './panelLabel'

function Loading() {
  return <div className="flex flex-1 items-center justify-center"><div className="h-5 w-5 animate-spin rounded-full border-2 border-text-3 border-t-transparent" /></div>
}

/** One adOmnia module in its own window: no rail and no Hub, the same backend as the main window. */
export function DetachedPanelWindow({ rail }: { rail: RailItem }) {
  useAppInit()
  useAppearance()
  const tr = useUiTranslation()
  const titlebar = useWindowTitlebar()
  const hydrated = useWorkspaceHydration()
  const { component, titleKey } = panelFor(rail)
  const label = usePanelLabel(rail, titleKey)
  const epoch = useModuleEpoch(rail)
  // Links from the code (Go Studio, other windows) reach this module here.
  useEffect(() => { startModuleActionListener() }, [])

  // Panels that read the active rail behave as if they were selected in the main window.
  useEffect(() => { useAppStore.setState({ activeRail: rail }) }, [rail])
  useEffect(() => { document.title = `${label} · adOmnia` }, [label])

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-0">
          <div {...titlebar.props} className={`flex h-10 shrink-0 items-center gap-2 border-b border-border-1 bg-surface-1 pl-3 ${titlebar.active ? 'app-titlebar' : 'pr-3'}`}>
            <span className="flex-1 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-2">{label}</span>
            <button
              type="button"
              onClick={() => void closePanelWindow(rail)}
              title={tr('Bring back to the main window')}
              aria-label={tr('Bring back to the main window')}
              className="flex h-6 items-center gap-1.5 rounded px-2 text-[11px] text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1"
            >
              <ArrowDownToLine size={12} />{tr('Bring back to the main window')}
            </button>
            <TitlebarWindowControls />
          </div>
          <div key={epoch} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {rail === 'collections' && !hydrated ? <Loading /> : <Suspense fallback={<Loading />}>{component}</Suspense>}
          </div>
        </div>
        <ConfirmDialogHost />
      </ThemeProvider>
    </ErrorBoundary>
  )
}
