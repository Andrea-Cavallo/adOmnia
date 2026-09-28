export type GoStudioCommandId =
  | 'file.openProject' | 'file.newProject' | 'file.save' | 'file.saveAll' | 'file.closeEditor' | 'file.closeProject'
  | 'edit.undo' | 'edit.redo' | 'edit.find' | 'edit.replace' | 'edit.gotoLine' | 'edit.toggleComment'
  | 'view.quickOpen' | 'view.toggleStructure' | 'view.toggleBottom' | 'view.toggleIgnored' | 'view.problems'
  | 'nav.declaration' | 'nav.typeDeclaration' | 'nav.implementation' | 'nav.usages' | 'nav.fileStructure' | 'nav.symbol' | 'nav.findInFiles'
  | 'code.completion' | 'code.parameterInfo' | 'code.quickFix' | 'code.rename' | 'code.reformat' | 'code.organizeImports'
  | 'code.formatOnSave' | 'code.importsOnSave' | 'code.gofumpt' | 'code.staticcheck'
  | 'go.toolchains' | 'go.detect' | 'go.dependencies' | 'go.tidy' | 'go.trust'
  | 'go.lspStart' | 'go.lspRestart' | 'go.lspStop' | 'go.lspInstall' | 'go.lspLog'
  | 'run.run' | 'run.build' | 'run.stop' | 'run.restart' | 'run.configure'
  | 'help.shortcuts'

export type GoStudioMenuId = 'file' | 'edit' | 'view' | 'navigate' | 'code' | 'go' | 'run' | 'help'

export interface GoStudioKeyBinding {
  key: string
  mod?: boolean
  shift?: boolean
  alt?: boolean
}

export interface GoStudioCommand {
  id: GoStudioCommandId
  menu: GoStudioMenuId
  label: string
  binding?: GoStudioKeyBinding
  /** Il binding è gestito nativamente da Monaco: mostrato nei menu, non intercettato globalmente. */
  editorOwned?: boolean
  separatorBefore?: boolean
}

export const GO_STUDIO_MENUS: ReadonlyArray<{ id: GoStudioMenuId; label: string }> = [
  { id: 'file', label: 'File' },
  { id: 'edit', label: 'Edit' },
  { id: 'view', label: 'View' },
  { id: 'navigate', label: 'Navigate' },
  { id: 'code', label: 'Code' },
  { id: 'go', label: 'Go' },
  { id: 'run', label: 'Run' },
  { id: 'help', label: 'Help' },
]

export const GO_STUDIO_COMMANDS: ReadonlyArray<GoStudioCommand> = [
  { id: 'file.openProject', menu: 'file', label: 'Open Project…', binding: { key: 'o', mod: true } },
  { id: 'file.newProject', menu: 'file', label: 'New Go Project…' },
  { id: 'file.save', menu: 'file', label: 'Save', binding: { key: 's', mod: true }, separatorBefore: true },
  { id: 'file.saveAll', menu: 'file', label: 'Save All', binding: { key: 's', mod: true, shift: true } },
  { id: 'file.closeEditor', menu: 'file', label: 'Close Editor', binding: { key: 'w', mod: true }, separatorBefore: true },
  { id: 'file.closeProject', menu: 'file', label: 'Close Project' },
  { id: 'edit.undo', menu: 'edit', label: 'Undo', binding: { key: 'z', mod: true }, editorOwned: true },
  { id: 'edit.redo', menu: 'edit', label: 'Redo', binding: { key: 'z', mod: true, shift: true }, editorOwned: true },
  { id: 'edit.find', menu: 'edit', label: 'Find', binding: { key: 'f', mod: true }, editorOwned: true, separatorBefore: true },
  { id: 'edit.replace', menu: 'edit', label: 'Replace', binding: { key: 'h', mod: true }, editorOwned: true },
  { id: 'edit.gotoLine', menu: 'edit', label: 'Go to Line…', binding: { key: 'g', mod: true }, editorOwned: true },
  { id: 'edit.toggleComment', menu: 'edit', label: 'Toggle Line Comment', binding: { key: '/', mod: true }, editorOwned: true, separatorBefore: true },
  { id: 'view.quickOpen', menu: 'view', label: 'Go to File…', binding: { key: 'p', mod: true } },
  { id: 'view.toggleStructure', menu: 'view', label: 'Project Overview Pane', binding: { key: '7', alt: true }, separatorBefore: true },
  { id: 'view.toggleBottom', menu: 'view', label: 'Run / Problems Pane', binding: { key: '4', alt: true } },
  { id: 'view.problems', menu: 'view', label: 'Problems', binding: { key: '6', alt: true } },
  { id: 'view.toggleIgnored', menu: 'view', label: 'Show Ignored Folders', separatorBefore: true },
  { id: 'nav.declaration', menu: 'navigate', label: 'Declaration', binding: { key: 'b', mod: true }, editorOwned: true },
  { id: 'nav.typeDeclaration', menu: 'navigate', label: 'Type Declaration' },
  { id: 'nav.implementation', menu: 'navigate', label: 'Implementation(s)', binding: { key: 'b', mod: true, alt: true }, editorOwned: true },
  { id: 'nav.usages', menu: 'navigate', label: 'Find Usages', binding: { key: 'F7', alt: true }, editorOwned: true },
  { id: 'nav.fileStructure', menu: 'navigate', label: 'File Structure', binding: { key: 'F12', mod: true }, editorOwned: true, separatorBefore: true },
  { id: 'nav.symbol', menu: 'navigate', label: 'Symbol in Workspace…', binding: { key: 't', mod: true } },
  { id: 'nav.findInFiles', menu: 'navigate', label: 'Find in Files…', binding: { key: 'f', mod: true, shift: true }, separatorBefore: true },
  { id: 'code.completion', menu: 'code', label: 'Code Completion', binding: { key: 'Space', mod: true }, editorOwned: true },
  { id: 'code.parameterInfo', menu: 'code', label: 'Parameter Info', binding: { key: 'Space', mod: true, shift: true }, editorOwned: true },
  { id: 'code.quickFix', menu: 'code', label: 'Show Context Actions', binding: { key: 'Enter', alt: true }, editorOwned: true, separatorBefore: true },
  { id: 'code.rename', menu: 'code', label: 'Rename…', binding: { key: 'F6', shift: true }, editorOwned: true },
  { id: 'code.reformat', menu: 'code', label: 'Reformat Code', binding: { key: 'l', mod: true, alt: true }, editorOwned: true, separatorBefore: true },
  { id: 'code.organizeImports', menu: 'code', label: 'Optimize Imports', binding: { key: 'o', mod: true, alt: true }, editorOwned: true },
  { id: 'code.formatOnSave', menu: 'code', label: 'Reformat on Save', separatorBefore: true },
  { id: 'code.importsOnSave', menu: 'code', label: 'Optimize Imports on Save' },
  { id: 'code.gofumpt', menu: 'code', label: 'Use gofumpt Style' },
  { id: 'code.staticcheck', menu: 'code', label: 'Staticcheck Analyses' },
  { id: 'go.toolchains', menu: 'go', label: 'Go SDKs & Toolchains…' },
  { id: 'go.detect', menu: 'go', label: 'Detect Go SDK' },
  { id: 'go.dependencies', menu: 'go', label: 'Module Dependencies…', separatorBefore: true },
  { id: 'go.tidy', menu: 'go', label: 'go mod tidy…' },
  { id: 'go.trust', menu: 'go', label: 'Trust Project Tools', separatorBefore: true },
  { id: 'go.lspStart', menu: 'go', label: 'Start Language Server (gopls)', separatorBefore: true },
  { id: 'go.lspRestart', menu: 'go', label: 'Restart Language Server' },
  { id: 'go.lspStop', menu: 'go', label: 'Stop Language Server' },
  { id: 'go.lspInstall', menu: 'go', label: 'Install gopls…' },
  { id: 'go.lspLog', menu: 'go', label: 'Language Server Log…' },
  { id: 'run.run', menu: 'run', label: 'Run', binding: { key: 'F5', mod: true } },
  { id: 'run.build', menu: 'run', label: 'Build', binding: { key: 'b', mod: true, shift: true } },
  { id: 'run.stop', menu: 'run', label: 'Stop', binding: { key: 'F5', shift: true }, separatorBefore: true },
  { id: 'run.restart', menu: 'run', label: 'Restart', binding: { key: 'F5', mod: true, shift: true } },
  { id: 'run.configure', menu: 'run', label: 'Edit Run Configuration…', separatorBefore: true },
  { id: 'help.shortcuts', menu: 'help', label: 'Keyboard Shortcuts' },
]

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** Rende un binding leggibile e coerente con la piattaforma corrente. */
export function formatBinding(binding: GoStudioKeyBinding | undefined, mac = IS_MAC): string {
  if (!binding) return ''
  const parts: string[] = []
  if (binding.mod) parts.push(mac ? '⌘' : 'Ctrl')
  if (binding.alt) parts.push(mac ? '⌥' : 'Alt')
  if (binding.shift) parts.push(mac ? '⇧' : 'Shift')
  parts.push(binding.key.length === 1 ? binding.key.toUpperCase() : binding.key)
  return parts.join(mac ? '' : '+')
}

interface KeyLike {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

function keyMatches(binding: GoStudioKeyBinding, event: KeyLike): boolean {
  const mod = event.ctrlKey || event.metaKey
  if (!!binding.mod !== mod || !!binding.shift !== event.shiftKey || !!binding.alt !== event.altKey) return false
  if (binding.key.length > 1) return event.key === binding.key
  if (/^[0-9]$/.test(binding.key) && event.code === `Digit${binding.key}`) return true
  return event.key.toLowerCase() === binding.key
}

/** Trova il comando Go Studio intercettabile per un evento tastiera, ignorando quelli gestiti da Monaco. */
export function commandForKey(event: KeyLike): GoStudioCommand | null {
  return GO_STUDIO_COMMANDS.find((command) => !command.editorOwned && command.binding && keyMatches(command.binding, event)) ?? null
}

export interface GoStudioCommandContext {
  hasSession: boolean
  lspState: 'stopped' | 'starting' | 'ready' | 'crashed' | 'unavailable'
  goplsAvailable: boolean
  formatOnSave: boolean
  importsOnSave: boolean
  gofumpt: boolean
  staticcheck: boolean
  authorized: boolean
  toolchainReady: boolean
  running: boolean
  restartable: boolean
  hasEditor: boolean
  activeDocumentDirty: boolean
  sessionDirty: boolean
  structureOpen: boolean
  bottomOpen: boolean
  showIgnored: boolean
}

const NO_PROJECT = 'Open a Go project first'
const NOT_TRUSTED = 'Trust this project to allow local Go tools'
const LSP_NOT_READY = 'Waiting for gopls (Go → Start Language Server)'

function semanticAvailability(context: GoStudioCommandContext): true | string {
  if (!context.hasEditor) return 'Open a Go file first'
  return context.lspState === 'ready' ? true : LSP_NOT_READY
}

function runAvailability(context: GoStudioCommandContext): true | string {
  if (!context.hasSession) return NO_PROJECT
  if (!context.authorized) return NOT_TRUSTED
  return context.toolchainReady ? true : 'Detect or install a Go SDK first'
}

/** Calcola se un comando è eseguibile nello stato corrente e, se no, perché. */
export function commandAvailability(id: GoStudioCommandId, context: GoStudioCommandContext): true | string {
  if (id === 'file.openProject' || id === 'file.newProject' || id === 'help.shortcuts') return true
  if (!context.hasSession) return NO_PROJECT
  if (id.startsWith('edit.')) return context.hasEditor ? true : 'Open a file first'
  if (id.startsWith('nav.') && id !== 'nav.symbol' && id !== 'nav.findInFiles') return semanticAvailability(context)
  if (id.startsWith('code.') && ['code.formatOnSave', 'code.importsOnSave', 'code.gofumpt', 'code.staticcheck'].indexOf(id) < 0) return semanticAvailability(context)
  switch (id) {
    case 'file.save': return context.activeDocumentDirty ? true : 'No unsaved changes in this file'
    case 'file.saveAll': return context.sessionDirty ? true : 'No unsaved changes'
    case 'file.closeEditor': return context.hasEditor ? true : 'No file is open'
    case 'go.toolchains':
    case 'go.detect': return context.authorized ? true : NOT_TRUSTED
    case 'go.tidy': return context.running ? 'Wait for the active process to finish' : runAvailability(context)
    case 'run.run':
    case 'run.build': return runAvailability(context)
    case 'run.stop': return context.running ? true : 'Nothing is running'
    case 'nav.symbol': return context.lspState === 'ready' ? true : LSP_NOT_READY
    case 'go.lspStart':
      if (!context.authorized) return NOT_TRUSTED
      if (!context.goplsAvailable) return 'Install gopls first (Go → Install gopls…)'
      return context.lspState === 'ready' || context.lspState === 'starting' ? 'gopls is already running' : true
    case 'go.lspRestart': return context.authorized && context.goplsAvailable ? true : NOT_TRUSTED
    case 'go.lspStop': return context.lspState === 'ready' || context.lspState === 'starting' ? true : 'gopls is not running'
    case 'go.lspInstall': return runAvailability(context)
    case 'run.restart': return context.restartable ? runAvailability(context) : 'Run or build first'
    default: return true
  }
}

/** Indica lo stato attivo dei comandi toggle mostrati con spunta nei menu. */
export function commandChecked(id: GoStudioCommandId, context: GoStudioCommandContext): boolean {
  switch (id) {
    case 'view.toggleStructure': return context.structureOpen
    case 'view.toggleBottom': return context.bottomOpen
    case 'view.toggleIgnored': return context.showIgnored
    case 'go.trust': return context.authorized
    case 'code.formatOnSave': return context.formatOnSave
    case 'code.importsOnSave': return context.importsOnSave
    case 'code.gofumpt': return context.gofumpt
    case 'code.staticcheck': return context.staticcheck
    default: return false
  }
}
