import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/ui/ContextMenu', () => ({ ContextMenu: () => null }))
vi.mock('@/stores/copilot', () => ({ useCopilotStore: Object.assign(() => null, { getState: () => ({}) }) }))

const { copilotAccountLabel, copilotMenuItems, copilotPresentation } = await import('./GoStudioCopilotStatus')

const work = { id: 'work', name: 'Work', host: 'company.ghe.com', type: 'ghe.com' }
const status = (state: string, extra: Record<string, unknown> = {}) => ({ state, busy: false, profile: work, binary: { path: '', version: '', source: '' }, inlineCompletion: true, restarts: 0, ...extra }) as never
const settings = (enabled: boolean) => ({ enabled, inlineCompletion: true }) as never
const ids = (items: { id: string }[]) => items.map((item) => item.id)

describe('Copilot status bar', () => {
  it('always shows the GitHub host, never just "signed in"', () => {
    expect(copilotAccountLabel(status('ready', { user: 'andrea' }))).toBe('andrea · company.ghe.com')
    expect(copilotAccountLabel(status('signed-out'))).toBe('Work — company.ghe.com')
  })

  it('maps each state to a visible label', () => {
    expect(copilotPresentation(status('ready'), null)).toMatchObject({ label: 'Copilot', tone: 'text-success' })
    expect(copilotPresentation(status('ready', { busy: true }), null).spinning).toBe(true)
    expect(copilotPresentation(status('installing'), 42).label).toBe('Installing Copilot 42%')
    expect(copilotPresentation(status('signed-out'), null).tone).toBe('text-warning')
    expect(copilotPresentation(null, null).label).toBe('Copilot off')
  })

  it('offers the next useful action for the state', () => {
    expect(ids(copilotMenuItems(status('disabled'), settings(false)))).toContain('enable')
    expect(ids(copilotMenuItems(status('not-installed'), settings(true)))).toContain('install')
    expect(copilotMenuItems(status('signed-out'), settings(true)).find((item) => item.id === 'signIn')?.label).toBe('Sign in to company.ghe.com…')
    const ready = ids(copilotMenuItems(status('ready', { user: 'andrea' }), settings(true)))
    expect(ready).toEqual(expect.arrayContaining(['completions', 'signOut', 'restart', 'settings']))
    expect(ready).not.toContain('signIn')
  })
})
