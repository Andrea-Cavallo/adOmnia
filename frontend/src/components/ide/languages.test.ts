import { describe, expect, it } from 'vitest'
import { CODE_STUDIO_COMMANDS, CODE_STUDIO_MENUS, commandAvailability, type CodeStudioCommandContext } from '@/components/code-studio/codeStudioCommands'
import { IDE_LANGUAGES, codeVisionEditorLanguages, exceptionFiltersFor, heavyFeatureEditorLanguages, implementationMarkerEditorLanguages, isLanguageServerEditorLanguage, languageRequirement, languageServerEditorLanguages, semanticTokenEditorLanguages } from './languages'
import { BRAND_ICONS } from '@/lib/brandIcons.generated'

describe('IDE language contributions', () => {
  it('offers Python script and module runs with basedpyright and pytest/debug support', () => {
    const python = IDE_LANGUAGES.find(language => language.id === 'python')!
    expect(python.runTemplates?.map(template => template.kind)).toEqual(['script', 'module'])
    expect(python.editorLanguages).toEqual(['python'])
    expect(python.languageServer).toBe('basedpyright')
    expect(python.providedServer).toBe(true)
    expect(python.heavyFeatures).toBe(false)
    expect(python.semanticTokens).toBe(true)
    expect(python.canDebugRun?.({ kind: 'script' } as never)).toBe(true)
    expect(python.canDebugRun?.({ kind: 'module' } as never)).toBe(true)
    expect(python.canDebugRun?.({ kind: 'command' } as never)).toBe(false)
    expect(python.canDebugRun?.({} as never)).toBe(false)
    expect(languageServerEditorLanguages()).toContain('python')
  })
  it('derive menu and LSP editor languages from the contributions', () => {
    expect(CODE_STUDIO_MENUS.map((menu) => menu.id)).toContain('go')
    expect(CODE_STUDIO_MENUS.map((menu) => menu.id)).toContain('python')
    expect(languageServerEditorLanguages()).toEqual(['go', 'typescript', 'javascript', 'html', 'css', 'scss', 'less', 'json', 'java', 'python', 'rust'])
    expect(isLanguageServerEditorLanguage('go')).toBe(true)
    expect(isLanguageServerEditorLanguage('typescript')).toBe(true)
    expect(isLanguageServerEditorLanguage('python')).toBe(true)
    expect(isLanguageServerEditorLanguage('markdown')).toBe(false)
    expect(new Set(IDE_LANGUAGES.map((language) => language.id)).size).toBe(IDE_LANGUAGES.length)
  })

  it('keeps the gopls-tuned features (semantic colors, inlay hints, Code Vision) on Go only', () => {
    expect(heavyFeatureEditorLanguages()).toEqual(['go'])
  })

  it('gives Java Code Vision and implementation markers without gopls-only inlay hints', () => {
    const java = IDE_LANGUAGES.find(language => language.id === 'java')!
    expect(java.heavyFeatures).toBe(false)
    expect(java.semanticTokens).toBe(true)
    expect(java.codeVision).toBe(true)
    expect(java.implementationMarkers).toBe(true)
    expect(codeVisionEditorLanguages()).toEqual(['go', 'java'])
    expect(implementationMarkerEditorLanguages()).toEqual(['go', 'java'])
    expect(heavyFeatureEditorLanguages()).not.toContain('java')
  })

  it('declares Rust with run templates but no server or debug yet (RS-2/3)', () => {
    const rust = IDE_LANGUAGES.find(language => language.id === 'rust')!
    expect(rust.name).toBe('Rust')
    expect(rust.icon).toBe('rust')
    expect(rust.editorLanguages).toEqual(['rust'])
    expect(rust.heavyFeatures).toBe(false)
    expect(rust.languageServer).toBeUndefined()
    expect(rust.providedServer).toBeUndefined()
    expect(rust.runTemplates?.map(template => template.kind)).toEqual(['bin', 'example', 'build', 'check'])
    expect(rust.canDebugRun).toBeUndefined()
    expect(rust.menu).toBeUndefined()
    expect(heavyFeatureEditorLanguages()).not.toContain('rust')
    expect(semanticTokenEditorLanguages()).not.toContain('rust')
  })

  it('declares the debugpy exception filters and gathers them per project language', () => {
    const python = IDE_LANGUAGES.find(language => language.id === 'python')!
    expect(python.exceptionFilters?.map((filter) => filter.filter)).toEqual(['raised', 'uncaught'])
    expect(exceptionFiltersFor(['go'])).toEqual([])
    expect(exceptionFiltersFor(['python', 'python']).map((filter) => filter.filter)).toEqual(['raised', 'uncaught'])
    expect(exceptionFiltersFor(['java', 'python']).length).toBe(2)
  })

  it('gives every language a brand icon the run bar can show', () => {
    for (const language of IDE_LANGUAGES) {
      expect(BRAND_ICONS[language.icon], language.id).toBeTruthy()
    }
  })

  it('every Go menu command requires the Go language', () => {
    const goMenu = CODE_STUDIO_COMMANDS.filter((command) => command.menu === 'go')
    expect(goMenu.length).toBeGreaterThan(0)
    expect(goMenu.every((command) => command.requires?.language === 'go')).toBe(true)
  })

  it('every Python menu command requires the Python language', () => {
    const pythonMenu = CODE_STUDIO_COMMANDS.filter((command) => command.menu === 'python')
    expect(pythonMenu.map((command) => command.id)).toEqual(['python.selectInterpreter', 'python.installDebugpy', 'python.attach'])
    expect(pythonMenu.every((command) => command.requires?.language === 'python')).toBe(true)
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
