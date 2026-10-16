import { describe, expect, it } from 'vitest'
import {
  PROJECT_SETTINGS_JSON_SCHEMA, editorConfigWithProject, mergeEditorSettings, parseProjectSettings,
} from './projectSettings'

const valid = JSON.stringify({
  format: 'adomnia-settings',
  version: 1,
  editor: { tabSize: 4, softTabs: true, wordWrap: 'on', editorMode: 'vim', fontSize: 14 },
  keymap: {
    preset: 'vscode',
    bindings: {
      'file.save': { key: 's', mod: true },
      'code.rename': { key: 'r', mod: true, shift: true, when: 'editor && vim.normal' },
      'nav.back': null,
    },
  },
})

describe('project settings file', () => {
  it('parses a complete file without errors', () => {
    const result = parseProjectSettings(valid)
    expect(result.errors).toEqual([])
    expect(result.empty).toBe(false)
    expect(result.settings.editor).toEqual({ tabSize: 4, softTabs: true, wordWrap: 'on', editorMode: 'vim', fontSize: 14 })
    expect(result.settings.keymap.preset).toBe('vscode')
    expect(result.settings.keymap.bindings?.['file.save']).toEqual({ key: 's', mod: true })
    expect(result.settings.keymap.bindings?.['code.rename']?.when).toBe('editor && vim.normal')
    expect(result.settings.keymap.bindings?.['nav.back']).toBeNull()
  })

  it('treats an absent or blank file as empty, without errors', () => {
    for (const raw of ['', '   \n']) {
      const result = parseProjectSettings(raw)
      expect(result.empty).toBe(true)
      expect(result.errors).toEqual([])
    }
  })

  it('reports invalid JSON instead of applying anything', () => {
    const result = parseProjectSettings('{ not json')
    expect(result.empty).toBe(true)
    expect(result.errors[0]).toContain('not valid JSON')
    expect(result.settings.editor).toEqual({})
  })

  it('requires format and version', () => {
    const result = parseProjectSettings(JSON.stringify({ editor: { tabSize: 2 } }))
    expect(result.errors).toContain('format: expected "adomnia-settings".')
    expect(result.errors).toContain('version: expected 1.')
    expect(result.settings.editor.tabSize).toBe(2)
  })

  it('ignores unknown keys and invalid values but keeps the good ones', () => {
    const result = parseProjectSettings(JSON.stringify({
      format: 'adomnia-settings',
      version: 1,
      theme: 'dark',
      editor: { tabSize: 99, wordWrap: 'maybe', fontSize: 13, hover: true },
    }))
    expect(result.errors).toContain('theme: unknown key.')
    expect(result.errors).toContain('editor.tabSize: invalid value 99.')
    expect(result.errors).toContain('editor.wordWrap: invalid value "maybe".')
    expect(result.errors).toContain('editor.hover: unknown key.')
    expect(result.settings.editor).toEqual({ fontSize: 13 })
  })

  it('validates bindings entry by entry', () => {
    const result = parseProjectSettings(JSON.stringify({
      format: 'adomnia-settings',
      version: 1,
      keymap: {
        preset: 'emacs',
        bindings: {
          'file.save': { key: 's', mod: 'yes' },
          'edit.undo': { mod: true },
          'view.terminal': { key: '`', mod: true, when: '' },
          'run.run': 'F5',
        },
      },
    }))
    expect(result.errors).toContain('keymap.preset: invalid value "emacs".')
    expect(result.errors).toContain('keymap.bindings.file.save.mod: expected true or false.')
    expect(result.errors).toContain('keymap.bindings.edit.undo: "key" must be a non-empty string.')
    expect(result.errors).toContain('keymap.bindings.view.terminal.when: expected a non-empty string.')
    expect(result.errors).toContain('keymap.bindings.run.run: expected an object with "key" or null.')
    expect(result.settings.keymap.bindings?.['view.terminal']).toEqual({ key: '`', mod: true })
    expect(result.settings.keymap.bindings?.['run.run']).toBeUndefined()
  })

  it('keeps the schema and the parser on the same keys', () => {
    const root = PROJECT_SETTINGS_JSON_SCHEMA.properties as Record<string, { properties?: Record<string, unknown> }>
    expect(Object.keys(root).sort()).toEqual(['editor', 'format', 'keymap', 'version'])
    expect(Object.keys(root.editor.properties ?? {}).sort()).toEqual(
      ['editorMode', 'fontLigatures', 'fontSize', 'lineNumbers', 'softTabs', 'stickyScroll', 'tabSize', 'wordWrap'],
    )
    const binding = (root.keymap.properties as Record<string, unknown>).bindings as { additionalProperties: { oneOf: Array<{ properties?: Record<string, unknown> }> } }
    expect(Object.keys(binding.additionalProperties.oneOf[1].properties ?? {}).sort()).toEqual(['alt', 'key', 'mod', 'shift', 'when'])
    const parsed = parseProjectSettings(valid)
    expect(parsed.errors).toEqual([])
  })
})

describe('layered editor settings', () => {
  it('lets the project win over the user settings, key by key', () => {
    expect(mergeEditorSettings({ tabSize: 2, fontSize: 13 }, { tabSize: 4 })).toEqual({ tabSize: 4, fontSize: 13 })
    expect(mergeEditorSettings({ tabSize: 2 }, { tabSize: undefined })).toEqual({ tabSize: 2 })
  })

  it('lets the project win over .editorconfig for indentation', () => {
    expect(editorConfigWithProject({ indent_style: 'tab', indent_size: 8 }, { softTabs: true, tabSize: 4 }))
      .toEqual({ indent_style: 'space', indent_size: 4, tab_width: 4 })
    expect(editorConfigWithProject({ indent_style: 'space', indent_size: 2 }, {}))
      .toEqual({ indent_style: 'space', indent_size: 2 })
  })
})
