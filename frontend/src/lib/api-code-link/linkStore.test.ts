import { beforeEach, describe, expect, it } from 'vitest'
import { useApiCodeLinkStore } from './linkStore'
import type { ApiCodeLink } from './types'

const link = (routeId: string, requestTabId?: string): ApiCodeLink => ({
  sessionId: 'go-a',
  routeId,
  method: 'GET',
  path: '/users/{id}',
  file: 'internal/api/user_handler.go',
  line: 31,
  handler: 'UserHandler.GetUser',
  requestTabId,
  origin: 'request',
  createdAt: 1,
})

describe('api ↔ code link', () => {
  beforeEach(() => useApiCodeLinkStore.setState({ link: null, history: [], stale: false, chooser: null }))

  it('keeps one source of truth and the navigation history', () => {
    useApiCodeLinkStore.getState().setLink(link('route:GET /users/{id}', 'tab-1'))
    useApiCodeLinkStore.getState().setLink(link('route:GET /orders'))
    expect(useApiCodeLinkStore.getState().link?.routeId).toBe('route:GET /orders')
    expect(useApiCodeLinkStore.getState().history.map((entry) => entry.routeId)).toEqual(['route:GET /orders', 'route:GET /users/{id}'])
  })

  it('does not duplicate the same relationship in history', () => {
    useApiCodeLinkStore.getState().setLink(link('route:GET /users/{id}'))
    useApiCodeLinkStore.getState().setLink(link('route:GET /users/{id}'))
    expect(useApiCodeLinkStore.getState().history).toHaveLength(1)
  })

  it('marks a stale mapping instead of dropping the open state', () => {
    useApiCodeLinkStore.getState().setLink(link('route:GET /users/{id}', 'tab-1'))
    useApiCodeLinkStore.getState().markStale(true)
    expect(useApiCodeLinkStore.getState().link?.requestTabId).toBe('tab-1')
    expect(useApiCodeLinkStore.getState().stale).toBe(true)
    // Unlinking a closed tab keeps the stale warning for the same relationship.
    useApiCodeLinkStore.getState().setLink(link('route:GET /users/{id}'))
    expect(useApiCodeLinkStore.getState().stale).toBe(true)
    // A different endpoint is a new relationship and starts clean.
    useApiCodeLinkStore.getState().setLink(link('route:GET /orders'))
    expect(useApiCodeLinkStore.getState().stale).toBe(false)
  })

  it('holds the chooser until one candidate is picked', () => {
    const choices = [{ id: 'a', label: 'GET /a', detail: 'A', run: () => undefined }]
    useApiCodeLinkStore.getState().openChooser({ title: 'Pick one', choices })
    expect(useApiCodeLinkStore.getState().chooser?.choices).toHaveLength(1)
    useApiCodeLinkStore.getState().closeChooser()
    expect(useApiCodeLinkStore.getState().chooser).toBeNull()
  })
})
