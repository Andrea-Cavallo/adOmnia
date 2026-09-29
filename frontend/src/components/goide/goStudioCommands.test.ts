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
      if (command.editorOwned) continue
      for (const binding of [command.binding, ...(command.altBindings ?? [])]) {
        if (!binding) continue
        const label = formatBinding(binding, false)
        expect(seen.has(label), label).toBe(false)
        seen.add(label)
      }
    }
  })

  it('steps over with F8, F6 (Eclipse) and F10 (VS Code) and resumes with F9 or F5', () => {
    for (const stepKey of ['F8', 'F6', 'F10']) expect(commandForKey(key({ key: stepKey }))?.id).toBe('debug.stepOver')
    expect(commandForKey(key({ key: 'F9' }))?.id).toBe('debug.resume')
    expect(commandForKey(key({ key: 'F5' }))?.id).toBe('debug.resume')
    expect(commandForKey(key({ key: 'F7' }))?.id).toBe('debug.stepInto')
  })

  it('formats bindings per platform', () => {
    expect(formatBinding({ key: 'b', mod: true, shift: true }, false)).toBe('Ctrl+Shift+B')
    expect(formatBinding({ key: 'b', mod: true, shift: true }, true)).toBe('⌘⇧B')
  })
})

describe('Go Studio command availability', () => {
  const ready: GoStudioCommandContext = {
    hasSession: true, maximized: false, projectOpen: true, documentCount: 2, hasClosedDocuments: false, split: false, authorized: true, toolchainReady: true, running: false, restartable: true,
    hasEditor: true, activeDocumentDirty: true, sessionDirty: true, structureOpen: true, bottomOpen: false, showIgnored: false,
    lspState: 'ready', goplsAvailable: true, formatOnSave: true, importsOnSave: false, gofumpt: false, staticcheck: false,
    lintOnSave: false, linterAvailable: true, linting: false,
    semanticHighlighting: true, inlayHints: false, semanticTokensSupported: true, inlayHintsSupported: false,
    debugState: 'none', vcsAvailable: false, vcsChanges: 0, canGoBack: false, canGoForward: false, bookmarkCount: 0,
  }

  it('disables editor features the running gopls does not provide', () => {
    expect(commandAvailability('code.semanticHighlighting', ready)).toBe(true)
    expect(commandAvailability('code.inlayHints', ready)).toMatch(/does not provide/)
    expect(commandChecked('code.semanticHighlighting', ready)).toBe(true)
    expect(commandChecked('code.inlayHints', ready)).toBe(false)
  })

  it('enables stepping only while paused and gives F8 back to the editor otherwise', () => {
    expect(commandAvailability('debug.stepOver', ready)).toMatch(/not paused/)
    expect(commandAvailability('debug.stepOver', { ...ready, debugState: 'stopped' })).toBe(true)
    expect(commandAvailability('debug.pause', { ...ready, debugState: 'running' })).toBe(true)
    expect(commandAvailability('debug.stop', ready)).toMatch(/No debug/)
    expect(commandAvailability('debug.debug', { ...ready, authorized: false })).toMatch(/Trust/)
    const stepOver = commandForKey({ key: 'F8', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false })
    expect(stepOver?.id).toBe('debug.stepOver')
    expect(stepOver?.passThroughWhenUnavailable).toBe(true)
    expect(commandForKey({ key: 'F8', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })?.id).toBe('debug.toggleBreakpoint')
    expect(commandForKey({ key: 'F9', ctrlKey: false, metaKey: false, shiftKey: true, altKey: false })?.id).toBe('debug.debug')
  })

  it('explains why run commands are blocked without trust or SDK', () => {
    expect(commandAvailability('run.run', { ...ready, authorized: false })).toMatch(/Trust/)
    expect(commandAvailability('run.build', { ...ready, toolchainReady: false })).toMatch(/Go SDK/)
    expect(commandAvailability('run.run', ready)).toBe(true)
  })

  it('moves a project to its own window only when this window has no unsaved buffers for it', () => {
    expect(commandAvailability('window.openInNewWindow', ready)).toMatch(/unsaved changes stay in this window/)
    expect(commandAvailability('window.openInNewWindow', { ...ready, sessionDirty: false })).toBe(true)
    expect(commandAvailability('window.openInNewWindow', { ...ready, hasSession: false, sessionDirty: false })).toMatch(/project/)
    expect(commandAvailability('window.moveBack', ready)).toMatch(/already in the main window/)
  })

  it('limits a separate window to its own project and sends adOmnia panels to the main window', () => {
    const detached = { ...ready, detached: true }
    expect(commandAvailability('window.moveBack', detached)).toBe(true)
    expect(commandAvailability('window.openInNewWindow', detached)).toMatch(/single project/)
    for (const id of ['file.openProject', 'file.newProject', 'tools.services', 'tools.httpRequest', 'tools.plugins', 'vcs.gitStudio'] as const) {
      expect(commandAvailability(id, detached)).toMatch(/main adOmnia window/)
    }
    expect(commandAvailability('file.closeProject', detached)).toMatch(/Move the project back/)
    expect(commandAvailability('file.closeProject', ready)).toBe(true)
    expect(commandAvailability('file.closeProject', { ...ready, ownedElsewhere: true })).toMatch(/separate window/)
    expect(commandAvailability('run.run', detached)).toBe(true)
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
