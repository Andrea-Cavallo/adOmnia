import { Download, X } from 'lucide-react'
import { ideLanguage } from '@/components/ide/languages'
import { useIdeLanguageServersStore, serverLanguageForEditor, serverEntry } from '@/stores/ideLanguageServers'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { showInstallOutput } from '@/stores/codeStudioToolInstall'

/**
 * Una riga sopra l'editor quando il language server del file non c'è: l'editor funziona lo stesso
 * con le funzioni di Monaco, e l'installazione è un'azione esplicita dell'utente.
 */
export function CodeStudioServerNotice({ document }: { document: GoIDEEditorDocument }) {
  const sessionId = document.document.sessionId
  const languageId = serverLanguageForEditor(document.document.language)
  const entry = useIdeLanguageServersStore((state) => (languageId ? serverEntry(state, sessionId, languageId) : null))
  const dismissed = useIdeLanguageServersStore((state) => (languageId ? state.dismissed[sessionId]?.[languageId] : true))
  const installing = useIdeLanguageServersStore((state) => !!(languageId && state.installing[sessionId]?.[languageId]))
  if (!languageId || !entry || dismissed || (entry.state !== 'missing' && !installing)) return null
  const name = ideLanguage(languageId)?.languageServer ?? 'language server'
  // oxlint-disable-next-line react/hooks -- Zustand store access (getState), not a hook call
  const actions = useIdeLanguageServersStore.getState()

  return (
    <div role="status" className="flex shrink-0 items-center gap-2 border-b border-border-1 bg-surface-2 px-2 py-1 text-[10.5px] text-text-3">
      <Download size={12} className="shrink-0 text-accent" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate" title={entry.error}>
        {installing ? `Installing ${name}… the progress is in the Run console.` : (entry.error ?? `${name} is not installed: completion, diagnostics and navigation use the built-in editor features.`)}
      </span>
      {installing
        ? <button type="button" onClick={showInstallOutput} className="shrink-0 rounded px-1.5 py-0.5 text-accent hover:bg-surface-3">Show output</button>
        : entry.installable && <button type="button" onClick={() => void actions.confirmInstall(sessionId, languageId)} className="shrink-0 rounded px-1.5 py-0.5 text-accent hover:bg-surface-3">Install…</button>}
      <button type="button" onClick={() => actions.dismiss(sessionId, languageId)} aria-label="Dismiss" className="grid h-5 w-5 shrink-0 place-items-center rounded hover:bg-surface-3"><X size={11} /></button>
    </div>
  )
}
