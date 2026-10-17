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

/** Release only reconstructible models. Monaco owns undo history: never discard it. */
export function releaseDormantModels(documents: readonly { document: { uri: string; sessionId: string }; dirty: boolean; buffer: string }[]): void {
  for (const document of documents) {
    const model = monaco.editor.getModel(monaco.Uri.parse(editorModelUri(document.document)))
    if (!model || document.dirty || model.isAttachedToEditor() || model.canUndo() || model.canRedo()) continue
    // A concurrent edit not yet reflected by the store must also survive.
    if (model.getValue() === document.buffer) model.dispose()
  }
}

/**
 * The editors keep their models (`keepCurrentModel`): an editor unmounting (Markdown preview, a closed
 * split) must not dispose a model another editor or Monaco feature still uses. Models are released
 * here instead, when their document closes.
 */
export async function releaseModelsOfClosedDocuments(): Promise<void> {
  if (cleanupInstalled) return
  cleanupInstalled = true
  const { useCodeStudioStore } = await import('@/stores/codeStudio')
  useCodeStudioStore.subscribe((state, previous) => {
    if (state.documents === previous.documents) return
    const open = new Set(state.documents.map((item) => editorModelUri(item.document)))
    const closed = previous.documents.map((item) => editorModelUri(item.document)).filter((uri) => !open.has(uri))
    // After React has switched the editors to the next document.
    if (closed.length) window.setTimeout(() => {
      // A close/reopen can complete before this deferred cleanup. Never dispose
      // a model now owned by a reopened document or another editor.
      const current = new Set(useCodeStudioStore.getState().documents.map((item) => editorModelUri(item.document)))
      for (const uri of closed) {
        if (!current.has(uri)) monaco.editor.getModel(monaco.Uri.parse(uri))?.dispose()
      }
    }, 0)
  })
}
