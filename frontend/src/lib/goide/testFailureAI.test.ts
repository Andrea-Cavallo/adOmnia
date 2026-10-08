import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoIDETestResult, GoIDETestRun } from '@/lib/goide-tests-api'
const mocks = vi.hoisted(() => ({ policy: vi.fn(), excluded: vi.fn() }))
vi.mock('@/lib/goide-api', () => ({ getGoIDEAIPolicy: mocks.policy, listGoIDEAIExcludedPaths: mocks.excluded }))
import { testFailureDraft } from './testFailureAI'

const result = { id: 'node', name: 'TestRead/invalid', package: 'example.com/api', status: 'fail', directory: 'svc/api', failure: { relativePath: 'svc/api/read_test.go', line: 42 } } as GoIDETestResult
const run = { runId: 'run-1', sessionId: 'project-1', request: { sessionId: 'project-1', workingDirectory: 'svc', packages: ['./...'], repeat: 10, race: true, shuffle: 'on' }, results: [{ id: 'pkg', package: result.package, name: '', directory: 'svc/api', shuffleSeed: '123', status: 'fail' }, result] } as unknown as GoIDETestRun

beforeEach(() => { vi.clearAllMocks(); mocks.policy.mockResolvedValue('allowed'); mocks.excluded.mockResolvedValue([]) })
describe('recorded test failure AI draft', () => {
  it('includes evidence and the exact scoped reproduction options without running anything', async () => {
    const draft = await testFailureDraft(run, result, 'read_test.go:42: expected 1, got 2')
    expect(draft).toContain('TestRead/invalid')
    expect(draft).toContain('expected 1, got 2')
    expect(draft).toContain('svc/api/read_test.go:42')
    expect(draft).toContain('-race')
    expect(draft).toContain('-count=10')
    expect(draft).toContain('-shuffle=123')
    expect(mocks.excluded).toHaveBeenCalledWith('project-1', ['svc/api/read_test.go'], false)
  })
  it.each(['off', 'local-only'])('blocks %s project policy', async (policy) => {
    mocks.policy.mockResolvedValue(policy)
    await expect(testFailureDraft(run, result, 'failed')).rejects.toThrow(/project/)
    expect(mocks.excluded).not.toHaveBeenCalled()
  })
  it('fails closed when policy cannot be read', async () => {
    mocks.policy.mockRejectedValue(new Error('offline'))
    await expect(testFailureDraft(run, result, 'failed')).rejects.toThrow('offline')
  })
  it('rejects excluded source locations, including stack frames outside the failed test', async () => {
    mocks.excluded.mockResolvedValue(['svc/api/private.go'])
    await expect(testFailureDraft(run, result, 'private.go:9: panic')).rejects.toThrow('excluded')
    expect(mocks.excluded).toHaveBeenCalledWith('project-1', ['svc/api/read_test.go', 'svc/api/private.go'], false)
  })
  it('maps absolute Windows stack frames to project-relative exclusion paths', async () => {
    await testFailureDraft(run, result, 'C:\\My Project\\svc\\api\\private.go:9: panic', 'c:\\my project')
    expect(mocks.excluded).toHaveBeenCalledWith('project-1', ['svc/api/read_test.go', 'svc/api/private.go'], false)
  })
  it('redacts secrets before truncating multibyte output and labels incomplete captures', async () => {
    const secret = 'ghp_' + 'a'.repeat(36)
    const draft = await testFailureDraft({ ...run, overflow: true } as GoIDETestRun, result, `token="${secret}"\n` + '漢'.repeat(30000))
    expect(draft).not.toContain(secret)
    expect(draft).toContain('ADOMNIA_REDACTED_')
    expect(draft).toContain('capture truncated')
    expect(draft).toContain('Output truncated for AI')
    expect(new TextEncoder().encode(draft).length).toBeLessThan(56 * 1024)
  })
  it('rejects passing results and missing output', async () => {
    await expect(testFailureDraft(run, { ...result, status: 'pass' } as GoIDETestResult, 'ok')).rejects.toThrow('failed')
    await expect(testFailureDraft(run, result, ' ')).rejects.toThrow('No failure output')
    expect(mocks.policy).not.toHaveBeenCalled()
  })
})
