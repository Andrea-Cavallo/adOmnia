import { beforeEach, describe, expect, it, vi } from 'vitest'

const values = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })

const { GO_STUDIO_COMMANDS, commandsForKey, commandShortcut, isStaleEditorKey } = await import('./goStudioCommands')
const { bindingConflicts, bindingFromEvent, effectiveBinding, useGoStudioKeymap } = await import('./goStudioKeymap')

const command = (id: string) => GO_STUDIO_COMMANDS.find((item) => item.id === id)!
const key = (k: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({ key: k, ctrlKey: !!mods.ctrl, metaKey: false, shiftKey: !!mods.shift, altKey: !!mods.alt })

describe('goStudioKeymap', () => {
  beforeEach(() => {
    values.clear()
    useGoStudioKeymap.setState({ keymap: 'goland', custom: {} })
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
    state.resetBinding('run.run')
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
})
