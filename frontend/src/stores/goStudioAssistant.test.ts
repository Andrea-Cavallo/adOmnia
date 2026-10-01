import { beforeEach, describe, expect, it } from 'vitest'
import { useGoStudioAssistantStore } from './goStudioAssistant'

describe('Go Studio assistant pane', () => {
  beforeEach(() => useGoStudioAssistantStore.setState({ pane: null }))

  it('keeps Copilot and a0 mutually exclusive in the right column', () => {
    useGoStudioAssistantStore.getState().open('a0')
    expect(useGoStudioAssistantStore.getState().pane).toBe('a0')
    useGoStudioAssistantStore.getState().open('copilot')
    expect(useGoStudioAssistantStore.getState().pane).toBe('copilot')
  })

  it('closes the selected assistant when its stripe is toggled', () => {
    useGoStudioAssistantStore.getState().toggle('a0')
    useGoStudioAssistantStore.getState().toggle('a0')
    expect(useGoStudioAssistantStore.getState().pane).toBeNull()
  })
})
