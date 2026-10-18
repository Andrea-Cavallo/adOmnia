import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('@/lib/code-studio-lsp-api', () => ({ requestDocumentSymbols: vi.fn(), updateDocumentBuffer: vi.fn(), openExternalDocument: vi.fn() }))
vi.mock('@/lib/code-studio-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))
import { CodeStudioStructure } from './CodeStudioStructure'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { useIdeLanguageServersStore } from '@/stores/ideLanguageServers'

const range = { startLine: 1, startColumn: 1, endLine: 20, endColumn: 1 }
const symbols = [{ name: 'UserService', kind: 5, range, selectionRange: range, children: [
  { name: 'findUser', kind: 6, range, selectionRange: range },
] }]
const document = (language: string, name: string) => ({ document: { id: 'doc', sessionId: 's', language, name }, buffer: '', content: '' }) as never
const render = (language = 'java', name = 'UserService.java') => renderToStaticMarkup(<CodeStudioStructure sessionId="s" document={document(language, name)} />)
beforeEach(() => {
  useCodeStudioLspStore.setState({ status: {}, symbols: { doc: symbols } })
  useIdeLanguageServersStore.setState({ servers: { s: { java: { state: 'ready' } } } })
})
describe('Structure for registered languages', () => {
  it('shows Java classes and methods when Java is ready and Go is stopped', () => {
    const html = render()
    expect(html).toContain('UserService')
    expect(html).toContain('findUser')
    expect(html).not.toContain('gopls')
  })
  it('uses Java startup status even when Go is ready', () => {
    useCodeStudioLspStore.setState({ status: { s: { state: 'ready' } } as never })
    useIdeLanguageServersStore.setState({ servers: { s: { java: { state: 'starting' } } } })
    expect(render()).toContain('loading the workspace')
    expect(render()).not.toContain('findUser')
  })
  it('shows the Java server error instead of asking to start Go', () => {
    useIdeLanguageServersStore.setState({ servers: { s: { java: { state: 'missing', error: 'JDTLS not found' } } } })
    expect(render()).toContain('JDTLS not found')
    expect(render()).not.toContain('gopls')
  })
  it('still renders the Go structure using the Go server', () => {
    useCodeStudioLspStore.setState({ status: { s: { state: 'ready' } } as never })
    expect(render('go', 'service.go')).toContain('UserService')
  })
})

vi.mock('@/stores/codeStudioLsp', async (original) => {
  const actual = await original<typeof import('@/stores/codeStudioLsp')>()
  const hook = actual.useCodeStudioLspStore
  return { ...actual, useCodeStudioLspStore: Object.assign((selector: (state: ReturnType<typeof hook.getState>) => unknown) => selector(hook.getState()), hook) }
})

vi.mock('@/stores/ideLanguageServers', async (original) => {
  const actual = await original<typeof import('@/stores/ideLanguageServers')>()
  const hook = actual.useIdeLanguageServersStore
  return { ...actual, useIdeLanguageServersStore: Object.assign((selector: (state: ReturnType<typeof hook.getState>) => unknown) => selector(hook.getState()), hook) }
})
