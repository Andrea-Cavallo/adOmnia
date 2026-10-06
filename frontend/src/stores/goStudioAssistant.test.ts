import { beforeEach, describe, expect, it } from 'vitest'
import { useGoStudioAssistantStore } from './goStudioAssistant'

describe('Go Studio assistant pane', () => {
  beforeEach(() => useGoStudioAssistantStore.setState({ pane: null }))

  it('keeps Copilot and milk mutually exclusive in the right column', () => {
    useGoStudioAssistantStore.getState().open('milk')
    expect(useGoStudioAssistantStore.getState().pane).toBe('milk')
    useGoStudioAssistantStore.getState().open('copilot')
    expect(useGoStudioAssistantStore.getState().pane).toBe('copilot')
  })

  it('closes the selected assistant when its stripe is toggled', () => {
    useGoStudioAssistantStore.getState().toggle('milk')
    useGoStudioAssistantStore.getState().toggle('milk')
    expect(useGoStudioAssistantStore.getState().pane).toBeNull()
  })
})
