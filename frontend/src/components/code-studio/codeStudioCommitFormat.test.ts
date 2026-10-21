import { describe, expect, it } from 'vitest'
import {
  COMMIT_FORMAT_KEY,
  DEFAULT_COMMIT_FORMAT,
  DEFAULT_COMMIT_TEMPLATE,
  commitFormatInstructions,
  loadCommitFormat,
  normalizeCommitTemplate,
  saveCommitFormat,
} from './codeStudioCommitFormat'
import { buildCommitMessagePrompt } from './codeStudioCommitMessageAI'

function storageOf(initial: Record<string, string> = {}) {
  const values = { ...initial }
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value },
    values,
  }
}

describe('commit message format', () => {
  it('defaults to Conventional Commits without any stored preference', () => {
    const preference = loadCommitFormat(storageOf())
    expect(preference.format).toBe('conventional')
    expect(preference.template).toBe(DEFAULT_COMMIT_TEMPLATE)
    expect(DEFAULT_COMMIT_FORMAT.format).toBe('conventional')
  })

  it('round-trips the preference and survives corrupt or unknown values', () => {
    const storage = storageOf()
    saveCommitFormat({ format: 'free', template: 'x' }, storage)
    expect(loadCommitFormat(storage).format).toBe('free')

    expect(loadCommitFormat(storageOf({ [COMMIT_FORMAT_KEY]: '{not json' })).format).toBe('conventional')
    expect(loadCommitFormat(storageOf({ [COMMIT_FORMAT_KEY]: JSON.stringify({ format: 'yaml' }) })).format).toBe('conventional')
    expect(loadCommitFormat(storageOf({ [COMMIT_FORMAT_KEY]: JSON.stringify({ format: 'template', template: '   ' }) })).template).toBe(DEFAULT_COMMIT_TEMPLATE)
  })

  it('keeps a summary in a template that forgot it', () => {
    expect(normalizeCommitTemplate('')).toBe(DEFAULT_COMMIT_TEMPLATE)
    expect(normalizeCommitTemplate('JIRA-1\n\n{{body}}')).toBe('{{summary}}\n\nJIRA-1\n\n{{body}}')
    expect(normalizeCommitTemplate('{{summary}}\n\n{{body}}')).toBe('{{summary}}\n\n{{body}}')
  })

  it('describes each format without forcing one on the model', () => {
    expect(commitFormatInstructions({ format: 'conventional', template: '' })).toContain('Conventional Commits')
    const free = commitFormatInstructions({ format: 'free', template: '' })
    expect(free).toContain('plain prose')
    expect(free).not.toContain('Use Conventional Commits')
    const template = commitFormatInstructions({ format: 'template', template: 'Ticket: {{summary}}\n\n{{body}}' })
    expect(template).toContain('Ticket: {{summary}}')
  })

  it('writes the same neutral prompt for Go, Java and a mixed diff', () => {
    for (const files of [
      [{ relativePath: 'internal/app/main.go', diff: '@@ -1 +1 @@\n-a\n+b' }],
      [{ relativePath: 'src/main/java/demo/App.java', diff: '@@ -1 +1 @@\n-a\n+b' }],
      [
        { relativePath: 'orders/main.go', diff: '@@ -1 +1 @@\n-a\n+b' },
        { relativePath: 'billing/App.java', diff: '@@ -1 +1 @@\n-c\n+d' },
      ],
    ]) {
      const prompt = buildCommitMessagePrompt({ branch: 'main', files, symbols: [], format: { format: 'conventional', template: '' } })
      expect(prompt.system).toContain('software project')
      expect(prompt.system).not.toContain('Go project')
      expect(prompt.system).toContain('Conventional Commits')
    }
  })
})
