import { confirm } from '@/lib/confirmDialog'
import { useGoIDELspStore, EDITOR_FONT_SIZE } from '@/stores/goideLsp'
import { clearLintBaseline, linterConfigFile, saveLintBaseline } from '@/lib/goide-lsp-api'
import { useGoIDEStore } from '@/stores/goide'
import { exportGoStudioSettingsReport } from './goStudioSettingsExport'
import { setGoIDEAIPolicy, type GoIDEAIPolicy } from '@/lib/goide-api'
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
    case 'view.contextInspector': lsp.showToolWindow('context'); return true
    case 'view.terminal': lsp.showToolWindow('terminal'); return true
    case 'view.tests': lsp.showToolWindow('tests'); return true
    case 'view.todo': lsp.showToolWindow('todo'); return true
    case 'view.profile': lsp.showToolWindow('profile'); return true
    case 'view.trace': lsp.showToolWindow('trace'); return true
    case 'view.sonar': lsp.showToolWindow('sonar'); return true
    case 'view.vulnerabilities': lsp.showToolWindow('vulns'); return true
    case 'code.formatOnSave': lsp.updatePreferences({ formatOnSave: !lsp.preferences.formatOnSave }); return true
    case 'code.importsOnSave': lsp.updatePreferences({ organizeImportsOnSave: !lsp.preferences.organizeImportsOnSave }); return true
    case 'code.gofumpt': void lsp.updateSettings(sessionId, { gofumpt: !lsp.settings.gofumpt }); return true
    case 'code.staticcheck': void lsp.updateSettings(sessionId, { staticcheck: !lsp.settings.staticcheck }); return true
    case 'code.vulncheck': void toggleVulncheck(sessionId); return true
    case 'code.lintOnSave': lsp.updatePreferences({ lintOnSave: !lsp.preferences.lintOnSave }); return true
    case 'code.semanticHighlighting': lsp.updatePreferences({ semanticHighlighting: !lsp.preferences.semanticHighlighting }); return true
    case 'code.inlayHints': lsp.updatePreferences({ inlayHints: !lsp.preferences.inlayHints }); return true
    case 'code.typeHints': lsp.updatePreferences({ typeHints: !lsp.preferences.typeHints }); return true
    case 'view.stickyScroll': lsp.updatePreferences({ stickyScroll: !lsp.preferences.stickyScroll }); return true
    case 'view.previewTab': lsp.updatePreferences({ previewTab: !lsp.preferences.previewTab }); return true
    // Le due modalità si escludono: riselezionare quella attiva torna a normal.
    case 'view.lowResourceMode': lsp.updatePreferences({ resourceMode: lsp.preferences.resourceMode === 'low' ? 'normal' : 'low' }); return true
    case 'view.vimMode': lsp.updatePreferences({ editorMode: lsp.preferences.editorMode === 'vim' ? 'default' : 'vim' }); return true
    case 'view.emacsMode': lsp.updatePreferences({ editorMode: lsp.preferences.editorMode === 'emacs' ? 'default' : 'emacs' }); return true
    case 'view.lowResourceOnBattery': lsp.updatePreferences({ resourceMode: lsp.preferences.resourceMode === 'auto' ? 'normal' : 'auto' }); return true
    case 'view.fontLigatures': lsp.updatePreferences({ fontLigatures: !lsp.preferences.fontLigatures }); return true
    case 'file.autoSave': lsp.updatePreferences({ autoSave: !lsp.preferences.autoSave }); return true
    case 'file.trimWhitespace': lsp.updatePreferences({ trimTrailingWhitespace: !lsp.preferences.trimTrailingWhitespace }); return true
    case 'view.zoomIn': lsp.updatePreferences({ fontSize: Math.min(EDITOR_FONT_SIZE.max, lsp.preferences.fontSize + 1) }); return true
    case 'view.zoomOut': lsp.updatePreferences({ fontSize: Math.max(EDITOR_FONT_SIZE.min, lsp.preferences.fontSize - 1) }); return true
    case 'view.zoomReset': lsp.updatePreferences({ fontSize: EDITOR_FONT_SIZE.default }); return true
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
    case 'code.lintChanged': lsp.showToolWindow('problems'); void lsp.runLint(sessionId, true); return true
    case 'code.lintConfig': void openLinterConfig(sessionId); return true
    case 'tools.aiPolicyAllowed': void applyAIPolicy(sessionId, 'allowed'); return true
    case 'tools.aiPolicyLocal': void applyAIPolicy(sessionId, 'local-only'); return true
    case 'tools.aiPolicyOff': void applyAIPolicy(sessionId, 'off'); return true
    case 'tools.exportSettings': void exportGoStudioSettingsReport(sessionId); return true
    case 'code.lintBaseline': void updateLintBaseline(sessionId, true); return true
    case 'code.lintBaselineClear': void updateLintBaseline(sessionId, false); return true
    default: return false
  }
}

const AI_POLICY_MESSAGE: Record<GoIDEAIPolicy, string> = {
  allowed: 'AI may read this project with any configured provider (secrets and .adomnia/aiignore stay excluded).',
  'local-only': 'This project now allows only local AI models (Ollama or a localhost endpoint). Saved in .adomnia/ai-policy.json: commit it to share the rule.',
  off: 'AI is off for this project: no file is sent to any provider. Saved in .adomnia/ai-policy.json: commit it to share the rule.',
}

/** Politica AI del progetto, versionabile: vale per Fix with AI e per Copilot. */
async function applyAIPolicy(sessionId: string, policy: GoIDEAIPolicy): Promise<void> {
  try {
    await setGoIDEAIPolicy(sessionId, policy)
    useGoIDELspStore.setState({ message: AI_POLICY_MESSAGE[policy] })
  } catch (error) {
    useGoIDELspStore.setState({ message: error instanceof Error ? error.message : String(error) })
  }
}

/** Apre la configurazione del linter del progetto; se manca, la crea solo dopo conferma. */
async function openLinterConfig(sessionId: string): Promise<void> {
  try {
    let path = await linterConfigFile(sessionId, false)
    if (!path) {
      if (!await confirm({
        title: 'Create linter configuration?',
        message: 'This project has no .golangci.yml or staticcheck.conf. A minimal configuration for the detected linter is written to the project root and opened: commit it to share the rules with your team.',
        confirmLabel: 'Create',
      })) return
      path = await linterConfigFile(sessionId, true)
    }
    await useGoIDEStore.getState().openDocument(path)
  } catch (error) {
    useGoIDELspStore.setState({ message: error instanceof Error ? error.message : String(error) })
  }
}

/** Baseline del linter: i problemi attuali diventano accettati e si vedono solo quelli nuovi. */
async function updateLintBaseline(sessionId: string, save: boolean): Promise<void> {
  const lsp = useGoIDELspStore.getState()
  if (save && !await confirm({
    title: 'Save lint baseline?',
    message: 'The linter runs on the whole project and every current finding is written to .adomnia/lint-baseline.json. From then on only new findings are shown. Commit the file to share the baseline with your team.',
    confirmLabel: 'Save baseline',
  })) return
  try {
    if (save) {
      const count = await saveLintBaseline(sessionId)
      useGoIDELspStore.setState({ message: `Lint baseline saved: ${count} finding${count === 1 ? '' : 's'} will be hidden.` })
    } else {
      await clearLintBaseline(sessionId)
      useGoIDELspStore.setState({ message: 'Lint baseline removed: every finding is shown again.' })
    }
    lsp.showToolWindow('problems')
    await useGoIDELspStore.getState().runLint(sessionId)
  } catch (error) {
    useGoIDELspStore.setState({ message: error instanceof Error ? error.message : String(error) })
  }
}

/** Local-first: attivarla scarica il database delle vulnerabilità, quindi chiede conferma. */
async function toggleVulncheck(sessionId: string | null): Promise<void> {
  const lsp = useGoIDELspStore.getState()
  if (!lsp.settings.vulncheck) {
    const approved = await confirm({
      title: 'Turn on vulnerability diagnostics?',
      message: 'gopls will download the Go vulnerability database from vuln.go.dev and mark the go.mod requirements whose code you import that have known vulnerabilities. Your source code is not sent.',
      confirmLabel: 'Turn on',
    })
    if (!approved) return
  }
  await lsp.updateSettings(sessionId, { vulncheck: !lsp.settings.vulncheck })
}
