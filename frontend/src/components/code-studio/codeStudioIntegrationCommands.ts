import type { monaco } from '@/lib/monacoSetup'
import { showModule, routeToModule } from '@/lib/moduleRouting'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { findHttpRoutes } from './codeStudioHttpRoutes'
import { openHttpRouteAt } from './codeStudioCodeLens'
import type { CodeStudioCommandId } from './codeStudioCommands'

const NO_ROUTE_MESSAGE = 'Place the caret on a route registration (http.HandleFunc, r.GET, e.POST, r.Get…) to open it in the API client.'
const NO_HANDLER_MESSAGE = 'Place the caret on an HTTP handler or a route registration to open the matching request.'

/** Comandi del menu Tools; false se il comando non appartiene a quest'area. */
export function runIntegrationCommand(id: CodeStudioCommandId, document: GoIDEEditorDocument | null, editor: monaco.editor.ICodeEditor | null, openServices: () => void): boolean {
  switch (id) {
    case 'tools.services': openServices(); return true
    case 'tools.plugins': showModule('plugins'); return true
    case 'tools.httpRequest': {
      const line = editor?.getPosition()?.lineNumber
      if (!document || !line || !openHttpRouteAt(document, line)) useCodeStudioLspStore.setState({ message: NO_ROUTE_MESSAGE })
      return true
    }
    case 'tools.openInApiWorkspace': {
      if (!document) {
        useCodeStudioLspStore.setState({ message: NO_HANDLER_MESSAGE })
        return true
      }
      const line = editor?.getPosition()?.lineNumber ?? 1
      const registration = findHttpRoutes(document.buffer).find((route) => route.line === line)
      routeToModule('collections', {
        kind: 'api-code-handler',
        sessionId: document.document.sessionId,
        file: document.document.relativePath,
        line,
        fallback: registration ? { method: registration.method, path: registration.path, label: registration.anyMethod ? registration.path : `${registration.method} ${registration.path}` } : undefined,
      })
      return true
    }
    default:
      return false
  }
}
