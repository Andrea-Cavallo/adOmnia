import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Go Studio right assistant column', () => {
  it('hosts both Copilot and a0 as closable tool-window choices', () => {
    const pane = source('src/components/goide/GoStudioSidePane.tsx')
    const stripe = source('src/components/goide/GoStudioToolStripes.tsx')
    expect(pane).toContain("label: 'Copilot'")
    expect(pane).toContain("label: 'a0'")
    expect(stripe).toContain("toggleAssistant('copilot')")
    expect(stripe).toContain("toggleAssistant('a0')")
  })

  it('removes the old global floating assistant', () => {
    expect(source('src/App.tsx')).not.toContain('AICompanionHost')
    const companion = source('src/components/assistant/AICompanion.tsx')
    expect(companion).not.toContain('fixed bottom-5 right-4')
    expect(companion).not.toContain('a0-companion-launcher')
  })
})
