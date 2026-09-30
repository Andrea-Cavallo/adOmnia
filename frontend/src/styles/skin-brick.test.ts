import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(resolve(process.cwd(), 'src/styles/skin-brick.css'), 'utf8')
const entrypoint = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8')
const statusBarSource = readFileSync(resolve(process.cwd(), 'src/components/layout/StatusBar.tsx'), 'utf8')
const hubSource = readFileSync(resolve(process.cwd(), 'src/components/layout/HubMascot.tsx'), 'utf8')
const hubStyles = readFileSync(resolve(process.cwd(), 'src/components/layout/WelcomePanel.css'), 'utf8')

describe('Brick Workshop skin', () => {
  it('loads as a scoped treatment instead of changing the default theme', () => {
    expect(entrypoint).toContain("import './styles/skin-brick.css'")
    expect(stylesheet).toContain("[data-skin='brick'] #root")
    expect(stylesheet).toContain('--brick-stud')
  })

  it('keeps the API workspace tactile while preserving visible active states', () => {
    expect(stylesheet).toContain("[data-collection-request][data-request-active='true']")
    expect(stylesheet).toContain("[data-skin='brick'] .glass-action")
    expect(stylesheet).toContain("[data-skin='brick'] [data-editor='json']")
    expect(stylesheet).toContain('prefers-reduced-motion: reduce')
    expect(stylesheet).toContain("[data-skin='brick'] [data-app-rail]")
    expect(stylesheet).toContain("[data-skin='brick'] [data-tab-id][style]")
    expect(stylesheet).toContain("[data-skin='brick'] [data-workspace-panel-header='true']")
    expect(stylesheet).toContain("[data-skin='brick'] [data-app-titlebar]")
    expect(stylesheet).toContain("[data-skin='brick'] [data-workspace-sidebar]")
    expect(stylesheet).toContain("[data-skin='brick'] [data-request-workspace]")
  })

  it('has a dedicated brick-built Hub instead of falling back to dark artwork', () => {
    expect(hubSource).toContain("data-hub-art=\"brick\"")
    expect(hubSource).toContain("hero-brick.webp")
    expect(hubStyles).toContain("html[data-skin='brick'] [data-hub-art='brick']")
    expect(hubStyles).toContain("html[data-skin='brick'] [data-hub-card]")
  })

  it('exposes the skin through the quick appearance controls', () => {
    expect(statusBarSource).toContain("const BRICK_THEME_ID = 'builtin-brick-workshop'")
    expect(statusBarSource).toContain("mode: 'brick' as const")
  })
})
