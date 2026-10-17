import { describe, expect, it } from 'vitest'
import { gitPathInProject } from './codeStudioGitPaths'

describe('Git paths in multi-repository projects', () => {
  it('opens files in child repositories through their project-relative path', () => {
    expect(gitPathInProject('/workspace', '/workspace/api', 'main.go')).toBe('api/main.go')
    expect(gitPathInProject('/workspace', '/workspace/worker', 'main.go')).toBe('worker/main.go')
  })
  it('keeps enclosing repos scoped to the open project', () => {
    expect(gitPathInProject('/repo/api', '/repo', 'api/main.go')).toBe('main.go')
    expect(gitPathInProject('/repo/api', '/repo', 'worker/main.go')).toBeNull()
    expect(gitPathInProject('/repo/api', '/other', 'main.go')).toBeNull()
  })
  it('handles Windows paths without case-sensitive root mismatches', () => {
    expect(gitPathInProject('C:\\Workspace', 'c:\\workspace\\api', 'main.go')).toBe('api/main.go')
  })
})
