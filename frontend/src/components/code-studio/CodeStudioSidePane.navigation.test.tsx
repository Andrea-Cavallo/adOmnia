import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GoIDESession } from '@/lib/code-studio-api'
vi.mock('@/lib/code-studio-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))
vi.mock('./CodeStudioProjectOverview', () => ({ CodeStudioProjectOverview: () => null }))
vi.mock('./CodeStudioStructure', () => ({ CodeStudioStructure: () => null }))
vi.mock('./CodeStudioLineContext', () => ({ CodeStudioLineContext: () => null }))
vi.mock('./CodeStudioAiHubPanel', () => ({ CodeStudioAiHubPanel: () => <div>AI providers</div> }))
vi.mock('./StudioToolControls', () => ({ StudioToolControls: () => null }))
vi.mock('@/stores/codeStudioAssistant', async (original) => {
  const actual = await original<typeof import('@/stores/codeStudioAssistant')>()
  const store = actual.useCodeStudioAssistantStore
  return { ...actual, useCodeStudioAssistantStore: Object.assign((select: (state: ReturnType<typeof store.getState>) => unknown) => select(store.getState()), store) }
})
import { CodeStudioSidePane } from './CodeStudioSidePane'
import { useCodeStudioAssistantStore } from '@/stores/codeStudioAssistant'

function sessionWith(units: Array<{ language: string; kind: string; manifest: string }>): GoIDESession {
  const rootPath = 'C:/work/app'
  return {
    id: 'navigation',
    project: {
      rootPath,
      realPath: rootPath,
      units: units.map((unit) => ({ ...unit, root: rootPath, name: unit.manifest.slice(unit.manifest.lastIndexOf('/') + 1) })),
    },
  } as unknown as GoIDESession
}

const session = sessionWith([{ language: 'go', kind: 'module', manifest: 'C:/work/app/go.mod' }])

describe('separate Structure and AI navigation', () => {
  it('shows only Structure, Context and Project in the Structure pane', () => {
    useCodeStudioAssistantStore.getState().close()
    const html = renderToStaticMarkup(<CodeStudioSidePane session={session} document={null} />)
    expect(html.match(/role="tab"/g)).toHaveLength(3)
    expect(html).toContain('Structure')
    expect(html).toContain('Context')
    expect(html).toContain('Project')
    expect(html).not.toContain('AI Assistant')
  })
  it('shows only AI navigation when the assistant is selected', () => {
    useCodeStudioAssistantStore.getState().open('claude')
    try {
      const html = renderToStaticMarkup(<CodeStudioSidePane session={session} document={null} />)
      expect(html.match(/role="tab"/g)).toHaveLength(1)
      expect(html).toContain('AI providers')
      expect(html).not.toContain('> Context')
      expect(html).not.toContain('> Project')
    } finally {
      useCodeStudioAssistantStore.getState().close()
    }
  })
  it('hides Context in a Java project: it explains Go context.Context', () => {
    useCodeStudioAssistantStore.getState().close()
    const java = sessionWith([{ language: 'java', kind: 'maven', manifest: 'C:/work/app/pom.xml' }])
    const html = renderToStaticMarkup(<CodeStudioSidePane session={java} document={null} />)
    expect(html.match(/role="tab"/g)).toHaveLength(2)
    expect(html).toContain('Structure')
    expect(html).toContain('Project')
    expect(html).not.toContain('Context')
  })
})
