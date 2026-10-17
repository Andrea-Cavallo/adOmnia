import { beforeEach, describe, expect, it, vi } from 'vitest'

const values = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })

const settings = vi.hoisted(() => {
  const listeners: Array<(state: unknown) => void> = []
  return {
    listeners,
    loaded: true,
    keymap: { preset: 'goland', bindings: {} } as { preset: 'goland' | 'vscode'; bindings: Record<string, unknown> },
  }
})
vi.mock('@/stores/settings', () => ({
  useSettingsStore: {
    getState: () => ({
      loaded: settings.loaded,
      settings: { keymap: settings.keymap },
      updateKeymap: (patch: { preset?: 'goland' | 'vscode'; bindings?: Record<string, unknown> }) => {
        settings.keymap = { ...settings.keymap, ...patch }
        settings.listeners.forEach((listener) => listener({ loaded: settings.loaded, settings: { keymap: settings.keymap } }))
      },
    }),
    subscribe: (listener: (state: unknown) => void) => {
      settings.listeners.push(listener)
      return () => settings.listeners.splice(settings.listeners.indexOf(listener), 1)
    },
  },
}))

const { GO_STUDIO_COMMANDS, commandsForKey, commandShortcut, isStaleEditorKey } = await import('./goStudioCommands')
const { bindingConflicts, bindingFromEvent, effectiveBinding, useGoStudioKeymap } = await import('./goStudioKeymap')
const { legacyGoStudioKeymap } = await import('@/lib/legacyKeymap')

const command = (id: string) => GO_STUDIO_COMMANDS.find((item) => item.id === id)!
const key = (k: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({ key: k, ctrlKey: !!mods.ctrl, metaKey: false, shiftKey: !!mods.shift, altKey: !!mods.alt })

describe('goStudioKeymap', () => {
  beforeEach(() => {
    values.clear()
    settings.keymap = { preset: 'goland', bindings: {} }
    useGoStudioKeymap.setState({ keymap: 'goland', custom: {}, project: {}, projectPreset: undefined, when: {} })
  })

  it('switches to the VS Code keymap and back', () => {
    expect(effectiveBinding(command('code.rename'))).toEqual({ key: 'F6', shift: true })
    useGoStudioKeymap.getState().setKeymap('vscode')
    expect(effectiveBinding(command('code.rename'))).toEqual({ key: 'F2' })
    expect(commandShortcut(command('view.quickOpen'))).toBe('Ctrl+P')
    expect(JSON.parse(values.get('adomnia.goide.keymap')!)).toMatchObject({ keymap: 'vscode' })
  })

  it('lets the user rebind or unbind a command, and routes remapped editor keys', () => {
    const state = useGoStudioKeymap.getState()
    state.setBinding('nav.declaration', { key: 'F12' })
    expect(commandsForKey(key('F12')).map((item) => item.id)).toContain('nav.declaration')
    // Il vecchio Ctrl+B non deve più andare alla dichiarazione.
    expect(isStaleEditorKey(key('b', { ctrl: true }))).toBe(true)
    state.setBinding('run.run', null)
    expect(commandShortcut(command('run.run'))).toBe('')
    state.resetBinding(command('run.run').id)
    expect(commandShortcut(command('run.run'))).not.toBe('')
  })

  it('detects shortcuts shared by two actions', () => {
    useGoStudioKeymap.getState().setBinding('view.terminal', effectiveBinding(command('run.run'))!)
    const conflicts = [...bindingConflicts(GO_STUDIO_COMMANDS).values()].flat().map((item) => item.id)
    expect(conflicts).toEqual(expect.arrayContaining(['view.terminal', 'run.run']))
  })

  it('records a binding from a key press, ignoring lone modifiers', () => {
    expect(bindingFromEvent(key('Shift', { shift: true }))).toBeNull()
    expect(bindingFromEvent(key('K', { ctrl: true, shift: true }))).toEqual({ key: 'k', mod: true, shift: true })
    expect(bindingFromEvent(key(' ', { ctrl: true }))).toEqual({ key: 'Space', mod: true })
  })

  it('takes the bindings from the settings JSON layer', () => {
    settings.keymap = { preset: 'vscode', bindings: { 'code.rename': { key: 'r', mod: true } } }
    settings.listeners.forEach((listener) => listener({ loaded: true, settings: { keymap: settings.keymap } }))
    expect(effectiveBinding(command('code.rename'))).toEqual({ key: 'r', mod: true })
    expect(effectiveBinding(command('view.quickOpen'))).toEqual({ key: 'p', mod: true })
  })

  it('layers project over user over preset over the command default', () => {
    useGoStudioKeymap.setState({ keymap: 'goland' })
    useGoStudioKeymap.getState().setBinding('code.rename', { key: 'n', mod: true })
    useGoStudioKeymap.getState().setProjectKeymap({ bindings: { 'code.rename': { key: 'r', mod: true, shift: true } } })
    expect(effectiveBinding(command('code.rename'))).toEqual({ key: 'r', mod: true, shift: true })
    // Un binding del progetto con null toglie il tasto anche alle personalizzazioni utente.
    useGoStudioKeymap.getState().setProjectKeymap({ bindings: { 'code.rename': null } })
    expect(effectiveBinding(command('code.rename'))).toBeUndefined()
    // Il preset del progetto vale quando il progetto non rimappa il comando e l'utente nemmeno.
    useGoStudioKeymap.getState().resetBinding('code.rename')
    useGoStudioKeymap.getState().setProjectKeymap({ preset: 'vscode', bindings: {} })
    expect(effectiveBinding(command('code.rename'))).toEqual({ key: 'F2' })
  })

  it('falls through to the lower layer when the when condition does not match', () => {
    useGoStudioKeymap.getState().setBinding('code.rename', { key: 'n', mod: true, when: 'vim.normal' })
    expect(effectiveBinding(command('code.rename'))).toEqual({ key: 'F6', shift: true })
    expect(effectiveBinding(command('code.rename'), { ...useGoStudioKeymap.getState(), when: { 'vim.normal': true } })).toMatchObject({ key: 'n', mod: true })
    expect(commandsForKey(key('n', { ctrl: true }), { 'vim.normal': true }).map((item) => item.id)).toContain('code.rename')
    // Due scorciatoie sullo stesso tasto in contesti diversi non sono in conflitto.
    useGoStudioKeymap.getState().setBinding('view.terminal', { key: 'n', mod: true })
    const conflicts = [...bindingConflicts(GO_STUDIO_COMMANDS, { ...useGoStudioKeymap.getState(), when: { 'vim.normal': true } }).keys()]
    expect(conflicts).not.toContain('M:n')
  })
})

describe('legacy keymap migration', () => {
  it('converts the old localStorage shape, including unbinds and conditions', () => {
    expect(legacyGoStudioKeymap(JSON.stringify({
      keymap: 'vscode',
      custom: {
        'code.rename': { key: 'r', mod: true, when: 'editor' },
        'nav.back': null,
        'broken': 42,
      },
    }))).toEqual({
      preset: 'vscode',
      bindings: {
        'code.rename': { key: 'r', mod: true, when: 'editor' },
        'nav.back': null,
      },
    })
    expect(legacyGoStudioKeymap(null)).toBeNull()
    expect(legacyGoStudioKeymap('not json')).toBeNull()
  })
})
