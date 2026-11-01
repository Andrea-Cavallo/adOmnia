import { monaco } from '@/lib/monacoSetup'
import { httpFileRequests } from '@/lib/code-studio/httpFile'
import { showEntityNotice } from '@/lib/entities/notice'
import { routeToModule } from '@/lib/moduleRouting'
import { documentForModel } from './codeStudioLanguageFeatures'

const OPEN_COMMAND = 'codeStudio.httpFile.open'
let registered = false

/** Opens one request of a .http file in an API Workspace tab: {{variables}} resolve from the active environment there. */
async function openRequest(name: string, text: string): Promise<void> {
  try {
    const { parseInteropFile } = await import('@/lib/interopHub')
    const request = parseInteropFile(name, text).collections[0]?.children[0]
    if (!request || !('method' in request)) throw new Error('no request in this block')
    routeToModule('collections', { kind: 'open-request', request: { ...request, name: `${request.method} ${request.url}` } })
  } catch (error) {
    showEntityNotice(`${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** .http / .rest files: a lens on every request opens it in the API Workspace. Once per process. */
export function registerCodeStudioHttpFile(): void {
  if (registered) return
  registered = true
  monaco.editor.registerCommand(OPEN_COMMAND, (_accessor, name: string, text: string) => void openRequest(name, text))
  monaco.languages.registerCodeLensProvider('http', {
    provideCodeLenses: (model) => {
      const document = documentForModel(model)
      if (!document) return { lenses: [], dispose: () => undefined }
      const name = document.document.relativePath.split('/').pop() ?? 'requests.http'
      const lenses = httpFileRequests(model.getValue()).map((request) => ({
        range: { startLineNumber: request.line, startColumn: 1, endLineNumber: request.line, endColumn: 1 },
        command: { id: OPEN_COMMAND, title: `▶ Open ${request.method} in API Workspace`, arguments: [name, request.text] },
      }))
      return { lenses, dispose: () => undefined }
    },
  })
}
