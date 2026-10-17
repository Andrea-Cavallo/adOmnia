import { beforeEach, describe, expect, it, vi } from 'vitest'

const ai = vi.hoisted(() => ({ complete: vi.fn(), configure: vi.fn(() => Promise.resolve()), available: true }))
const codeStudio = vi.hoisted(() => ({ diff: vi.fn(), policy: 'allowed' as string, excluded: [] as string[] }))

vi.mock('../../../bindings/adomnia/aiengine', () => ({ Complete: ai.complete }))
vi.mock('../../../bindings/adomnia/goide', () => ({ VCSWorkingDiff: codeStudio.diff }))
vi.mock('@/lib/aiEngine', () => ({ ensureAIConfigured: ai.configure }))
vi.mock('@/lib/aiAvailability', () => ({ isAICompanionAvailable: () => ai.available }))
vi.mock('@/lib/code-studio-api', () => ({
  getGoIDEAIPolicy: vi.fn(async () => codeStudio.policy),
  isLocalAIProvider: () => false,
  listGoIDEAIExcludedPaths: vi.fn(async () => codeStudio.excluded),
}))
vi.mock('@/stores/settings', () => ({ useSettingsStore: { getState: () => ({ settings: { ai: { provider: 'openai' } } }) } }))

import { buildCommitMessagePrompt, draftCodeStudioCommitMessage, parseCommitMessage } from './codeStudioCommitMessageAI'

describe('commit message prompt', () => {
  it('carries branch, files, changed symbols and the diff to describe', () => {
    const prompt = buildCommitMessagePrompt({
      branch: 'feature/x',
      files: [{ relativePath: 'svc/handler.go', diff: '@@ -1,2 +1,2 @@\n-old\n+new' }],
      symbols: [{ name: 'Handle', kind: 'func', change: 'modified', breaking: true }],
    })
    expect(prompt.system).toContain('Conventional Commits')
    expect(prompt.system).toContain('Reply ONLY with the commit message')
    expect(prompt.user).toContain('Branch: feature/x.')
    expect(prompt.user).toContain('- svc/handler.go')
    expect(prompt.user).toContain('modified func Handle (breaking)')
    expect(prompt.user).toContain('--- svc/handler.go ---')
    expect(prompt.user).toContain('+new')
  })

  it('says why a file has no diff instead of sending its content', () => {
    const prompt = buildCommitMessagePrompt({
      branch: '',
      files: [
        { relativePath: '.env', diff: '', note: 'excluded' },
        { relativePath: 'logo.png', diff: '', note: 'binary' },
      ],
      symbols: [],
    })
    expect(prompt.user).toContain('- .env (content excluded by project AI rules)')
    expect(prompt.user).toContain('- logo.png (binary file)')
    expect(prompt.user).not.toContain('```diff')
  })
})

describe('commit message response', () => {
  it('strips fences and trims the message', () => {
    expect(parseCommitMessage('```markdown\nfeat: add error handling\n\nWrapped errors are returned.\n```')).toBe('feat: add error handling\n\nWrapped errors are returned.')
  })

  it('refuses an empty answer instead of inventing a message', () => {
    expect(() => parseCommitMessage('   ')).toThrow('commit message')
    expect(() => parseCommitMessage('```\n```')).toThrow('commit message')
  })
})

describe('commit message draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ai.available = true
    codeStudio.policy = 'allowed'
    codeStudio.excluded = []
    codeStudio.diff.mockResolvedValue({ original: 'package x\n\nfunc a() {}\n', modified: 'package x\n\nfunc a() error { return nil }\n', binary: false, tooLarge: false })
    ai.complete.mockResolvedValue('feat: handle errors in a')
  })

  it('describes the changes of the selected files and returns the message', async () => {
    const message = await draftCodeStudioCommitMessage('s1', ['svc/a.go'], [{ name: 'a', kind: 'func', change: 'modified' }], 'main')
    expect(message).toBe('feat: handle errors in a')
    const [system, user] = ai.complete.mock.calls[0]
    expect(system).toContain('Conventional Commits')
    expect(user).toContain('Branch: main.')
    expect(user).toContain('--- svc/a.go ---')
    expect(user).toContain('+func a() error { return nil }')
  })

  it('refuses under the off policy and never calls the provider', async () => {
    codeStudio.policy = 'off'
    await expect(draftCodeStudioCommitMessage('s1', ['svc/a.go'])).rejects.toThrow('AI is turned off')
    expect(ai.complete).not.toHaveBeenCalled()
  })

  it('never sends the content of files excluded by .adomnia/aiignore', async () => {
    codeStudio.excluded = ['svc/secret.go']
    codeStudio.diff.mockImplementation(async (_sessionId: string, path: string) => path === 'svc/secret.go'
      ? { original: 'package x\n', modified: 'package x\nfunc hidden() { println("MARKER-EXCLUDED-CONTENT") }\n', binary: false, tooLarge: false }
      : { original: 'package x\n\nfunc a() {}\n', modified: 'package x\n\nfunc a() error { return nil }\n', binary: false, tooLarge: false })
    await draftCodeStudioCommitMessage('s1', ['svc/secret.go', 'svc/a.go'])
    const [, user] = ai.complete.mock.calls[0]
    expect(user).toContain('- svc/secret.go (content excluded by project AI rules)')
    expect(user).not.toContain('MARKER-EXCLUDED-CONTENT')
    expect(codeStudio.diff).toHaveBeenCalledTimes(1)
    expect(codeStudio.diff).toHaveBeenCalledWith('s1', 'svc/a.go')
  })

  it('fails when no selected file has a textual change', async () => {
    codeStudio.diff.mockResolvedValue({ original: 'a\n', modified: 'a\n', binary: false, tooLarge: false })
    await expect(draftCodeStudioCommitMessage('s1', ['svc/a.go'])).rejects.toThrow('textual change')
  })
})
