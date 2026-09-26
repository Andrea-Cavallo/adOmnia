import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(resolve(process.cwd(), 'src/styles/skin-terminal-green.css'), 'utf8')
const entrypoint = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8')
const welcomeSource = readFileSync(resolve(process.cwd(), 'src/components/layout/WelcomePanel.tsx'), 'utf8')
const mascotSource = readFileSync(resolve(process.cwd(), 'src/components/layout/HubMascot.tsx'), 'utf8')
const companionSource = readFileSync(resolve(process.cwd(), 'src/components/assistant/AICompanion.tsx'), 'utf8')
const statusBarSource = readFileSync(resolve(process.cwd(), 'src/components/layout/StatusBar.tsx'), 'utf8')

describe('Terminal Green skin and hub', () => {
  it('loads as a scoped green treatment with a recoloured adOmnia mark', () => {
    expect(entrypoint).toContain("import './styles/skin-terminal-green.css'")
    expect(stylesheet).toContain("[data-skin='terminal-green'] img[data-brand-mark]")
    expect(stylesheet).toContain('hue-rotate(235deg)')
    expect(statusBarSource).toContain("const TERMINAL_GREEN_THEME_ID = 'builtin-terminal-green'")
  })

  it('keeps the hub logo but removes its decorative card and Bug Hunt replay action', () => {
    expect(welcomeSource).toContain('<FidgetLogo src={appIcon} size={112} />')
    expect(welcomeSource).toContain('<HubMascot target={mascotTarget} />')
    expect(welcomeSource).toContain("data-hub-card-active={active ? 'true' : undefined}")
    expect(welcomeSource).toContain('onFocusCapture={() => onFocus(card.index)}')
    expect(welcomeSource).not.toContain('data-hub-polaroid')
    expect(welcomeSource).not.toContain("tr('your local toolbox' as UiMessage)")
    expect(welcomeSource).not.toContain("tr('Replay Bug Hunt')")
    expect(welcomeSource).not.toContain('adomnia:open-bug-hunt')
    expect(welcomeSource).not.toContain('You found the secret.')
  })

  it('renders the Hub mascot from a dedicated full-body asset', () => {
    expect(mascotSource).toContain("import hubMascot from './assets/a0-hub-mascot.png'")
    expect(mascotSource).toContain("import hubMascot04 from './assets/a0-hub-mascot-04.png'")
    expect(mascotSource).toContain('data-hub-mascot-sprite')
    expect(mascotSource).toContain("data-visible={(lookAt ?? 'rest') === pose.id ? 'true' : undefined}")
    expect(mascotSource).not.toContain('a0-companion-sprites.png')
    expect(mascotSource).not.toContain('data-hub-mascot-arm')
  })

  it('opens the verified AI companion from the Hub mascot', () => {
    expect(mascotSource).toContain('isAICompanionAvailable(ai)')
    expect(mascotSource).toContain("'adomnia:open-ai-companion'")
    expect(mascotSource).toContain("tr('Connect AI to use a0')")
    expect(companionSource).toContain("document.addEventListener('adomnia:open-ai-companion', openFromHub)")
  })
})
