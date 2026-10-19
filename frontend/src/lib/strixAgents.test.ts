import { describe, expect, it } from 'vitest'
import type { Environment } from '@/lib/types'
import type { AppSettings } from '@/stores/settings'
import { strixAgentOptions } from './strixAgents'

const environment = (id: string, name: string, variables: Array<[string, string, boolean?]>) => ({
  id, name, variables: variables.map(([key, value, enabled]) => ({ key, value, enabled: enabled ?? true })),
}) as unknown as Environment

const ai = { provider: 'openai', model: 'gpt-x', modelCatalogs: { anthropic: { checkedAt: '', models: [{ id: 'claude-y', name: 'Claude Y' }] } } } as unknown as AppSettings['ai']

describe('strixAgentOptions', () => {
  it('lists one agent per provider that has a key in Environments, with a suggested model', () => {
    const options = strixAgentOptions([
      environment('a', 'Prod', [['ANTHROPIC_API_KEY', 'sk-ant'], ['UNRELATED', 'x']]),
      environment('b', 'Dev', [['OPENAI_API_KEY', 'sk-oa'], ['GEMINI_API_KEY', 'g', false]]),
    ], 'a', ai)
    expect(options.map((item) => item.provider)).toEqual(['anthropic', 'openai'])
    expect(options[0]).toMatchObject({ suggestedModel: 'claude-y', credential: { key: 'ANTHROPIC_API_KEY', environmentName: 'Prod' } })
    expect(options[1].suggestedModel).toBe('gpt-x')
  })
  it('returns nothing when no environment holds a provider key', () => {
    expect(strixAgentOptions([environment('a', 'Prod', [['FOO', 'bar']])], 'a', ai)).toEqual([])
  })
})
