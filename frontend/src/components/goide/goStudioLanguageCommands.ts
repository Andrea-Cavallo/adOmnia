import { confirm } from '@/lib/confirmDialog'
import { useGoIDELspStore } from '@/stores/goideLsp'
import type { GoStudioCommandId } from './goStudioCommands'
import { activeGoStudioEditor } from './goStudioEditorRegistry'

/** Testo selezionato nell'editor attivo, usato per precompilare Find in Files. */
function selectedText(): string {
  const editor = activeGoStudioEditor()
  const selection = editor?.getSelection()
  const model = editor?.getModel()
  if (!selection || !model || selection.isEmpty()) return ''
  const text = model.getValueInRange(selection)
  return text.includes('\n') ? '' : text
}

async function confirmInstall(sessionId: string): Promise<void> {
  const lsp = useGoIDELspStore.getState()
  const approved = await confirm({
    title: 'Install gopls?',
    message: 'Command: go install golang.org/x/tools/gopls@latest\n\nDownloads gopls through your Go proxy and installs it into adOmnia\'s local tools folder. It uses the Go SDK selected for this project. Output appears in the Run console.',
    confirmLabel: 'Install gopls',
  })
  if (!approved) return
  if (await lsp.install(sessionId)) lsp.showToolWindow('run')
}

/**
 * Esegue i comandi del language server e delle preferenze di codice.
 * Restituisce false se il comando non appartiene a quest'area.
 */
export function runLanguageCommand(id: GoStudioCommandId, sessionId: string | null): boolean {
  const lsp = useGoIDELspStore.getState()
  switch (id) {
    case 'nav.findInFiles': lsp.requestFind(selectedText()); return true
    case 'view.problems': lsp.showToolWindow('problems'); return true
    case 'code.formatOnSave': lsp.updatePreferences({ formatOnSave: !lsp.preferences.formatOnSave }); return true
    case 'code.importsOnSave': lsp.updatePreferences({ organizeImportsOnSave: !lsp.preferences.organizeImportsOnSave }); return true
    case 'code.gofumpt': void lsp.updateSettings(sessionId, { gofumpt: !lsp.settings.gofumpt }); return true
    case 'code.staticcheck': void lsp.updateSettings(sessionId, { staticcheck: !lsp.settings.staticcheck }); return true
  }
  if (!sessionId) return false
  switch (id) {
    case 'go.lspStart': void lsp.start(sessionId); return true
    case 'go.lspRestart': void lsp.restart(sessionId); return true
    case 'go.lspStop': void lsp.stop(sessionId); return true
    case 'go.lspInstall': void confirmInstall(sessionId); return true
    default: return false
  }
}
