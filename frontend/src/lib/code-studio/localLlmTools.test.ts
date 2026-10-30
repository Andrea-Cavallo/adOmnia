import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoIDESession } from '@/lib/code-studio-api'
import type { LocalToolCall } from '@/lib/localLlm'
const fixture = vi.hoisted(() => ({
  policy: 'allowed', excluded: [] as string[], open: vi.fn(), create: vi.fn(), close: vi.fn(), update: vi.fn(),
  state: { activeSessionId: 's1', documents: [{ document: { id: 'd1', sessionId: 's1', relativePath: 'main.go', readOnly: false }, buffer: 'func original() {}' }], openDocument: vi.fn(), updateDocument: vi.fn() },
}))
vi.mock('@/lib/code-studio-api', () => ({ getGoIDEAIPolicy: async () => fixture.policy, listGoIDEAIExcludedPaths: async () => fixture.excluded, openGoIDEDocument: fixture.open, closeGoIDEDocument: fixture.close, createGoIDEFiles: fixture.create, quickOpenGoIDEFiles: async () => [{ relativePath: 'main.go' }, { relativePath: '.env' }] }))
vi.mock('@/lib/code-studio-lsp-api', () => ({ requestWorkspaceSymbols: async () => [] }))
vi.mock('@/stores/codeStudio', () => ({ useCodeStudioStore: { getState: () => fixture.state } }))
vi.mock('@/lib/aiRedaction', () => ({ createAIRedactor: () => ({ redact: (text: string) => text.replace('SECRET', '[redacted]') }) }))
import { applyLocalProposal, executeLocalTool, projectRelativePath } from './localLlmTools'
const session = { id: 's1', project: { realPath: '/project' } } as GoIDESession
const call = (name: string, args: unknown): LocalToolCall => ({ id: 'call1', type: 'function', function: { name, arguments: JSON.stringify(args) } })
beforeEach(() => { fixture.policy = 'allowed'; fixture.excluded = []; fixture.state.documents[0].buffer = 'func original() {}'; fixture.state.openDocument.mockResolvedValue('d1'); fixture.state.updateDocument.mockReset(); fixture.open.mockReset() })
describe('local project tools', () => {
  it('rejects absolute and parent paths', () => {
    for (const path of ['/etc/passwd', 'C:\\Users\\secrets', '../.env', 'src/../../.env', '\\server\\file']) expect(() => projectRelativePath(path)).toThrow()
    expect(projectRelativePath('src\\main.go')).toBe('src/main.go')
  })
  it('reads unsaved content and redacts tool output', async () => {
    fixture.state.documents[0].buffer = 'unsaved SECRET'
    const result = await executeLocalTool(session, call('read_project_file', { path: 'main.go' }), vi.fn())
    expect(result).toContain('unsaved [redacted]')
    expect(fixture.open).not.toHaveBeenCalled()
  })
  it('enforces AI policy and exclusions before reading', async () => {
    fixture.excluded = ['main.go']
    await expect(executeLocalTool(session, call('read_project_file', { path: 'main.go' }), vi.fn())).rejects.toThrow('excluded')
    fixture.policy = 'off'
    await expect(executeLocalTool(session, call('list_project_files', { query: '' }), vi.fn())).rejects.toThrow('disabled')
    expect(fixture.open).not.toHaveBeenCalled()
  })
  it('filters excluded paths out of the file index', async () => {
    fixture.excluded = ['.env']
    expect(await executeLocalTool(session, call('list_project_files', { query: '' }), vi.fn())).toBe('["main.go"]')
  })
  it('only proposes edits, requires one exact match, and refuses stale apply', async () => {
    const propose = vi.fn()
    const result = await executeLocalTool(session, call('propose_edit', { path: 'main.go', before: 'original', after: '$& literal' }), propose)
    expect(result).toContain('awaiting_user_review')
    expect(propose.mock.calls[0][0].updated).toBe('func $& literal() {}')
    expect(fixture.state.updateDocument).not.toHaveBeenCalled()
    const edit = propose.mock.calls[0][0]
    fixture.state.documents[0].buffer = 'changed after preview'
    await expect(applyLocalProposal(session, edit)).rejects.toThrow('changed')
    fixture.state.documents[0].buffer = edit.original
    await applyLocalProposal(session, edit)
    expect(fixture.state.updateDocument).toHaveBeenCalledWith('d1', edit.updated)
    await expect(executeLocalTool(session, call('propose_edit', { path: 'main.go', before: 'absent', after: 'x' }), propose)).rejects.toThrow('exactly once')
  })
  it('proposes new files only for missing paths and creates them on apply', async () => {
    const propose = vi.fn()
    await expect(executeLocalTool(session, call('propose_create_file', { path: 'main.go', content: 'x' }), propose)).rejects.toThrow('already exists')
    await expect(executeLocalTool(session, call('propose_create_file', { path: '../x.go', content: 'x' }), propose)).rejects.toThrow()
    expect(await executeLocalTool(session, call('propose_create_file', { path: String.raw`pkg\doc.go`, content: 'package pkg' }), propose)).toContain('awaiting_user_review')
    const edit = propose.mock.calls[0][0]
    expect(edit).toMatchObject({ path: 'pkg/doc.go', create: true, updated: 'package pkg' })
    expect(fixture.create).not.toHaveBeenCalled()
    await applyLocalProposal(session, edit)
    expect(fixture.create).toHaveBeenCalledWith('s1', [{ relativePath: 'pkg/doc.go', content: 'package pkg' }])
  })
})
