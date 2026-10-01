import type { GoIDEWorkspaceSymbol } from '@/lib/goide-lsp-api'
import type { GoStudioGoRunTarget } from './goStudioRunTargets'

const TEST_NAME = /^(Test|Benchmark|Fuzz|Example)(?![a-z])/

/** Un simbolo di workspace che è un test, benchmark, fuzz o example eseguibile, come target del ▶ del gutter. */
export function testTargetFromSymbol(symbol: GoIDEWorkspaceSymbol): GoStudioGoRunTarget | null {
  const path = (symbol.location.relativePath || '').replace(/\\/g, '/')
  const match = TEST_NAME.exec(symbol.name)
  if (!match || !path.endsWith('_test.go') || symbol.container) return null
  const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const kind = match[1] === 'Benchmark' ? 'benchmark' : 'test'
  return { line: symbol.location.range.startLine, kind, name: symbol.name, packagePath: directory ? `./${directory}` : '.' }
}

/** Testo cercabile di una scorciatoia: "Ctrl+Shift+F" trova anche "ctrl shift f" e "ctrl+shift+f". */
export function bindingSearchText(binding: string): string {
  return binding ? `${binding} ${binding.replace(/\+/g, ' ')}` : ''
}

export type GoStudioSettingsSection = 'general' | 'appearance' | 'requests' | 'proxy' | 'mock' | 'vault' | 'editor' | 'features' | 'workspace' | 'privacy' | 'shortcuts' | 'ai' | 'themes' | 'plugins'

export interface GoStudioSettingEntry {
  label: string
  section: GoStudioSettingsSection
  keywords: string
}

/** Singole impostazioni di adOmnia raggiungibili dalla ricerca: aprono la sezione che le contiene. */
export const SETTINGS_INDEX: readonly GoStudioSettingEntry[] = [
  { label: 'Startup behavior', section: 'general', keywords: 'startup resume fixed open on launch' },
  { label: 'Default tool on startup', section: 'general', keywords: 'rail default panel startup' },
  { label: 'Language', section: 'appearance', keywords: 'language italian english locale' },
  { label: 'Theme', section: 'appearance', keywords: 'theme dark light skin colors' },
  { label: 'Density', section: 'appearance', keywords: 'density compact comfortable spacious' },
  { label: 'UI font', section: 'appearance', keywords: 'font typeface ui' },
  { label: 'Font size', section: 'appearance', keywords: 'font size small medium large zoom' },
  { label: 'Window titlebar', section: 'appearance', keywords: 'window titlebar chrome frameless system app' },
  { label: 'Themes and skins', section: 'themes', keywords: 'themes skins import export palette tokens' },
  { label: 'Request timeout', section: 'requests', keywords: 'timeout request http' },
  { label: 'Follow redirects', section: 'requests', keywords: 'redirects follow http' },
  { label: 'SSL certificate verification', section: 'requests', keywords: 'ssl tls certificate verify insecure' },
  { label: 'Interceptor proxy port', section: 'proxy', keywords: 'proxy interceptor port https ca' },
  { label: 'Mock server port', section: 'mock', keywords: 'mock server port cors' },
  { label: 'Lock vault on minimize', section: 'vault', keywords: 'vault lock minimize secrets' },
  { label: 'Vault auto-lock', section: 'vault', keywords: 'vault auto lock timeout secrets' },
  { label: 'Code editor', section: 'editor', keywords: 'editor font tab size word wrap minimap' },
  { label: 'Feature surface', section: 'features', keywords: 'features advanced lab experimental rail visibility' },
  { label: 'Workspace import / export', section: 'workspace', keywords: 'workspace import export backup .adomnia' },
  { label: 'Privacy and local data', section: 'privacy', keywords: 'privacy history clear local data storage' },
  { label: 'Keyboard shortcuts', section: 'shortcuts', keywords: 'keyboard shortcuts keymap bindings' },
  { label: 'AI provider and model', section: 'ai', keywords: 'ai provider model openai anthropic gemini ollama api key' },
  { label: 'Plugins', section: 'plugins', keywords: 'plugins extensions install permissions' },
]

const RECENT_KEY = 'adomnia.goide.recentCommands'
const RECENT_LIMIT = 8

export function readRecentCommands(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, RECENT_LIMIT) : []
  } catch {
    return []
  }
}

/** Il comando appena eseguito va in cima, senza duplicati. */
export function rememberCommand(id: string): string[] {
  const next = [id, ...readRecentCommands().filter((item) => item !== id)].slice(0, RECENT_LIMIT)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* solo locale */ }
  return next
}
