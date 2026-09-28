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
