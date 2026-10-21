import { describe, expect, it } from 'vitest'
import { CODE_STUDIO_COMMANDS, CODE_STUDIO_MENUS, commandAvailability, type CodeStudioCommandContext } from '@/components/code-studio/codeStudioCommands'
import { IDE_LANGUAGES, heavyFeatureEditorLanguages, isLanguageServerEditorLanguage, languageRequirement, languageServerEditorLanguages } from './languages'

describe('IDE language contributions', () => {
  it('offers Python script and module runs without claiming LSP or debug support', () => {
    const python = IDE_LANGUAGES.find(language => language.id === 'python')!
    expect(python.runTemplates?.map(template => template.kind)).toEqual(['script', 'module'])
    expect(python.editorLanguages).toEqual([])
    expect(python.providedServer).not.toBe(true)
    expect(python.canDebugRun?.({} as never)).toBe(false)
    expect(languageServerEditorLanguages()).not.toContain('python')
  })
  it('derive menu and LSP editor languages from the contributions', () => {
    expect(CODE_STUDIO_MENUS.map((menu) => menu.id)).toContain('go')
    expect(languageServerEditorLanguages()).toEqual(['go', 'typescript', 'javascript', 'html', 'css', 'scss', 'less', 'json', 'java'])
    expect(isLanguageServerEditorLanguage('go')).toBe(true)
    expect(isLanguageServerEditorLanguage('typescript')).toBe(true)
    expect(isLanguageServerEditorLanguage('markdown')).toBe(false)
    expect(new Set(IDE_LANGUAGES.map((language) => language.id)).size).toBe(IDE_LANGUAGES.length)
  })

  it('keeps the gopls-tuned features (semantic colors, inlay hints, Code Vision) on Go only', () => {
    expect(heavyFeatureEditorLanguages()).toEqual(['go'])
  })

  it('every Go menu command requires the Go language', () => {
    const goMenu = CODE_STUDIO_COMMANDS.filter((command) => command.menu === 'go')
    expect(goMenu.length).toBeGreaterThan(0)
    expect(goMenu.every((command) => command.requires?.language === 'go')).toBe(true)
  })

  it('disable commands of a language the backend does not register', () => {
    expect(languageRequirement('go', undefined)).toBe(true)
    expect(languageRequirement('go', [{ id: 'go', name: 'Go' }])).toBe(true)
    expect(languageRequirement('java', [{ id: 'go', name: 'Go' }])).toMatch(/Java support is not available/)
    expect(languageRequirement('cobol', [{ id: 'go', name: 'Go' }])).toMatch(/cobol support is not available/)
    const context = { hasSession: true, authorized: true, languages: [{ id: 'fake', name: 'Fake' }] } as unknown as CodeStudioCommandContext
    expect(commandAvailability('go.toolchains', context)).toBe('Go support is not available in this build')
    expect(commandAvailability('go.toolchains', { ...context, languages: [{ id: 'go', name: 'Go' }] })).toBe(true)
  })
})
