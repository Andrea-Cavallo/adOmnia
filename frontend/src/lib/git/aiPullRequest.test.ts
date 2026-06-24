import { describe, expect, it } from 'vitest'
import { parsePullRequestDraft } from './aiPullRequest'

describe('parsePullRequestDraft', () => {
  it('parses fenced JSON', () => {
    expect(parsePullRequestDraft('```json\n{"title":"Add Git accounts","body":"## Summary\\nDone"}\n```')).toEqual({
      title: 'Add Git accounts', body: '## Summary\nDone',
    })
  })

  it('keeps a readable text fallback', () => {
    expect(parsePullRequestDraft('# Fix terminal\n\nHandles command failures.')).toEqual({ title: 'Fix terminal', body: 'Handles command failures.' })
  })
})
