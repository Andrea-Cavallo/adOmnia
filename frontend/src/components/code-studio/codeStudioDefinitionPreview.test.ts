import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ documents: [] as Array<{ document: { id: string; uri: string; sessionId: string } }>, models: new Map<string, unknown>(), close: vi.fn(), read: vi.fn() }))
vi.mock('@/lib/monacoSetup', () => ({ monaco: {
  MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
  Uri: { parse: (uri: string) => ({ toString: () => uri, with: ({ fragment }: { fragment: string }) => ({ toString: () => uri.split('#')[0] + (fragment ? '#' + fragment : '') }) }) },
  editor: { getModel: (uri: { toString(): string }) => mock.models.get(uri.toString()), createModel: (text: string, language: string, uri: { toString(): string }) => {
    const model = { uri, getValue: () => text, getLanguageId: () => language, onWillDispose: vi.fn(), dispose: vi.fn() }
    mock.models.set(uri.toString(), model); return model
  } },
} }))
vi.mock('@/stores/codeStudio', () => ({ useCodeStudioStore: { getState: () => ({ documents: mock.documents }) } }))
vi.mock('@/stores/codeStudioLsp', () => ({ useCodeStudioLspStore: { getState: () => ({ status: {} }) } }))
vi.mock('@/stores/ideLanguageServers', () => ({ isServerReady: () => true, serverLanguageForEditor: () => 'java' }))
vi.mock('@/stores/ideExtensions', () => ({ extensionLanguageForPath: () => undefined }))
vi.mock('@/lib/code-studio-api', () => ({ openGoIDEDocument: (...args: unknown[]) => mock.read(...args), closeGoIDEDocument: (...args: unknown[]) => mock.close(...args) }))
vi.mock('@/lib/code-studio-lsp-api', () => ({ openExternalDocument: vi.fn() }))
vi.mock('./codeStudioLspSync', () => ({ flushCodeStudioDocument: vi.fn(), currentCodeStudioDocumentVersion: () => null }))
vi.mock('./codeStudioDependencySource', () => ({}))
vi.mock('./codeStudioWorkspaceEdits', () => ({}))
vi.mock('./codeStudioLintActions', () => ({}))
vi.mock('./codeStudioAIFixRunner', () => ({}))
import { documentForModel, ensurePreviewModel, prepareDocument, rememberLocations } from './codeStudioLanguageFeatures'
const location = (name: string) => ({ uri: `file:///project/${name}.java`, path: `/project/${name}.java`, relativePath: `${name}.java`, external: false, range: { startLine: 5, startColumn: 9, endLine: 5, endColumn: 15 } })
beforeEach(() => {
 mock.models.clear(); mock.documents = []; mock.close.mockClear()
 mock.read.mockImplementation(async (sessionId: string, relativePath: string) => ({ document: { id: relativePath, sessionId, uri: `file:///project/${relativePath}`, relativePath, name: relativePath, language: 'java' }, content: 'class Service { void inner() {} }' }))
})
it('keeps each Java definition tracked for subsequent nested method navigation', async () => {
 for (const name of ['Outer', 'Inner', 'Nested']) {
  const target = location(name)
  await ensurePreviewModel('s', target)
  const [definition] = rememberLocations([target], 's')
  const model = mock.models.get(definition.uri.toString()) as never
  expect(documentForModel(model)?.document.id).toBe(`${name}.java`)
  expect(await prepareDocument(model)).toMatchObject({ sessionId: 's', documentId: `${name}.java` })
 }
 expect(mock.close).not.toHaveBeenCalled()
})
it('keeps previews of the same Java source separate across projects', async () => {
 await ensurePreviewModel('one', location('Shared'))
 await ensurePreviewModel('two', location('Shared'))
 expect(mock.models.size).toBe(2)
 for (const sessionId of ['one', 'two']) {
  const [target] = rememberLocations([location('Shared')], sessionId)
  expect(documentForModel(mock.models.get(target.uri.toString()) as never)?.document.sessionId).toBe(sessionId)
 }
})
