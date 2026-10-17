import { beforeEach, describe, expect, it } from 'vitest'
import { useCodeStudioAssistantStore } from './codeStudioAssistant'

describe('Code Studio assistant pane', () => {
  beforeEach(() => useCodeStudioAssistantStore.setState({ pane: null }))

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
})
