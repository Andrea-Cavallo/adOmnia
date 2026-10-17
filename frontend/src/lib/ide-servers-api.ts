import * as GoIDEBindings from '../../bindings/adomnia/goide'
import type { LanguageServerStatus, ServerInstallPreview, Execution } from '../../bindings/adomnia/internal/codestudio/models'
import type { ServerInfo } from '../../bindings/adomnia/internal/ide/lsp/models'

/** Language server gestiti da adOmnia (web, Java…): stessa API per ogni linguaggio. */
export type LanguageServerInfo = ServerInfo
export type LanguageServerRunStatus = LanguageServerStatus
export type LanguageServerInstallPreview = ServerInstallPreview

export function languageServers(sessionId: string): Promise<LanguageServerInfo[]> {
  return GoIDEBindings.ProvidedLanguageServers(sessionId)
}

export function startLanguageServer(sessionId: string, languageId: string): Promise<LanguageServerRunStatus> {
  return GoIDEBindings.StartProvidedLanguageServer(sessionId, languageId)
}

export function stopLanguageServer(sessionId: string, languageId: string): Promise<void> {
  return GoIDEBindings.StopProvidedLanguageServer(sessionId, languageId)
}

/** Il comando esatto che l'installazione eseguirebbe, da mostrare nella conferma. */
export function previewServerInstall(sessionId: string, languageId: string): Promise<LanguageServerInstallPreview> {
  return GoIDEBindings.PreviewServerInstall(sessionId, languageId)
}

export function installLanguageServer(sessionId: string, languageId: string): Promise<Execution> {
  return GoIDEBindings.InstallProvidedLanguageServer(sessionId, languageId, true)
}
