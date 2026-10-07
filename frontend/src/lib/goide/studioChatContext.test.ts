import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  policy: 'allowed', excluded: [] as string[],
  state: {
    sessions: [{ id: 's1', project: { realPath: '/project', name: 'Example' } }],
    activeDocumentBySession: { s1: 'doc1' },
    documents: [{ document: { id: 'doc1', sessionId: 's1', relativePath: 'src/Example.java' }, buffer: 'class Example {\n  String value = "unsaved";\n}', dirty: true }],
    directoryEntries: { s1: { '': [{ relativePath: 'src', ignored: false }, { relativePath: '.env', ignored: false }] } },
  },
}))
vi.mock('@/stores/goide', () => ({ useGoIDEStore: { getState: () => fixture.state } }))
vi.mock('@/lib/goide-api', () => ({
  getGoIDEAIPolicy: vi.fn(async () => fixture.policy),
  listGoIDEAIExcludedPaths: vi.fn(async () => fixture.excluded),
  quickOpenGoIDEFiles: vi.fn(async () => [{ relativePath: 'src/unexpanded/Other.java' }]),
}))
import { prepareStudioChat } from './studioChatContext'

beforeEach(() => {
  fixture.policy = 'allowed'
  fixture.excluded = ['.env']
  fixture.state.activeDocumentBySession.s1 = 'doc1'
  fixture.state.documents[0].buffer = 'class Example {\n  String value = "unsaved";\n}'
})
const enabled = { includeDocument: true, includeWorkspace: true }

describe('chat receives the editor context, not just the project folder', () => {
  it('identifies the current class and includes unsaved source and project paths', async () => {
    const prompt = await prepareStudioChat('/project', 'Leggi la classe aperta', enabled)
    expect(prompt.message).toContain('Active file: src/Example.java')
    expect(prompt.message).toContain('String value = "unsaved"')
    expect(prompt.message).toContain('Project: Example')
    expect(prompt.message).toContain('src/unexpanded/Other.java')
    expect(prompt.labels).toContain('src/Example.java (unsaved)')
    expect(prompt.message).not.toContain('.env')
  })
  it('includes the selection from the live buffer using UTF-16 columns', async () => {
    const prompt = await prepareStudioChat('/project', 'Explain', { ...enabled, selection: { startLine: 1, startCharacter: 2, endLine: 1, endCharacter: 8 } })
    expect(prompt.message).toContain('Selected code (lines 2-2):\nString')
  })
  it('supports a selection without attaching the full file', async () => {
    const prompt = await prepareStudioChat('/project', 'Explain', { includeDocument: false, includeWorkspace: false, selection: { startLine: 1, startCharacter: 2, endLine: 1, endCharacter: 8 } })
    expect(prompt.message).toContain('Selected code (lines 2-2):\nString')
    expect(prompt.message).not.toContain('unsaved"')
  })
  it('never attaches ignored source or inline secrets', async () => {
    fixture.state.documents[0].buffer = 'const api_key = "very-secret-token"'
    let prompt = await prepareStudioChat('/project', 'Read', enabled)
    expect(prompt.message).not.toContain('very-secret-token')
    fixture.excluded.push('src/Example.java')
    prompt = await prepareStudioChat('/project', 'Read', enabled)
    expect(prompt.message).not.toContain('const api_key')
    expect(prompt.labels).toContain('File excluded from AI')
  })
  it.each(['off', 'local-only'])('blocks project context under policy %s', async (policy) => {
    fixture.policy = policy
    await expect(prepareStudioChat('/project', 'Read', enabled)).rejects.toThrow()
  })
  it('honours both attachment switches', async () => {
    const prompt = await prepareStudioChat('/project', 'Read', { includeDocument: false, includeWorkspace: false })
    expect(prompt.message).not.toContain('String value')
    expect(prompt.message).not.toContain('Project: Example')
    expect(prompt.labels).toEqual([])
  })
  it('explicitly reports a missing active file instead of guessing', async () => {
    fixture.state.activeDocumentBySession.s1 = 'closed'
    const prompt = await prepareStudioChat('/project', 'Read', enabled)
    expect(prompt.message).toContain('No active editor file')
  })
  it('never borrows a document from another project', async () => {
    await expect(prepareStudioChat('/other', 'Read', enabled)).rejects.toThrow('no longer open')
  })
  it('keeps milk slash commands unchanged', async () => {
    expect(await prepareStudioChat('/project', '/agent list', enabled, true)).toEqual({ message: '/agent list', labels: [] })
  })
  it('bounds multibyte buffers to the Copilot transport limit', async () => {
    fixture.state.documents[0].buffer = '文'.repeat(20000)
    const prompt = await prepareStudioChat('/project', '文'.repeat(15000), enabled)
    expect(new TextEncoder().encode(prompt.message).length).toBeLessThanOrEqual(64 * 1024)
    expect(prompt.message).toContain('[Context truncated]')
  })
})
