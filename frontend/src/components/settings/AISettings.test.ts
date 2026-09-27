import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/components/settings/AISettings.tsx'), 'utf8')

describe('AI Engine settings layout', () => {
  it('uses the provider master-detail layout and includes DeepSeek', () => {
    expect(source).toContain('data-ai-settings')
    expect(source).toContain("value: 'deepseek'")
    expect(source).toContain('grid-cols-[290px_minmax(0,1fr)]')
    expect(source).toContain('Active configuration')
    expect(source).toContain('Save changes')
  })

  it('explains the automatic credential chain without exposing values', () => {
    expect(source).toContain('process variables → active adOmnia Environment')
    expect(source).toContain('standard `.env` files')
  })

  it('offers an explicit agent-actions permission', () => {
    expect(source).toContain('Agent actions')
    expect(source).toContain('Allow a0 to create and update workspace items')
    expect(source).toContain('workspaceActionsEnabled')
  })
})
