import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FEATURE_REGISTRY, RAIL_CATEGORIES } from '@/lib/featureRegistry'
import {
  ITALIAN_NAVIGATION_MESSAGES,
  ITALIAN_UI_MESSAGES,
  translateNavigation,
  translateUi,
  type UiMessage,
} from '@/lib/uiI18n'

const GUARDED_SURFACES = [
  'src/App.tsx',
  'src/components/layout/Rail.tsx',
  'src/components/layout/CommandPalette.tsx',
  'src/components/layout/MainArea.tsx',
  'src/components/layout/TabBar.tsx',
  'src/components/layout/Sidebar.tsx',
  'src/components/layout/WelcomePanel.tsx',
  'src/components/layout/StatusBar.tsx',
  'src/components/layout/StorageQuotaBanner.tsx',
  'src/components/layout/DropOverlay.tsx',
  'src/components/layout/DropToast.tsx',
  'src/components/layout/Titlebar.tsx',
  'src/components/layout/ErrorBoundary.tsx',
  'src/components/collections/CollectionTree.tsx',
  'src/components/collections/ApiToolsBar.tsx',
  'src/components/environment/EnvBar.tsx',
  'src/components/environment/EnvModal.tsx',
  'src/components/hosts/HostBar.tsx',
  'src/components/hosts/HostModal.tsx',
  'src/components/composer/Composer.tsx',
  'src/components/composer/AuthEditor.tsx',
  'src/components/composer/BodyEditor.tsx',
  'src/components/composer/KVEditor.tsx',
  'src/components/composer/RequestValidationDialog.tsx',
  'src/components/composer/ScriptsEditor.tsx',
  'src/components/response/ResponsePanel.tsx',
  'src/components/response/DiffView.tsx',
  'src/components/ui/confirm-dialog.tsx',
  'src/components/ui/prompt.tsx',
  'src/components/ui/JsonGraph.tsx',
  'src/components/ui/VarHighlightInput.tsx',
] as const

const TECHNICAL_ATTRIBUTE_VALUES = new Set([
  'https://api.your-domain.com/v1/users or {{base_url}}/health',
  'https://api.your-domain.com/v1/users',
  'ms',
  'eyJhbGciOi…',
  'https://issuer.example.com',
  'https://auth.your-domain.com/oauth/token',
  'openid profile',
  'https://auth.your-domain.com/oauth/authorize',
  'AKIA...',
  'us-east-1',
  'execute-api',
  'optional',
  'VARIABLE',
  'api.example.com',
  '192.168.1.50',
  'access_token',
])

const TECHNICAL_JSX_TEXT = new Set([
  'ESC', 'Up/Down', 'Enter', 'Ctrl/Cmd + K', 'Ctrl/Cmd + K or P', 'Ctrl+N', 'LOG', 'S', 'Ctrl', '+',
  'adOmnia paratus.', 'commit · branch · diff · merge · stash · push', 'main', 'local', 'Diff',
  'PSD2', 'Ctrl/Cmd + F', 'Ctrl/Cmd&nbsp;+&nbsp;F', 'host:port', 'api.example.com:443', 'http://127.0.0.1', 'n', 'p', 'Esc', '\\n',
  'ms', 'vault', '+', '−',
  'Mock', 'Proxy', 'Aa', 'Ab',
])

function normalized(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

describe('stable UI localization', () => {
  it('renders deterministic English and Italian messages with interpolation and fallback', () => {
    expect(translateUi('Send', 'en')).toBe('Send')
    expect(translateUi('Send', 'it')).toBe('Invia')
    expect(translateUi('{count} variables detected', 'it', { count: 3 })).toBe('3 variabili rilevate')
    expect(translateUi('Unregistered message' as UiMessage, 'it')).toBe('Unregistered message')
    expect(translateNavigation('API Workspace', 'it')).toBe('Area di lavoro API')
    expect(translateNavigation('Unregistered panel', 'it')).toBe('Unregistered panel')
  })

  it('keeps every registered Italian UI message non-empty', () => {
    expect(Object.keys(ITALIAN_UI_MESSAGES).length).toBeGreaterThan(250)
    for (const [source, translated] of Object.entries(ITALIAN_UI_MESSAGES)) {
      expect(source.trim(), source).not.toBe('')
      expect(translated.trim(), source).not.toBe('')
    }
  })

  it('registers every feature, category, and rail group label', () => {
    const labels = new Set<string>()
    for (const feature of FEATURE_REGISTRY) {
      labels.add(feature.title)
      if (feature.railLabel) labels.add(feature.railLabel)
      labels.add(feature.group)
    }
    for (const category of RAIL_CATEGORIES) {
      labels.add(category.label)
      for (const group of category.groups) labels.add(group.title)
    }
    for (const label of labels) {
      expect(ITALIAN_NAVIGATION_MESSAGES, `Missing navigation translation: ${label}`).toHaveProperty(label)
    }
  })

  it('blocks new unregistered literal labels in the stable shell and API workflow', () => {
    const violations: string[] = []
    for (const relativePath of GUARDED_SURFACES) {
      const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8')
      for (const opening of source.matchAll(/<[a-z][\w-]*\b[^<>]*?>/g)) {
        for (const attribute of opening[0].matchAll(/\b(title|aria-label|placeholder)="([^"]*[A-Za-z][^"]*)"/g)) {
          const value = normalized(attribute[2])
          if (!TECHNICAL_ATTRIBUTE_VALUES.has(value)) {
            violations.push(`${relativePath}: raw ${attribute[1]}="${value}"`)
          }
        }
      }
      for (const match of source.matchAll(/<(?:button|span|div|p|kbd|label|h[1-6]|option)\b[^>]*>\s*([^<>{}]*[A-Za-z][^<>{}]*)\s*</g)) {
        const value = normalized(match[1])
        if (value && !TECHNICAL_JSX_TEXT.has(value)) violations.push(`${relativePath}: raw JSX text "${value}"`)
      }
    }
    expect(violations).toEqual([])
  })
})
