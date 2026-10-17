import { create } from 'zustand'
import type { CodeStudioCommand, CodeStudioCommandId, CodeStudioKeyBinding } from './codeStudioCommands'
import { evaluateWhen, type CodeStudioWhenContext } from '@/lib/code-studio/when'
import type { ProjectKeymapOverride } from '@/lib/code-studio/projectSettings'
import { LEGACY_KEYMAP_STORAGE_KEY } from '@/lib/legacyKeymap'
import { useSettingsStore } from '@/stores/settings'

/** goland: la keymap predefinita (JetBrains). vscode: le scorciatoie di VS Code per chi arriva da lì. */
export type CodeStudioKeymapId = 'goland' | 'vscode'

export const CODE_STUDIO_KEYMAPS: ReadonlyArray<{ id: CodeStudioKeymapId; label: string }> = [
  { id: 'goland', label: 'GoLand (default)' },
  { id: 'vscode', label: 'VS Code' },
]

const b = (key: string, mods: Omit<CodeStudioKeyBinding, 'key'> = {}): CodeStudioKeyBinding => ({ key, ...mods })

/** Solo le differenze rispetto alla keymap GoLand; i comandi non elencati tengono il proprio tasto. */
const VSCODE: Partial<Record<CodeStudioCommandId, CodeStudioKeyBinding>> = {
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

const KEYMAP_OVERRIDES: Record<CodeStudioKeymapId, Partial<Record<CodeStudioCommandId, CodeStudioKeyBinding>>> = { goland: {}, vscode: VSCODE }

/** Scorciatoie non rimappabili: il doppio Shift non è una combinazione di tasti. */
export function isRebindable(command: CodeStudioCommand): boolean {
  return command.id !== 'nav.searchEverywhere'
}

export interface CodeStudioKeymapState {
  keymap: CodeStudioKeymapId
  /** Scorciatoie dell'utente (impostazioni JSON): un binding o null per togliere il tasto al comando. */
  custom: Partial<Record<CodeStudioCommandId, CodeStudioKeyBinding | null>>
  /** Scorciatoie del progetto (`.adomnia/settings.json`): vincolano quelle dell'utente. */
  project: Partial<Record<CodeStudioCommandId, CodeStudioKeyBinding | null>>
  /** Preset base scelto dal progetto; senza, vale quello dell'utente. */
  projectPreset?: CodeStudioKeymapId
  /** Contesto attivo per i binding con `when`; senza contesto i binding condizionati non valgono. */
  when: CodeStudioWhenContext
  setKeymap: (keymap: CodeStudioKeymapId) => void
  setBinding: (id: CodeStudioCommandId, binding: CodeStudioKeyBinding | null) => void
  resetBinding: (id: CodeStudioCommandId) => void
  resetAll: () => void
  setProjectKeymap: (keymap: ProjectKeymapOverride) => void
  setWhen: (when: CodeStudioWhenContext) => void
}

const STORAGE_KEY = LEGACY_KEYMAP_STORAGE_KEY

function loadLegacy(): Pick<CodeStudioKeymapState, 'keymap' | 'custom'> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<CodeStudioKeymapState>
    return { keymap: parsed.keymap === 'vscode' ? 'vscode' : 'goland', custom: parsed.custom && typeof parsed.custom === 'object' ? parsed.custom : {} }
  } catch {
    return { keymap: 'goland', custom: {} }
  }
}

/** Doppia scrittura: la chiave storica resta aggiornata per il rollback a versioni precedenti. */
function saveLegacy(state: Pick<CodeStudioKeymapState, 'keymap' | 'custom'>): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ keymap: state.keymap, custom: state.custom })) } catch { /* solo locale */ }
}

export const useCodeStudioKeymap = create<CodeStudioKeymapState>((set, get) => ({
  ...loadLegacy(),
  project: {},
  when: {},
  setKeymap: (keymap) => {
    set({ keymap })
    useSettingsStore.getState().updateKeymap({ preset: keymap })
    saveLegacy(get())
  },
  setBinding: (id, binding) => {
    const custom = { ...get().custom, [id]: binding }
    set({ custom })
    useSettingsStore.getState().updateKeymap({ bindings: custom })
    saveLegacy(get())
  },
  resetBinding: (id) => {
    const custom = { ...get().custom }
    delete custom[id]
    set({ custom })
    useSettingsStore.getState().updateKeymap({ bindings: custom })
    saveLegacy(get())
  },
  resetAll: () => {
    set({ custom: {} })
    useSettingsStore.getState().updateKeymap({ bindings: {} })
    saveLegacy(get())
  },
  setProjectKeymap: (keymap) => set({
    project: { ...(keymap.bindings as Partial<Record<CodeStudioCommandId, CodeStudioKeyBinding | null>>) },
    projectPreset: keymap.preset,
  }),
  setWhen: (when) => set({ when }),
}))

// Le impostazioni sono la fonte della keymap: quando caricano (o cambiano) lo specchio si allinea.
// Prima del caricamento vale la vecchia chiave locale, così il dialog non mostra una keymap vuota.
useSettingsStore.subscribe((state) => {
  if (!state.loaded) return
  const { preset, bindings } = state.settings.keymap
  const current = useCodeStudioKeymap.getState()
  if (current.keymap === preset && JSON.stringify(current.custom) === JSON.stringify(bindings)) return
  useCodeStudioKeymap.setState({ keymap: preset, custom: { ...bindings } })
})

/** I livelli con cui si risolve una scorciatoia: progetto, utente, preset scelto, default del comando. */
export interface CodeStudioKeymapLayers {
  keymap: CodeStudioKeymapId
  custom: Partial<Record<CodeStudioCommandId, CodeStudioKeyBinding | null>>
  project?: Partial<Record<CodeStudioCommandId, CodeStudioKeyBinding | null>>
  projectPreset?: CodeStudioKeymapId
  when?: CodeStudioWhenContext
}

function firstBinding(entries: Array<{ present: boolean; value: CodeStudioKeyBinding | null | undefined }>, when: CodeStudioWhenContext | undefined): CodeStudioKeyBinding | undefined {
  for (const entry of entries) {
    if (!entry.present) continue
    const value = entry.value
    // Un binding condizionato che non vale per il contesto salta al livello successivo.
    if (value && value.when !== undefined && !evaluateWhen(value.when, when ?? {})) continue
    return value ?? undefined
  }
  return undefined
}

/**
 * Il tasto che il comando usa davvero, per il contesto attivo: scorciatoie del progetto
 * (`.adomnia/settings.json`), poi personalizzazioni dell'utente, poi keymap scelta, poi GoLand.
 */
export function effectiveBinding(command: CodeStudioCommand, state: CodeStudioKeymapLayers = useCodeStudioKeymap.getState()): CodeStudioKeyBinding | undefined {
  return firstBinding([
    { present: command.id in (state.project ?? {}), value: state.project?.[command.id] },
    { present: command.id in state.custom, value: state.custom[command.id] },
    { present: command.id in KEYMAP_OVERRIDES[state.projectPreset ?? state.keymap], value: KEYMAP_OVERRIDES[state.projectPreset ?? state.keymap][command.id] },
    { present: true, value: command.binding },
  ], state.when)
}

/** Le alternative storiche (F6 di Eclipse, F10 di VS Code) valgono solo finché il comando tiene il tasto predefinito. */
export function effectiveAltBindings(command: CodeStudioCommand, state: CodeStudioKeymapLayers = useCodeStudioKeymap.getState()): CodeStudioKeyBinding[] {
  return isRemapped(command, state) ? [] : command.altBindings ?? []
}

export function isRemapped(command: CodeStudioCommand, state: CodeStudioKeymapLayers = useCodeStudioKeymap.getState()): boolean {
  return bindingSignature(effectiveBinding(command, state)) !== bindingSignature(command.binding)
}

/** Firma del tasto; la condizione `when` fa fede: due scorciatoie sullo stesso tasto in contesti diversi non si sovrappongono. */
export function bindingSignature(binding: CodeStudioKeyBinding | undefined): string {
  if (!binding) return ''
  return `${binding.mod ? 'M' : ''}${binding.alt ? 'A' : ''}${binding.shift ? 'S' : ''}:${binding.key.length === 1 ? binding.key.toLowerCase() : binding.key}${binding.when ? `@${binding.when}` : ''}`
}

/** Scorciatoie assegnate a più comandi con la keymap corrente: firma → comandi in conflitto. */
export function bindingConflicts(commands: readonly CodeStudioCommand[], state: CodeStudioKeymapLayers = useCodeStudioKeymap.getState()): Map<string, CodeStudioCommand[]> {
  const byKey = new Map<string, CodeStudioCommand[]>()
  for (const command of commands) {
    const signature = bindingSignature(effectiveBinding(command, state))
    if (!signature || command.id === 'nav.searchEverywhere') continue
    byKey.set(signature, [...(byKey.get(signature) ?? []), command])
  }
  return new Map([...byKey].filter(([, list]) => list.length > 1))
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

/** Binding registrato da un tasto premuto nel dialog delle scorciatoie; null finché si tiene premuto solo un modificatore. */
export function bindingFromEvent(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): CodeStudioKeyBinding | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toLowerCase() : event.key
  const binding: CodeStudioKeyBinding = { key }
  if (event.ctrlKey || event.metaKey) binding.mod = true
  if (event.altKey) binding.alt = true
  if (event.shiftKey && key.length > 1) binding.shift = true
  else if (event.shiftKey && /^[a-z]$/.test(key)) binding.shift = true
  return binding
}
