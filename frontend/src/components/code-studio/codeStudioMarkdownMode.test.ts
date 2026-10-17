import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MARKDOWN_MODE, isMermaidPath, loadMarkdownMode, mermaidAsMarkdown, saveMarkdownMode } from './codeStudioMarkdownMode'

describe('markdown view mode', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) })
  })

  it('opens a markdown file in preview by default', () => {
    expect(DEFAULT_MARKDOWN_MODE).toBe('preview')
    expect(loadMarkdownMode('s1:README.md')).toBe('preview')
  })

  it('remembers the mode per document', () => {
    saveMarkdownMode('s1:README.md', 'editor')
    saveMarkdownMode('s1:docs/A.md', 'split')
    expect(loadMarkdownMode('s1:README.md')).toBe('editor')
    expect(loadMarkdownMode('s1:docs/A.md')).toBe('split')
    expect(loadMarkdownMode('s2:README.md')).toBe('preview')
  })

  it('ignores corrupt or unknown stored values', () => {
    localStorage.setItem('adomnia.codeStudio.markdownModes', '{"a":"sideways","b":3}')
    expect(loadMarkdownMode('a')).toBe('preview')
    localStorage.setItem('adomnia.codeStudio.markdownModes', 'not json')
    expect(loadMarkdownMode('b')).toBe('preview')
  })
})

describe('mermaid files', () => {
  it('recognises .mmd and .mermaid', () => {
    expect(isMermaidPath('docs/flow.mmd')).toBe(true)
    expect(isMermaidPath('FLOW.MERMAID')).toBe(true)
    expect(isMermaidPath('flow.md')).toBe(false)
  })

  it('wraps the diagram in a mermaid fence the markdown renderer understands', () => {
    expect(mermaidAsMarkdown('graph TD\n A-->B')).toBe('```mermaid\ngraph TD\n A-->B\n```\n')
    expect(mermaidAsMarkdown('a ``` b').startsWith('~~~~mermaid')).toBe(true)
  })
})
