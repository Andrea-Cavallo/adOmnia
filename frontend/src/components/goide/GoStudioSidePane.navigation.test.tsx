import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GoIDESession } from '@/lib/goide-api'
vi.mock('@/lib/goide-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))
vi.mock('./GoStudioProjectOverview', () => ({ GoStudioProjectOverview: () => null }))
vi.mock('./GoStudioStructure', () => ({ GoStudioStructure: () => null }))
vi.mock('./GoStudioLineContext', () => ({ GoStudioLineContext: () => null }))
vi.mock('./GoStudioAiHubPanel', () => ({ GoStudioAiHubPanel: () => <div>AI providers</div> }))
vi.mock('./StudioToolControls', () => ({ StudioToolControls: () => null }))
vi.mock('@/stores/goStudioAssistant', async (original) => {
  const actual = await original<typeof import('@/stores/goStudioAssistant')>()
  const store = actual.useGoStudioAssistantStore
  return { ...actual, useGoStudioAssistantStore: Object.assign((select: (state: ReturnType<typeof store.getState>) => unknown) => select(store.getState()), store) }
})
import { GoStudioSidePane } from './GoStudioSidePane'
import { useGoStudioAssistantStore } from '@/stores/goStudioAssistant'
const session = { id: 'navigation' } as GoIDESession

describe('separate Structure and AI navigation', () => {
  it('shows only Structure, Context and Project in the Structure pane', () => {
    useGoStudioAssistantStore.getState().close()
    const html = renderToStaticMarkup(<GoStudioSidePane session={session} document={null} />)
    expect(html.match(/role="tab"/g)).toHaveLength(3)
    expect(html).toContain('Structure')
    expect(html).toContain('Context')
    expect(html).toContain('Project')
    expect(html).not.toContain('AI Assistant')
  })
  it('shows only AI navigation when the assistant is selected', () => {
    useGoStudioAssistantStore.getState().open('claude')
    try {
      const html = renderToStaticMarkup(<GoStudioSidePane session={session} document={null} />)
      expect(html.match(/role="tab"/g)).toHaveLength(1)
      expect(html).toContain('AI providers')
      expect(html).not.toContain('> Context')
      expect(html).not.toContain('> Project')
    } finally {
      useGoStudioAssistantStore.getState().close()
    }
  })
})
