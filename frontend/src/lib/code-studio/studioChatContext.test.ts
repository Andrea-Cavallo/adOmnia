import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  policy: 'allowed', excluded: [] as string[], rules: [] as { path: string; text: string; truncated?: boolean }[],
  state: {
    sessions: [{ id: 's1', project: { realPath: '/project', name: 'Example' } }],
    activeDocumentBySession: { s1: 'doc1' },
    documents: [{ document: { id: 'doc1', sessionId: 's1', relativePath: 'src/Example.java' }, buffer: 'class Example {\n  String value = "unsaved";\n}', dirty: true }],
    directoryEntries: { s1: { '': [{ relativePath: 'src', ignored: false }, { relativePath: '.env', ignored: false }] } },
  },
}))
vi.mock('@/stores/codeStudio', () => ({ useCodeStudioStore: { getState: () => fixture.state } }))
vi.mock('@/lib/code-studio-api', () => ({
  getGoIDEAIPolicy: vi.fn(async () => fixture.policy),
  getGoIDEProjectRules: vi.fn(async () => fixture.rules),
  listGoIDEAIExcludedPaths: vi.fn(async () => fixture.excluded),
  quickOpenGoIDEFiles: vi.fn(async () => [{ relativePath: 'src/unexpanded/Other.java' }]),
}))
import { prepareStudioChat } from './studioChatContext'

beforeEach(() => {
  fixture.rules = []
  fixture.policy = 'allowed'
  fixture.excluded = ['.env']
  fixture.state.activeDocumentBySession.s1 = 'doc1'
  fixture.state.documents[0].buffer = 'class Example {\n  String value = "unsaved";\n}'
})
const enabled = { includeDocument: true, includeWorkspace: true }

describe('chat receives the editor context, not just the project folder', () => {
  it('redacts explicit external files and labels images without inserting their bytes as text', async () => {
    const prompt = await prepareStudioChat('/project', 'Review', { ...enabled, attachments: [
      { kind: 'text', name: 'outside.py', mimeType: 'text/plain', text: 'const api_key = "very-secret-token"' },
      { kind: 'image', name: 'shot.png', mimeType: 'image/png', data: 'BASE64_NOT_TEXT' },
    ] })
    expect(prompt.message).toContain('External file chosen by the user: outside.py')
    expect(prompt.message).not.toContain('very-secret-token')
    expect(prompt.message).not.toContain('BASE64_NOT_TEXT')
    expect(prompt.labels).toContain('shot.png (image)')
  })
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

it('automatically attaches named project rules, redacts secrets and allows opt-out', async () => {
  fixture.rules = [{ path: 'AGENTS.md', text: 'Use focused tests. api_key = "very-secret-token"' }, { path: 'CLAUDE.md', text: 'Keep state local.', truncated: true }]
  const prompt = await prepareStudioChat('/project', 'Explain', { includeDocument: false, includeWorkspace: false })
  expect(prompt.message).toContain('Project rules: AGENTS.md')
  expect(prompt.message).toContain('Use focused tests.')
  expect(prompt.message).not.toContain('very-secret-token')
  expect(prompt.labels).toEqual(['AGENTS.md', 'CLAUDE.md (truncated)'])
  expect(prompt.message).toContain('[Rules truncated]')
  const off = await prepareStudioChat('/project', 'Explain', { includeDocument: false, includeWorkspace: false, includeRules: false })
  expect(off.message).not.toContain('Use focused tests.')
  expect(off.labels).toEqual([])
  fixture.rules = [{ path: 'AGENTS.md', text: 'Changed on disk' }]
  expect((await prepareStudioChat('/project', 'Again', enabled)).message).toContain('Changed on disk')
})


describe('local agent context', () => {
  it('allows a restricted local adapter on local-only projects and retains redaction', async () => {
    fixture.policy = 'local-only'
    fixture.state.documents[0].buffer = 'const api_key = "very-secret-token"'
    const result = await prepareStudioChat('/project', 'Explain', enabled, false, true)
    expect(result.labels).toContain('src/Example.java (unsaved)')
    expect(result.message).not.toContain('very-secret-token')
    await expect(prepareStudioChat('/project', 'Explain', enabled)).rejects.toThrow('local AI')
    fixture.policy = 'off'
    await expect(prepareStudioChat('/project', 'Explain', enabled, false, true)).rejects.toThrow('turned off')
  })
})
