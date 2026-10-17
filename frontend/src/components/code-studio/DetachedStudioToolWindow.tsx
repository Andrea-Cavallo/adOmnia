import { useActivityScope } from '@/hooks/useActivity'
import { useEffect, useState } from 'react'
import { Events } from '@wailsio/runtime'
import * as AppBindings from '../../../bindings/adomnia/app'
import { ThemeProvider } from '@/components/themes/ThemeProvider'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { TitlebarWindowControls, useWindowTitlebar } from '@/components/layout/Titlebar'
import { useAppInit } from '@/hooks/useAppInit'
import { useAppearance } from '@/hooks/useAppearance'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { startStudioToolClient, flushStudioToolView } from './studioToolBridge'
import { toolContext, toolTitle, useStudioTools } from './studioToolState'
import { CodeStudioRunPanel } from './CodeStudioRunPanel'
import { CodeStudioCopilotChat } from './CodeStudioCopilotChat'
import { CodeStudioOpenCodeChat } from './CodeStudioOpenCode'
import { CodeStudioMilkChat } from './CodeStudioMilkChat'
import { CodeStudioClaudeChat } from './CodeStudioClaudeCode'
import { StudioToolControls } from './StudioToolControls'
import { CodeStudioAgentReviewDialog } from './CodeStudioAgentReviewDialog'
import '@fontsource/inter/400.css'
import '@fontsource/jetbrains-mono/400.css'
import './codeStudioChrome.css'

export function DetachedStudioToolWindow() {
  useAppInit()
  useAppearance()
  const context = toolContext()!
  const titlebar = useWindowTitlebar()
  const [ready, setReady] = useState(false)
  const session = useCodeStudioStore((state) => state.sessions[0])
  useActivityScope(session?.id ? `code-studio:${session.id}` : null, true)
  const document = useCodeStudioStore((state) => state.documents[0] ?? null)
  const error = useStudioTools((state) => state.error)
  useEffect(() => {
    startStudioToolClient(() => setReady(true))
    return Events.On('panelwindow:close-requested', (event) => {
      if (event.data === context.key) void flushStudioToolView().finally(() => AppBindings.ConfirmPanelWindowClose(context.key))
    })
  }, [context.key])
  return <ErrorBoundary><ThemeProvider>
    <div className="code-studio-root flex h-screen min-h-0 flex-col bg-surface-0">
      <div {...titlebar.props} className={`flex h-10 shrink-0 items-center gap-2 border-b border-border-1 bg-surface-1 pl-3 ${titlebar.active ? 'app-titlebar' : 'pr-3'}`}>
        <span className="min-w-0 flex-1 truncate text-xs text-text-2">{toolTitle[context.tool]} · {session?.project.name ?? 'adOmnia'}</span>
        <StudioToolControls session={context.session} tool={context.tool} />
        <TitlebarWindowControls />
      </div>
      {error && <p role="alert" className="p-2 text-xs text-danger">{error}</p>}
      {!ready || !session ? <p className="p-4 text-sm text-text-3">Connecting to the project window…</p> : <div className="flex min-h-0 flex-1 flex-col">
        {context.tool === 'opencode' ? <CodeStudioOpenCodeChat session={session} document={document} /> : context.tool === 'milk' ? <CodeStudioMilkChat session={session} document={document} /> : context.tool === 'claude' ? <CodeStudioClaudeChat session={session} document={document} /> : context.tool === 'copilot' ? <CodeStudioCopilotChat session={session} document={document} /> : <CodeStudioRunPanel session={session} fixedView={context.tool === 'terminal' ? 'terminal' : 'run'} logsOnly={context.tool === 'logs'} standalone />}
      </div>}
      {(context.tool === 'milk' || context.tool === 'claude' || context.tool === 'opencode') && <CodeStudioAgentReviewDialog />}
    </div>
  </ThemeProvider></ErrorBoundary>
}
