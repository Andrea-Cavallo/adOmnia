import { describe, expect, it } from 'vitest'
import { GO_STUDIO_COMMANDS, commandAvailability, commandChecked, commandForKey, formatBinding, type GoStudioCommandContext } from './goStudioCommands'

const key = (partial: Partial<Parameters<typeof commandForKey>[0]>) => ({
  key: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...partial,
})

describe('Go Studio commands', () => {
  it('distinguishes save from save all and build from sidebar toggle', () => {
    expect(commandForKey(key({ key: 's', ctrlKey: true }))?.id).toBe('file.save')
    expect(commandForKey(key({ key: 'S', ctrlKey: true, shiftKey: true }))?.id).toBe('file.saveAll')
    expect(commandForKey(key({ key: 'B', metaKey: true, shiftKey: true }))?.id).toBe('run.build')
    expect(commandForKey(key({ key: 'b', ctrlKey: true }))).toBeNull()
  })

  it('claims Ctrl+W for the editor instead of the hidden HTTP tabs', () => {
    expect(commandForKey(key({ key: 'w', ctrlKey: true }))?.id).toBe('file.closeEditor')
  })

  it('leaves Monaco-owned bindings to the editor', () => {
    expect(commandForKey(key({ key: 'f', ctrlKey: true }))).toBeNull()
    expect(commandForKey(key({ key: 'z', ctrlKey: true }))).toBeNull()
  })

  it('matches Alt+digit by physical key and F5 variants exactly', () => {
    expect(commandForKey(key({ key: '¡', code: 'Digit7', altKey: true }))?.id).toBe('view.toggleStructure')
    expect(commandForKey(key({ key: 'F5', ctrlKey: true }))?.id).toBe('run.run')
    expect(commandForKey(key({ key: 'F5', shiftKey: true }))?.id).toBe('run.stop')
    expect(commandForKey(key({ key: 'F5', ctrlKey: true, shiftKey: true }))?.id).toBe('run.restart')
  })

  it('has no duplicate intercepted bindings', () => {
    const seen = new Set<string>()
    for (const command of GO_STUDIO_COMMANDS) {
      if (!command.binding || command.editorOwned) continue
      const label = formatBinding(command.binding, false)
      expect(seen.has(label), label).toBe(false)
      seen.add(label)
    }
  })

  it('formats bindings per platform', () => {
    expect(formatBinding({ key: 'b', mod: true, shift: true }, false)).toBe('Ctrl+Shift+B')
    expect(formatBinding({ key: 'b', mod: true, shift: true }, true)).toBe('⌘⇧B')
  })
})

describe('Go Studio command availability', () => {
  const ready: GoStudioCommandContext = {
    hasSession: true, documentCount: 2, hasClosedDocuments: false, split: false, authorized: true, toolchainReady: true, running: false, restartable: true,
    hasEditor: true, activeDocumentDirty: true, sessionDirty: true, structureOpen: true, bottomOpen: false, showIgnored: false,
    lspState: 'ready', goplsAvailable: true, formatOnSave: true, importsOnSave: false, gofumpt: false, staticcheck: false,
    lintOnSave: false, linterAvailable: true, linting: false,
  }

  it('explains why run commands are blocked without trust or SDK', () => {
    expect(commandAvailability('run.run', { ...ready, authorized: false })).toMatch(/Trust/)
    expect(commandAvailability('run.build', { ...ready, toolchainReady: false })).toMatch(/Go SDK/)
    expect(commandAvailability('run.run', ready)).toBe(true)
  })

  it('keeps project-independent commands always available', () => {
    const empty = { ...ready, hasSession: false }
    expect(commandAvailability('file.openProject', empty)).toBe(true)
    expect(commandAvailability('file.save', empty)).toMatch(/project/)
  })

  it('only allows stop while running and blocks tidy meanwhile', () => {
    expect(commandAvailability('run.stop', ready)).not.toBe(true)
    expect(commandAvailability('run.stop', { ...ready, running: true })).toBe(true)
    expect(commandAvailability('go.tidy', { ...ready, running: true })).not.toBe(true)
  })

  it('reflects toggle state', () => {
    expect(commandChecked('view.toggleStructure', ready)).toBe(true)
    expect(commandChecked('view.toggleBottom', ready)).toBe(false)
    expect(commandChecked('go.trust', ready)).toBe(true)
  })

  it('gates semantic commands on a ready gopls and explains how to start it', () => {
    expect(commandAvailability('nav.usages', ready)).toBe(true)
    expect(commandAvailability('code.rename', { ...ready, lspState: 'starting' })).toMatch(/gopls/)
    expect(commandAvailability('nav.findInFiles', { ...ready, lspState: 'stopped' })).toBe(true)
    expect(commandAvailability('go.lspStart', { ...ready, lspState: 'stopped', goplsAvailable: false })).toMatch(/Install gopls/)
    expect(commandAvailability('go.lspStart', { ...ready, lspState: 'stopped' })).toBe(true)
    expect(commandChecked('code.formatOnSave', ready)).toBe(true)
  })

  it('runs the linter only on trusted projects with a linter installed, even without gopls', () => {
    expect(commandAvailability('code.lint', { ...ready, lspState: 'stopped' })).toBe(true)
    expect(commandAvailability('code.lint', { ...ready, linterAvailable: false })).toMatch(/golangci-lint/)
    expect(commandAvailability('code.lint', { ...ready, authorized: false })).toMatch(/Trust/)
  })
})
