import { ThemeProvider } from '@/components/themes/ThemeProvider'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { useAppInit } from '@/hooks/useAppInit'
import { useAppearance } from '@/hooks/useAppearance'
import { ApiDocsPanel } from './ApiDocsPanel'

// This intentionally renders only the editor: no rail, sidebar or application
// titlebar consumes space in the companion window.
export function DetachedSwaggerEditorWindow() {
  useAppInit()
  useAppearance()

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <div className="h-screen w-screen overflow-hidden bg-surface-0">
          <ApiDocsPanel standalone />
        </div>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
