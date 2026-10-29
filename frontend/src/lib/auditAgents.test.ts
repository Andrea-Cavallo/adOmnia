import { describe, expect, it } from 'vitest'
import { auditAgentOption, auditTimeoutMinutes } from './auditAgents'

describe('auditAgents', () => {
  it('maps coding agents to their task runtime and refuses plain chats', () => {
    expect(auditAgentOption('pi').agent).toBe('pi')
    expect(auditAgentOption('claude').agent).toBe('claude')
    expect(auditAgentOption('copilot').agent).toBeNull()
    expect(auditAgentOption('local').unsupported).toBeTruthy()
  })

  it('keeps every profile within the backend task limit', () => {
    for (const profile of ['quick', 'standard', 'deep'] as const) expect(auditTimeoutMinutes(profile)).toBeLessThanOrEqual(240)
  })
})
