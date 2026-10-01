import { create } from 'zustand'
import type { GoStudioCommand, GoStudioCommandId, GoStudioKeyBinding } from './goStudioCommands'

/** goland: la keymap predefinita (JetBrains). vscode: le scorciatoie di VS Code per chi arriva da lì. */
export type GoStudioKeymapId = 'goland' | 'vscode'

export const GO_STUDIO_KEYMAPS: ReadonlyArray<{ id: GoStudioKeymapId; label: string }> = [
  { id: 'goland', label: 'GoLand (default)' },
  { id: 'vscode', label: 'VS Code' },
]

const b = (key: string, mods: Omit<GoStudioKeyBinding, 'key'> = {}): GoStudioKeyBinding => ({ key, ...mods })

/** Solo le differenze rispetto alla keymap GoLand; i comandi non elencati tengono il proprio tasto. */
const VSCODE: Partial<Record<GoStudioCommandId, GoStudioKeyBinding>> = {
  'view.quickOpen': b('p', { mod: true }),
  'nav.symbol': b('t', { mod: true }),
  'nav.declaration': b('F12'),
  'nav.implementation': b('F12', { mod: true }),
  'nav.usages': b('F12', { shift: true }),
  'nav.fileStructure': b('o', { mod: true, shift: true }),
  'nav.findInFiles': b('f', { mod: true, shift: true }),
  'nav.back': b('ArrowLeft', { alt: true }),
  'nav.forward': b('ArrowRight', { alt: true }),
  'code.rename': b('F2'),
  'code.quickFix': b('.', { mod: true }),
  'code.reformat': b('f', { alt: true, shift: true }),
  'code.organizeImports': b('o', { alt: true, shift: true }),
  'code.quickDocumentation': b('k', { mod: true, shift: true }),
  'edit.duplicateLine': b('ArrowDown', { alt: true, shift: true }),
  'edit.deleteLine': b('k', { mod: true, shift: true }),
  'edit.moveLineUp': b('ArrowUp', { alt: true }),
  'edit.moveLineDown': b('ArrowDown', { alt: true }),
  'edit.nextOccurrence': b('d', { mod: true }),
  'edit.allOccurrences': b('l', { mod: true, shift: true }),
  'view.terminal': b('`', { mod: true }),
  'run.run': b('F5', { mod: true }),
  'debug.debug': b('F5'),
  'debug.toggleBreakpoint': b('F9'),
  'debug.resume': b('F8', { mod: true }),
  'debug.stepOver': b('F10'),
  'debug.stepInto': b('F11'),
  'debug.stepOut': b('F11', { shift: true }),
  'debug.stop': b('F5', { shift: true }),
}

const KEYMAP_OVERRIDES: Record<GoStudioKeymapId, Partial<Record<GoStudioCommandId, GoStudioKeyBinding>>> = { goland: {}, vscode: VSCODE }

/** Scorciatoie non rimappabili: il doppio Shift non è una combinazione di tasti. */
export function isRebindable(command: GoStudioCommand): boolean {
  return command.id !== 'nav.searchEverywhere'
}

export interface GoStudioKeymapState {
  keymap: GoStudioKeymapId
  /** Scorciatoie dell'utente: un binding o null per togliere il tasto al comando. */
  custom: Partial<Record<GoStudioCommandId, GoStudioKeyBinding | null>>
  setKeymap: (keymap: GoStudioKeymapId) => void
  setBinding: (id: GoStudioCommandId, binding: GoStudioKeyBinding | null) => void
  resetBinding: (id: GoStudioCommandId) => void
  resetAll: () => void
}

const STORAGE_KEY = 'adomnia.goide.keymap'

function load(): Pick<GoStudioKeymapState, 'keymap' | 'custom'> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<GoStudioKeymapState>
    return { keymap: parsed.keymap === 'vscode' ? 'vscode' : 'goland', custom: parsed.custom && typeof parsed.custom === 'object' ? parsed.custom : {} }
  } catch {
    return { keymap: 'goland', custom: {} }
  }
}

function save(state: Pick<GoStudioKeymapState, 'keymap' | 'custom'>): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ keymap: state.keymap, custom: state.custom })) } catch { /* solo locale */ }
}

export const useGoStudioKeymap = create<GoStudioKeymapState>((set, get) => ({
  ...load(),
  setKeymap: (keymap) => { set({ keymap }); save(get()) },
  setBinding: (id, binding) => { set({ custom: { ...get().custom, [id]: binding } }); save(get()) },
  resetBinding: (id) => {
    const custom = { ...get().custom }
    delete custom[id]
    set({ custom })
    save(get())
  },
  resetAll: () => { set({ custom: {} }); save(get()) },
}))

/** Il tasto che il comando usa davvero: personalizzazione dell'utente, poi keymap scelta, poi GoLand. */
export function effectiveBinding(command: GoStudioCommand, state: Pick<GoStudioKeymapState, 'keymap' | 'custom'> = useGoStudioKeymap.getState()): GoStudioKeyBinding | undefined {
  if (command.id in state.custom) return state.custom[command.id] ?? undefined
  return KEYMAP_OVERRIDES[state.keymap][command.id] ?? command.binding
}

/** Le alternative storiche (F6 di Eclipse, F10 di VS Code) valgono solo finché il comando tiene il tasto predefinito. */
export function effectiveAltBindings(command: GoStudioCommand, state: Pick<GoStudioKeymapState, 'keymap' | 'custom'> = useGoStudioKeymap.getState()): GoStudioKeyBinding[] {
  return isRemapped(command, state) ? [] : command.altBindings ?? []
}

export function isRemapped(command: GoStudioCommand, state: Pick<GoStudioKeymapState, 'keymap' | 'custom'> = useGoStudioKeymap.getState()): boolean {
  return bindingSignature(effectiveBinding(command, state)) !== bindingSignature(command.binding)
}

export function bindingSignature(binding: GoStudioKeyBinding | undefined): string {
  if (!binding) return ''
  return `${binding.mod ? 'M' : ''}${binding.alt ? 'A' : ''}${binding.shift ? 'S' : ''}:${binding.key.length === 1 ? binding.key.toLowerCase() : binding.key}`
}

/** Scorciatoie assegnate a più comandi con la keymap corrente: firma → comandi in conflitto. */
export function bindingConflicts(commands: readonly GoStudioCommand[], state: Pick<GoStudioKeymapState, 'keymap' | 'custom'> = useGoStudioKeymap.getState()): Map<string, GoStudioCommand[]> {
  const byKey = new Map<string, GoStudioCommand[]>()
  for (const command of commands) {
    const signature = bindingSignature(effectiveBinding(command, state))
    if (!signature || command.id === 'nav.searchEverywhere') continue
    byKey.set(signature, [...(byKey.get(signature) ?? []), command])
  }
  return new Map([...byKey].filter(([, list]) => list.length > 1))
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

/** Binding registrato da un tasto premuto nel dialog delle scorciatoie; null finché si tiene premuto solo un modificatore. */
export function bindingFromEvent(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): GoStudioKeyBinding | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toLowerCase() : event.key
  const binding: GoStudioKeyBinding = { key }
  if (event.ctrlKey || event.metaKey) binding.mod = true
  if (event.altKey) binding.alt = true
  if (event.shiftKey && key.length > 1) binding.shift = true
  else if (event.shiftKey && /^[a-z]$/.test(key)) binding.shift = true
  return binding
}
