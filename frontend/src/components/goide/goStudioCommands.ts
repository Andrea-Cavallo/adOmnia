export type GoStudioCommandId =
  | 'file.openProject' | 'file.newProject' | 'file.save' | 'file.saveAll' | 'file.closeEditor' | 'file.closeProject'
  | 'edit.undo' | 'edit.redo' | 'edit.find' | 'edit.replace' | 'edit.gotoLine' | 'edit.toggleComment'
  | 'view.quickOpen' | 'view.toggleStructure' | 'view.toggleBottom' | 'view.toggleIgnored'
  | 'go.toolchains' | 'go.detect' | 'go.dependencies' | 'go.tidy' | 'go.trust'
  | 'run.run' | 'run.build' | 'run.stop' | 'run.restart' | 'run.configure'
  | 'help.shortcuts'

export type GoStudioMenuId = 'file' | 'edit' | 'view' | 'go' | 'run' | 'help'

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
  { id: 'view.toggleIgnored', menu: 'view', label: 'Show Ignored Folders', separatorBefore: true },
  { id: 'go.toolchains', menu: 'go', label: 'Go SDKs & Toolchains…' },
  { id: 'go.detect', menu: 'go', label: 'Detect Go SDK' },
  { id: 'go.dependencies', menu: 'go', label: 'Module Dependencies…', separatorBefore: true },
  { id: 'go.tidy', menu: 'go', label: 'go mod tidy…' },
  { id: 'go.trust', menu: 'go', label: 'Trust Project Tools', separatorBefore: true },
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
    default: return false
  }
}
