import { describe, expect, it } from 'vitest'
import { GITIGNORE_TEMPLATES } from './codeStudioFileActions'

describe('gitignore templates', () => {
  it('cover common local files and language build output', () => {
    expect(GITIGNORE_TEMPLATES.go).toContain('*.test')
    expect(GITIGNORE_TEMPLATES.go).toContain('*.pprof')
    expect(GITIGNORE_TEMPLATES.node).toContain('node_modules/')
    expect(GITIGNORE_TEMPLATES.python).toContain('__pycache__/')
    expect(GITIGNORE_TEMPLATES.java).toContain('.gradle/')
    for (const template of Object.values(GITIGNORE_TEMPLATES)) {
      expect(template).toContain('.env.local')
      expect(template).toContain('*.log')
      expect(template).toContain('.idea/')
    }
  })
})
