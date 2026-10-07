import { useEffect, useState } from 'react'
import { Events } from '@wailsio/runtime'
import * as AppBindings from '../../../bindings/adomnia/app'
import { ThemeProvider } from '@/components/themes/ThemeProvider'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { TitlebarWindowControls, useWindowTitlebar } from '@/components/layout/Titlebar'
import { useAppInit } from '@/hooks/useAppInit'
import { useAppearance } from '@/hooks/useAppearance'
import { useGoIDEStore } from '@/stores/goide'
import { startStudioToolClient, flushStudioToolView } from './studioToolBridge'
import { toolContext, toolTitle, useStudioTools } from './studioToolState'
import { GoStudioRunPanel } from './GoStudioRunPanel'
import { GoStudioCopilotChat } from './GoStudioCopilotChat'
import { GoStudioMilkChat } from './GoStudioMilkChat'
import { StudioToolControls } from './StudioToolControls'
import '@fontsource/inter/400.css'
import '@fontsource/jetbrains-mono/400.css'
import './goStudioChrome.css'

export function DetachedStudioToolWindow() {
  useAppInit()
  useAppearance()
  const context = toolContext()!
  const titlebar = useWindowTitlebar()
  const [ready, setReady] = useState(false)
  const session = useGoIDEStore((state) => state.sessions[0])
  const document = useGoIDEStore((state) => state.documents[0] ?? null)
  const error = useStudioTools((state) => state.error)
  useEffect(() => {
    startStudioToolClient(() => setReady(true))
    return Events.On('panelwindow:close-requested', (event) => {
      if (event.data === context.key) void flushStudioToolView().finally(() => AppBindings.ConfirmPanelWindowClose(context.key))
    })
  }, [context.key])
  return <ErrorBoundary><ThemeProvider>
    <div className="go-studio-root flex h-screen min-h-0 flex-col bg-surface-0">
      <div {...titlebar.props} className={`flex h-10 shrink-0 items-center gap-2 border-b border-border-1 bg-surface-1 pl-3 ${titlebar.active ? 'app-titlebar' : 'pr-3'}`}>
        <span className="min-w-0 flex-1 truncate text-xs text-text-2">{toolTitle[context.tool]} · {session?.project.name ?? 'adOmnia'}</span>
        <StudioToolControls session={context.session} tool={context.tool} />
        <TitlebarWindowControls />
      </div>
      {error && <p role="alert" className="p-2 text-xs text-danger">{error}</p>}
      {!ready || !session ? <p className="p-4 text-sm text-text-3">Connecting to the project window…</p> : <div className="flex min-h-0 flex-1 flex-col">
        {context.tool === 'milk' ? <GoStudioMilkChat session={session} document={document} /> : context.tool === 'copilot' ? <GoStudioCopilotChat session={session} document={document} /> : <GoStudioRunPanel session={session} fixedView={context.tool === 'terminal' ? 'terminal' : 'run'} logsOnly={context.tool === 'logs'} standalone />}
      </div>}
    </div>
  </ThemeProvider></ErrorBoundary>
}
