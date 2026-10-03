import { describe, expect, it } from 'vitest'
import { GO_STUDIO_COMMANDS, GO_STUDIO_MENUS, commandAvailability, type GoStudioCommandContext } from '@/components/goide/goStudioCommands'
import { IDE_LANGUAGES, isLanguageServerEditorLanguage, languageRequirement, languageServerEditorLanguages } from './languages'

describe('IDE language contributions', () => {
  it('derive menu and LSP editor languages from the contributions', () => {
    expect(GO_STUDIO_MENUS.map((menu) => menu.id)).toContain('go')
    expect(languageServerEditorLanguages()).toEqual(['go'])
    expect(isLanguageServerEditorLanguage('go')).toBe(true)
    expect(isLanguageServerEditorLanguage('markdown')).toBe(false)
    expect(new Set(IDE_LANGUAGES.map((language) => language.id)).size).toBe(IDE_LANGUAGES.length)
  })

  it('every Go menu command requires the Go language', () => {
    const goMenu = GO_STUDIO_COMMANDS.filter((command) => command.menu === 'go')
    expect(goMenu.length).toBeGreaterThan(0)
    expect(goMenu.every((command) => command.requires?.language === 'go')).toBe(true)
  })

  it('disable commands of a language the backend does not register', () => {
    expect(languageRequirement('go', undefined)).toBe(true)
    expect(languageRequirement('go', [{ id: 'go', name: 'Go' }])).toBe(true)
    expect(languageRequirement('java', [{ id: 'go', name: 'Go' }])).toMatch(/java support is not available/)
    const context = { hasSession: true, authorized: true, languages: [{ id: 'fake', name: 'Fake' }] } as unknown as GoStudioCommandContext
    expect(commandAvailability('go.toolchains', context)).toBe('Go support is not available in this build')
    expect(commandAvailability('go.toolchains', { ...context, languages: [{ id: 'go', name: 'Go' }] })).toBe(true)
  })
})
