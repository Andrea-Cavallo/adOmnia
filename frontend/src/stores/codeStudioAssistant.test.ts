import { beforeEach, describe, expect, it } from 'vitest'
import { isChatPane, useCodeStudioAssistantStore } from './codeStudioAssistant'

describe('Code Studio assistant pane', () => {
  beforeEach(() => useCodeStudioAssistantStore.setState({ pane: null, tasksOpen: false }))

  it.each(['pi', 'local'] as const)('remembers %s when returning from tasks', provider => {
    useCodeStudioAssistantStore.getState().open(provider)
    useCodeStudioAssistantStore.getState().showTasks()
    useCodeStudioAssistantStore.getState().close()
    expect(useCodeStudioAssistantStore.getState().lastProvider).toBe(provider)
    expect(isChatPane(provider)).toBe(true)
  })

  it('keeps Copilot and milk mutually exclusive in the right column', () => {
    useCodeStudioAssistantStore.getState().open('milk')
    expect(useCodeStudioAssistantStore.getState().pane).toBe('milk')
    useCodeStudioAssistantStore.getState().open('copilot')
    expect(useCodeStudioAssistantStore.getState().pane).toBe('copilot')
  })

  it('closes the selected assistant when its stripe is toggled', () => {
    useCodeStudioAssistantStore.getState().toggle('milk')
    useCodeStudioAssistantStore.getState().toggle('milk')
    expect(useCodeStudioAssistantStore.getState().pane).toBeNull()
  })

  it('keeps Tasks as a peer tab and never reopens it by surprise', () => {
    useCodeStudioAssistantStore.getState().showTasks()
    expect(useCodeStudioAssistantStore.getState().tasksOpen).toBe(true)
    useCodeStudioAssistantStore.getState().open('milk')
    expect(useCodeStudioAssistantStore.getState().tasksOpen).toBe(false)
    expect(useCodeStudioAssistantStore.getState().pane).toBe('milk')
    useCodeStudioAssistantStore.getState().showTasks()
    useCodeStudioAssistantStore.getState().close()
    expect(useCodeStudioAssistantStore.getState().tasksOpen).toBe(false)
  })
})
