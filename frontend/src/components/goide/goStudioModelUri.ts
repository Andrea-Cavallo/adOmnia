import { monaco } from '@/lib/monacoSetup'

/**
 * URI del modello Monaco di un documento: il file più la sessione. Lo stesso file aperto in due
 * progetti (es. /repo e /repo/svc) ha così due modelli e due buffer indipendenti.
 */
export function editorModelUri(document: { uri: string; sessionId: string }): string {
  return monaco.Uri.parse(document.uri).with({ fragment: `session=${document.sessionId}` }).toString()
}

/** URI del file su disco, confrontabile con quelli restituiti da gopls. */
export function fileUri(uri: string): string {
  return monaco.Uri.parse(uri).with({ fragment: '' }).toString()
}

let cleanupInstalled = false

/**
 * The editors keep their models (`keepCurrentModel`): an editor unmounting (Markdown preview, a closed
 * split) must not dispose a model another editor or Monaco feature still uses. Models are released
 * here instead, when their document closes.
 */
export async function releaseModelsOfClosedDocuments(): Promise<void> {
  if (cleanupInstalled) return
  cleanupInstalled = true
  const { useGoIDEStore } = await import('@/stores/goide')
  useGoIDEStore.subscribe((state, previous) => {
    if (state.documents === previous.documents) return
    const open = new Set(state.documents.map((item) => editorModelUri(item.document)))
    const closed = previous.documents.map((item) => editorModelUri(item.document)).filter((uri) => !open.has(uri))
    // After React has switched the editors to the next document.
    if (closed.length) window.setTimeout(() => closed.forEach((uri) => monaco.editor.getModel(monaco.Uri.parse(uri))?.dispose()), 0)
  })
}
