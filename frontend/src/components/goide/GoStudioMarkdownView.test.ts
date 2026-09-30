import { describe, expect, it } from 'vitest'
import { resolveMarkdownLink } from './GoStudioMarkdownView'

describe('resolveMarkdownLink', () => {
  it('resolves relative links against the current file', () => {
    expect(resolveMarkdownLink('README.md', 'docs/BUILD.md')).toBe('docs/BUILD.md')
    expect(resolveMarkdownLink('docs/a/B.md', '../C.md#setup')).toBe('docs/C.md')
    expect(resolveMarkdownLink('docs/B.md', 'adomnia-md:Notes')).toBe('docs/Notes.md')
    expect(resolveMarkdownLink('docs/B.md', 'my%20file.md')).toBe('docs/my file.md')
  })
  it('refuses links that escape the project', () => {
    expect(resolveMarkdownLink('README.md', '../outside.md')).toBeNull()
    expect(resolveMarkdownLink('README.md', '#anchor')).toBeNull()
  })
})
