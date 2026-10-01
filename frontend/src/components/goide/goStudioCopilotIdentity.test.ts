import { describe, expect, it } from 'vitest'
import { COPILOT_MODEL_MANAGED, copilotChatIdentity, copilotModelLabel } from './goStudioCopilotIdentity'

const personal = { id: 'personal', name: 'Personal', host: 'github.com', type: 'github.com' }
const cloud = { id: 'work', name: 'Work', host: 'company.ghe.com', type: 'ghe.com' }
const server = { id: 'bank', name: 'Bank', host: 'github.company.com', type: 'ghes' }
const status = (state: string, profile: object, extra: Record<string, unknown> = {}) =>
  ({ state, busy: false, profile, binary: { path: '', version: '', source: '' }, inlineCompletion: true, restarts: 0, ...extra }) as never
const settings = (extra: Record<string, unknown> = {}) =>
  ({ enabled: true, inlineCompletion: true, activeProfileId: 'personal', profiles: [personal, cloud, server], workspaceProfiles: {}, ...extra }) as never

describe('Copilot chat identity', () => {
  it('shows GitHub Copilot on github.com with the signed-in login', () => {
    const identity = copilotChatIdentity({ status: status('ready', personal, { user: 'andrea' }), settings: settings(), root: '/src/app', model: 'gpt-4.1' })
    expect(identity).toMatchObject({ provider: 'GitHub Copilot', host: 'github.com', account: 'andrea', model: 'Model: gpt-4.1', deployment: null, configuredOnly: false })
  })

  it('shows GitHub Enterprise for ghe.com and GHES hosts', () => {
    expect(copilotChatIdentity({ status: status('ready', cloud), settings: null, root: null })).toMatchObject({ provider: 'GitHub Enterprise', host: 'company.ghe.com', deployment: 'Enterprise Cloud' })
    expect(copilotChatIdentity({ status: status('signed-out', server), settings: null, root: null })).toMatchObject({ provider: 'GitHub Enterprise', host: 'github.company.com', deployment: 'Enterprise Server', account: null })
  })

  it('never invents a model', () => {
    expect(copilotChatIdentity({ status: status('ready', personal), settings: null, root: null }).model).toBe(COPILOT_MODEL_MANAGED)
    expect(COPILOT_MODEL_MANAGED).toBe('Model: managed by GitHub Copilot')
    expect(copilotModelLabel('  ')).toBe(COPILOT_MODEL_MANAGED)
    expect(copilotModelLabel('auto')).toBe('Model: auto (selected by GitHub Copilot)')
  })

  it('falls back to the profile configured for the project while Copilot is off', () => {
    const identity = copilotChatIdentity({ status: status('disabled', personal), settings: settings({ workspaceProfiles: { '/src/bank': 'bank' } }), root: '/src/bank' })
    expect(identity).toMatchObject({ provider: 'GitHub Enterprise', host: 'github.company.com', configuredOnly: true })
    expect(copilotChatIdentity({ status: null, settings: settings({ activeProfileId: 'work' }), root: '/other' }).host).toBe('company.ghe.com')
  })

  it('omits provider and host when nothing is known', () => {
    expect(copilotChatIdentity({ status: null, settings: null, root: null })).toMatchObject({ provider: null, host: null, account: null, model: COPILOT_MODEL_MANAGED })
  })
})
