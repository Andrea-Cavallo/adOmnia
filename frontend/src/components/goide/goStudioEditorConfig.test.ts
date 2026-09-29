import { describe, expect, it } from 'vitest'
import { applyWhitespaceRules, editorConfigFor, editorConfigGlob, indentationFor, parseEditorConfig } from './goStudioEditorConfig'

describe('EditorConfig', () => {
  it('matches globs like the specification', () => {
    expect(editorConfigGlob('*').test('web/app.js')).toBe(true)
    expect(editorConfigGlob('*.{js,ts}').test('web/static/app.ts')).toBe(true)
    expect(editorConfigGlob('*.{js,ts}').test('main.go')).toBe(false)
    expect(editorConfigGlob('Makefile').test('build/Makefile')).toBe(true)
    expect(editorConfigGlob('docs/**.md').test('docs/a/b.md')).toBe(true)
    expect(editorConfigGlob('docs/*.md').test('docs/a/b.md')).toBe(false)
    expect(editorConfigGlob('lib/**.js').test('src/lib/x.js')).toBe(false)
  })

  it('merges sections in order and reads only known properties', () => {
    const sections = parseEditorConfig([
      'root = true', '', '[*]', 'indent_style = space', 'indent_size = 2', 'trim_trailing_whitespace = true', 'insert_final_newline = true',
      '# yaml wants 4', '[*.yaml]', 'indent_size = 4', '[*.md]', 'trim_trailing_whitespace = false', 'unknown = 1',
    ].join('\n'))
    expect(editorConfigFor(sections, 'config/app.yaml')).toEqual({ indent_style: 'space', indent_size: 4, trim_trailing_whitespace: true, insert_final_newline: true })
    expect(editorConfigFor(sections, 'README.md').trim_trailing_whitespace).toBe(false)
  })

  it('keeps tabs for Go and Makefiles, follows EditorConfig elsewhere', () => {
    expect(indentationFor('go', { indent_style: 'space', indent_size: 2 })).toEqual({ tabSize: 4, insertSpaces: false })
    expect(indentationFor('makefile', {})).toEqual({ tabSize: 4, insertSpaces: false })
    expect(indentationFor('yaml', { indent_style: 'space', indent_size: 4 })).toEqual({ tabSize: 4, insertSpaces: true })
    expect(indentationFor('javascript', { indent_style: 'tab' })).toEqual({ tabSize: 2, insertSpaces: false })
    expect(indentationFor('json', {})).toEqual({ tabSize: 2, insertSpaces: true })
  })

  it('trims trailing whitespace and adds the final newline only when asked', () => {
    expect(applyWhitespaceRules('a  \nb\t\n', true, undefined)).toBe('a\nb\n')
    expect(applyWhitespaceRules('a\r\nb', false, true)).toBe('a\r\nb\r\n')
    expect(applyWhitespaceRules('a\nb\n', true, true)).toBeNull()
    expect(applyWhitespaceRules('a  ', false, false)).toBeNull()
  })
})
