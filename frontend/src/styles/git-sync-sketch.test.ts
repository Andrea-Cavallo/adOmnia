import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(resolve(process.cwd(), 'src/styles/skin-sketch.css'), 'utf8')
const panelSource = readFileSync(resolve(process.cwd(), 'src/components/workspace/GitSyncPanel.tsx'), 'utf8')

describe('Sketch Git Sync cohesion', () => {
  it('renders the Git workspace as continuous rails instead of unrelated cards', () => {
    expect(panelSource).toContain('data-git-sync')
    expect(panelSource).toContain('data-git-toolbar')
    expect(panelSource).toContain('data-git-commit-row')
    expect(panelSource).toContain('data-git-change-row')
    expect(stylesheet).toContain("[data-git-sync] [data-git-commit-row]")
    expect(stylesheet).toContain("[data-git-sync] [data-git-change-row]")
    expect(stylesheet).toContain('border-radius: 0 !important')
  })
})
