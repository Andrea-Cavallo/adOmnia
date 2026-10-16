import { describe, expect, it } from 'vitest'
import { jsonCursorContext, settingsJsonCompletions } from './settingsJsonCompletion'

const at = (text: string, marker = '|') => {
  const offset = text.indexOf(marker)
  return jsonCursorContext(text.replace(marker, ''), offset)
}

describe('json cursor context', () => {
  it('finds the section of a key being typed', () => {
    expect(at('{"editor": {"tab|')).toMatchObject({ path: ['editor'], expecting: 'key', stringSpan: { start: 12 } })
    expect(at('{"keymap": {"bindings": {"file.save": {"mo|')).toMatchObject({ path: ['keymap', 'bindings', 'file.save'], expecting: 'key' })
  })

  it('recognises when a value is being written and for which key', () => {
    expect(at('{"editor": {"tabSize": 4|')).toMatchObject({ expecting: 'value', currentKey: 'tabSize' })
    expect(at('{"keymap": {"preset": "|')).toMatchObject({ path: ['keymap'], expecting: 'value', currentKey: 'preset' })
    expect(at('{"keymap": {"bindings": {"a.b": {"when": "|')).toMatchObject({ expecting: 'value', currentKey: 'when' })
  })

  it('tracks the string span under the cursor, quotes included', () => {
    const context = at('{"format": "adomnia-settings", "edi|", "version": 1}')
    expect(context.stringSpan).toEqual({ start: 31, end: 36 })
    expect(context.expecting).toBe('key')
    expect(context.path).toEqual([])
  })

  it('handles values after a comma and nested sections', () => {
    expect(at('{"editor": {"tabSize": 4, "font|')).toMatchObject({ path: ['editor'], expecting: 'key' })
    expect(at('{"editor": {"tabSize": 4}, "keymap": {"preset": "|')).toMatchObject({ path: ['keymap'], expecting: 'value', currentKey: 'preset' })
  })
})

describe('settings completions', () => {
  it('suggests the top-level keys and the section keys', () => {
    const top = settingsJsonCompletions(at('{"|')).map((item) => item.label)
    expect(top).toEqual(['format', 'version', 'editor', 'keymap'])
    const editor = settingsJsonCompletions(at('{"editor": {"|')).map((item) => item.label)
    expect(editor).toContain('tabSize')
    expect(editor).toContain('editorMode')
    const keymap = settingsJsonCompletions(at('{"keymap": {"|')).map((item) => item.label)
    expect(keymap).toEqual(['preset', 'bindings'])
  })

  it('suggests real command ids inside keymap.bindings and binding fields inside an entry', () => {
    const commands = settingsJsonCompletions(at('{"keymap": {"bindings": {"|'), ['file.save', 'code.rename'], { 'file.save': 'Save' })
    expect(commands.map((item) => item.label)).toEqual(['file.save', 'code.rename'])
    expect(commands[0].detail).toBe('Save')
    const fields = settingsJsonCompletions(at('{"keymap": {"bindings": {"file.save": {"|')).map((item) => item.label)
    expect(fields).toEqual(['key', 'mod', 'shift', 'alt', 'when'])
  })

  it('suggests enum values and when terms after the colon', () => {
    const preset = settingsJsonCompletions(at('{"keymap": {"preset": "|'))
    expect(preset.map((item) => item.label)).toEqual(['goland', 'vscode'])
    expect(preset[0].insert).toBe('"goland"')
    const mode = settingsJsonCompletions(at('{"editor": {"editorMode": "|'))
    expect(mode.map((item) => item.label)).toEqual(['default', 'vim', 'emacs'])
    const when = settingsJsonCompletions(at('{"keymap": {"bindings": {"a": {"when": "|'))
    expect(when.map((item) => item.label)).toContain('vim.normal')
    expect(when.map((item) => item.label)).toContain('editor')
  })

  it('suggests booleans for boolean fields', () => {
    const softTabs = settingsJsonCompletions(at('{"editor": {"softTabs": |'))
    expect(softTabs.map((item) => item.label)).toEqual(['true', 'false'])
    expect(softTabs[0].insert).toBe('true')
  })
})
