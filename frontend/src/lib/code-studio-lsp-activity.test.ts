import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('../../bindings/adomnia/goide', () => ({
  StartLanguageServer: vi.fn(async () => ({})), RestartLanguageServer: vi.fn(async () => ({})),
  StartAutomaticLanguageServer: vi.fn(async () => ({})), RestartAutomaticLanguageServer: vi.fn(async () => ({})),
}))
import * as bindings from '../../bindings/adomnia/goide'
import { startLanguageServer, restartLanguageServer } from './code-studio-lsp-api'
const settings = { gofumpt: false, staticcheck: false, placeholders: false, semanticLinks: false, vulncheck: false }
beforeEach(() => vi.clearAllMocks())
it('defaults API calls to explicit protected starts and restarts', async () => {
  await startLanguageServer('session', settings); await restartLanguageServer('session', settings)
  expect(bindings.StartLanguageServer).toHaveBeenCalledWith('session', settings)
  expect(bindings.RestartLanguageServer).toHaveBeenCalledWith('session', settings)
  expect(bindings.StartAutomaticLanguageServer).not.toHaveBeenCalled()
})
it('routes automatic editor work through separate additive bindings', async () => {
  await startLanguageServer('session', settings, false); await restartLanguageServer('session', settings, false)
  expect(bindings.StartAutomaticLanguageServer).toHaveBeenCalledWith('session', settings)
  expect(bindings.RestartAutomaticLanguageServer).toHaveBeenCalledWith('session', settings)
  expect(bindings.StartLanguageServer).not.toHaveBeenCalled()
})
