import { describe, expect, it } from 'vitest'
import { CODE_STUDIO_COMMANDS, commandAvailability, type CodeStudioCommandContext, type CodeStudioCommandId } from './codeStudioCommands'

const context = (patch: Partial<CodeStudioCommandContext> = {}) => ({ hasSession: true, authorized: true, hasEditor: true, languages: undefined, ...patch }) as CodeStudioCommandContext

describe('Live Preview commands', () => {
  it('are registered in the Run, View and Tools menus with Go Live on Alt+L', () => {
    const byId = (id: CodeStudioCommandId) => CODE_STUDIO_COMMANDS.find((command) => command.id === id)
    expect(byId('preview.goLive')).toMatchObject({ menu: 'run', binding: { key: 'l', alt: true } })
    expect(byId('preview.show')?.menu).toBe('view')
    expect(byId('web.installTools')?.menu).toBe('tools')
  })

  it('need a project, and trust to run anything', () => {
    expect(commandAvailability('preview.goLive', context({ hasSession: false }))).toMatch(/Open a Go project/)
    expect(commandAvailability('preview.goLive', context({ authorized: false }))).toMatch(/Trust this project/)
    expect(commandAvailability('preview.goLive', context())).toBe(true)
    expect(commandAvailability('web.installTools', context({ authorized: false }))).toMatch(/Trust this project/)
  })

  it('let you move the preview around even before trusting', () => {
    expect(commandAvailability('preview.placeTab', context({ authorized: false }))).toBe(true)
    expect(commandAvailability('preview.show', context({ authorized: false }))).toBe(true)
  })

  it('open-file needs an editor', () => {
    expect(commandAvailability('preview.openFile', context({ hasEditor: false }))).toBe('Open an HTML file first')
  })

  it('make ▶ Run mean Go Live in a web-only project, even without a Go SDK', () => {
    expect(commandAvailability('run.run', context({ webOnly: true, toolchainReady: false }))).toBe(true)
    expect(commandAvailability('run.run', context({ webOnly: true, authorized: false }))).toMatch(/Trust this project/)
    expect(commandAvailability('run.run', context({ webOnly: false, toolchainReady: false }))).not.toBe(true)
  })
})
