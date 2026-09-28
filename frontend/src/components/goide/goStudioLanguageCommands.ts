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

const INSTALLABLE_TOOLS = {
  gopls: { module: 'golang.org/x/tools/gopls@latest', label: 'gopls' },
  'golangci-lint': { module: 'github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest', label: 'golangci-lint' },
  staticcheck: { module: 'honnef.co/go/tools/cmd/staticcheck@latest', label: 'staticcheck' },
} as const

/** Installazione sempre esplicita: mostra il comando esatto e dove finisce il binario. */
async function confirmInstall(sessionId: string, tool: keyof typeof INSTALLABLE_TOOLS): Promise<void> {
  const lsp = useGoIDELspStore.getState()
  const { module, label } = INSTALLABLE_TOOLS[tool]
  const approved = await confirm({
    title: `Install ${label}?`,
    message: `Command: go install ${module}\n\nDownloads ${label} through your Go proxy and installs it into adOmnia's local tools folder, using the Go SDK selected for this project. Output appears in the Run console.`,
    confirmLabel: `Install ${label}`,
  })
  if (!approved) return
  const started = tool === 'gopls' ? await lsp.install(sessionId) : await lsp.installLinter(sessionId, tool)
  if (started) lsp.showToolWindow('run')
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
    case 'view.terminal': lsp.showToolWindow('terminal'); return true
    case 'code.formatOnSave': lsp.updatePreferences({ formatOnSave: !lsp.preferences.formatOnSave }); return true
    case 'code.importsOnSave': lsp.updatePreferences({ organizeImportsOnSave: !lsp.preferences.organizeImportsOnSave }); return true
    case 'code.gofumpt': void lsp.updateSettings(sessionId, { gofumpt: !lsp.settings.gofumpt }); return true
    case 'code.staticcheck': void lsp.updateSettings(sessionId, { staticcheck: !lsp.settings.staticcheck }); return true
    case 'code.lintOnSave': lsp.updatePreferences({ lintOnSave: !lsp.preferences.lintOnSave }); return true
  }
  if (!sessionId) return false
  switch (id) {
    case 'go.lspStart': void lsp.start(sessionId); return true
    case 'go.lspRestart': void lsp.restart(sessionId); return true
    case 'go.lspStop': void lsp.stop(sessionId); return true
    case 'go.lspInstall': void confirmInstall(sessionId, 'gopls'); return true
    case 'go.installGolangci': void confirmInstall(sessionId, 'golangci-lint'); return true
    case 'go.installStaticcheck': void confirmInstall(sessionId, 'staticcheck'); return true
    case 'code.lint': lsp.showToolWindow('problems'); void lsp.runLint(sessionId); return true
    default: return false
  }
}
