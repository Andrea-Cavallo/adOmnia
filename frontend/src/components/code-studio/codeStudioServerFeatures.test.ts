import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/code-studio-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))
vi.mock('@/lib/code-studio-lsp-api', () => ({}))
import { featuresForEditor } from './codeStudioServerFeatures'
import { useIdeLanguageServersStore } from '@/stores/ideLanguageServers'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
const features = { semanticTokens: true, tokenTypes: ['class', 'variable', 'property', 'method'], tokenModifiers: ['readonly', 'static'], inlayHints: false, documentHighlight: true, callHierarchy: false }
beforeEach(() => {
  useCodeStudioLspStore.setState({ status: {} })
  useIdeLanguageServersStore.setState({ servers: {} })
})
describe('semantic capabilities for the active language', () => {
  it('keeps the Java legend from its status event with Go stopped', () => {
    useIdeLanguageServersStore.getState().handleEvent({ type: 'lsp.status', sessionId: 's', payload: { language: 'java', state: 'ready', features } } as never)
    expect(featuresForEditor('s', 'java')).toEqual(features)
    expect(featuresForEditor('s', 'go')).toBeNull()
  })
  it('never applies the Go legend to Java', () => {
    useCodeStudioLspStore.setState({ status: { s: { state: 'ready', features } } as never })
    expect(featuresForEditor('s', 'java')).toBeNull()
    expect(featuresForEditor('s', 'go')).toEqual(features)
  })
  it('clears capabilities when Java stops', () => {
    const store = useIdeLanguageServersStore.getState()
    store.handleEvent({ type: 'lsp.status', sessionId: 's', payload: { language: 'java', state: 'ready', features } } as never)
    store.handleEvent({ type: 'lsp.status', sessionId: 's', payload: { language: 'java', state: 'stopped' } } as never)
    expect(featuresForEditor('s', 'java')).toBeNull()
  })
})
