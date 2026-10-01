import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(resolve(process.cwd(), 'src/styles/skin-terminal-green.css'), 'utf8')
const entrypoint = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8')
const welcomeSource = readFileSync(resolve(process.cwd(), 'src/components/layout/WelcomePanel.tsx'), 'utf8')
const mascotSource = readFileSync(resolve(process.cwd(), 'src/components/layout/HubMascot.tsx'), 'utf8')
const companionSource = readFileSync(resolve(process.cwd(), 'src/components/assistant/AICompanion.tsx'), 'utf8')
const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
const statusBarSource = readFileSync(resolve(process.cwd(), 'src/components/layout/StatusBar.tsx'), 'utf8')

describe('Terminal Green skin and hub', () => {
  it('loads as a scoped green treatment with a recoloured adOmnia mark', () => {
    expect(entrypoint).toContain("import './styles/skin-terminal-green.css'")
    expect(stylesheet).toContain("[data-skin='terminal-green'] img[data-brand-mark]")
    expect(stylesheet).toContain('hue-rotate(235deg)')
    expect(statusBarSource).toContain("const TERMINAL_GREEN_THEME_ID = 'builtin-terminal-green'")
  })

  it('keeps the hub logo but removes its decorative card and Bug Hunt replay action', () => {
    expect(welcomeSource).toContain('<HubMascot />')
    expect(welcomeSource).toContain("data-hub-card-active={active ? 'true' : undefined}")
    expect(welcomeSource).toContain('onFocusCapture={() => onFocus(card.pose)}')
    expect(welcomeSource).not.toContain('data-hub-polaroid')
    expect(welcomeSource).not.toContain("tr('your local toolbox' as UiMessage)")
    expect(welcomeSource).not.toContain("tr('Replay Bug Hunt')")
    expect(welcomeSource).not.toContain('adomnia:open-bug-hunt')
    expect(welcomeSource).not.toContain('You found the secret.')
  })

  it('renders the Hub mascot from the per-skin a0 key art', () => {
    expect(mascotSource).toContain("import heroDark from './assets/hub/hero-dark-stickers.webp'")
    expect(mascotSource).toContain('data-hub-mascot-scene')
    expect(mascotSource).not.toContain('a0-companion-sprites.png')
  })

  it('opens the verified AI companion from the Hub mascot', () => {
    expect(mascotSource).toContain('isAICompanionAvailable(ai)')
    expect(mascotSource).toContain("open('a0')")
    expect(mascotSource).toContain("tr('Connect AI to use a0')")
    expect(companionSource).toContain('aria-label="AI di a0"')
  })

  it('does not bundle or launch the extracted game from the app or companion', () => {
    for (const source of [appSource, companionSource]) {
      expect(source).not.toContain('BugHuntOverlay')
      expect(source).not.toContain('components/bughunt')
      expect(source).not.toContain('adomnia:open-bug-hunt')
      expect(source).not.toContain('isBugHuntPlayIntent')
    }
  })
})
