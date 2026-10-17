import type { monaco } from '@/lib/monacoSetup'
import { showModule } from '@/lib/moduleRouting'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { openHttpRouteAt } from './codeStudioCodeLens'
import type { CodeStudioCommandId } from './codeStudioCommands'

const NO_ROUTE_MESSAGE = 'Place the caret on a route registration (http.HandleFunc, r.GET, e.POST, r.Get…) to open it in the API client.'

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
    default:
      return false
  }
}
