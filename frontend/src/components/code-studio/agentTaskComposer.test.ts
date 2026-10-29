import { describe, expect, it } from 'vitest'
import { Intent } from '@/lib/agent-task-api'
import { agentTaskMessage, agentTaskReceipt, emptyAgentTaskDraft } from './agentTaskComposer'

describe('agent task composer', () => {
  it('separates instructions from files actually attached by the preview', () => {
    const draft = emptyAgentTaskDraft('/project')
    draft.intent = Intent.IntentAnalysis
    draft.objective = 'Explain the parser'
    draft.criteria = ['Name the failure path']
    draft.paths = ['internal/parser/parser.go']
    draft.dependencies = ['Do not change the public API']
    const message = agentTaskMessage(draft)
    expect(message).toContain('Declared project paths (only file contents explicitly shown below were read)')
    expect(message).toContain('Declared dependencies (context only, not attachments)')
    expect(message).toContain('Explain the parser')
  })
  it('creates the receipt from the exact preview metadata', () => {
    const receipt = agentTaskReceipt({ message: 'payload', sources: [
      { kind: 'document', label: 'a.go', bytes: 10, truncated: false, unsaved: true, excluded: false },
      { kind: 'path', label: 'secret', bytes: 0, truncated: false, unsaved: false, excluded: true },
    ], excludedPaths: ['secret'], bytes: 7, truncated: true, includesUnsaved: true })
    expect(receipt).toMatchObject({ bytes: 7, sources: 1, excluded: 1, truncated: true, includesUnsaved: true })
  })
})
