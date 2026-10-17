import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Code Studio right assistant column', () => {
  it('hosts Copilot, milk and Claude as one AI hub with per-provider status', () => {
    const pane = source('src/components/code-studio/CodeStudioSidePane.tsx')
    const stripe = source('src/components/code-studio/CodeStudioToolStripes.tsx')
    const hub = source('src/components/code-studio/CodeStudioAiHubPanel.tsx')
    // Un solo tab e un solo bottone al posto dei tre: la scelta vive in lastProvider.
    expect(pane).toContain("label: 'AI Assistant'")
    expect(pane).not.toContain("label: 'Copilot'")
    expect(pane).not.toContain("label: 'milk'")
    expect(pane).toContain('<CodeStudioAiHubPanel')
    expect(stripe).toContain('toggleAssistant(lastProvider)')
    expect(stripe).not.toContain("toggleAssistant('copilot')")
    expect(stripe).not.toContain("toggleAssistant('milk')")
    expect(stripe).not.toContain("toggleAssistant('claude')")
    // Le chat restano i componenti di sempre, montate come figli della hub.
    expect(hub).toContain('CodeStudioCopilotChat')
    expect(hub).toContain('CodeStudioMilkChat')
    expect(hub).toContain('CodeStudioClaudeChat')
  })

  it('removes the old global floating assistant', () => {
    expect(source('src/App.tsx')).not.toContain('AICompanionHost')
    const companion = source('src/components/assistant/AICompanion.tsx')
    expect(companion).not.toContain('fixed bottom-5 right-4')
    expect(companion).not.toContain('a0-companion-launcher')
  })
})
