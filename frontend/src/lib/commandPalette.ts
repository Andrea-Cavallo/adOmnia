import type { RailItem } from '@/stores/app'
import { COMMAND_PALETTE_PANEL_FEATURES } from '@/lib/featureRegistry'

export interface PalettePanel {
  id: RailItem
  title: string
  group: string
  keywords: string
}

export const COMMAND_PALETTE_PANELS: PalettePanel[] = COMMAND_PALETTE_PANEL_FEATURES.map((feature) => ({
  id: feature.id,
  title: feature.title,
  group: feature.group,
  keywords: feature.keywords,
}))

// Deep links jump straight into a panel's sub-tab via a CustomEvent the panel
// listens for. Add an entry here + a listener in the panel to make any
// sub-feature searchable by name.
export interface PaletteDeepLink {
  rail: RailItem
  event: string
  detail: Record<string, unknown>
  title: string
  group: string
  keywords: string
}

export const COMMAND_PALETTE_DEEP_LINKS: PaletteDeepLink[] = [
  { rail: 'browser', event: 'adomnia:browser-tab', detail: { tab: 'nettools', nettoolsTab: 'cors' }, title: 'CORS Test', group: 'Debugging', keywords: 'cors preflight options origin access-control strict cross-origin browser' },
  { rail: 'browser', event: 'adomnia:browser-tab', detail: { tab: 'nettools', nettoolsTab: 'dns' }, title: 'DNS Lookup', group: 'Debugging', keywords: 'dns lookup a aaaa mx txt ns resolve record' },
  { rail: 'browser', event: 'adomnia:browser-tab', detail: { tab: 'nettools', nettoolsTab: 'trace' }, title: 'DNS Trace', group: 'Debugging', keywords: 'dns trace delegation authoritative' },
  { rail: 'browser', event: 'adomnia:browser-tab', detail: { tab: 'nettools', nettoolsTab: 'compare' }, title: 'DNS Compare', group: 'Debugging', keywords: 'dns compare resolver diff' },
  { rail: 'browser', event: 'adomnia:browser-tab', detail: { tab: 'nettools', nettoolsTab: 'cache' }, title: 'DNS Cache', group: 'Debugging', keywords: 'dns cache clear flush' },
  { rail: 'browser', event: 'adomnia:browser-tab', detail: { tab: 'nettools', nettoolsTab: 'portscan' }, title: 'Port Scan', group: 'Debugging', keywords: 'port scan open ports tcp' },

  // Browser Debug tabs
  { rail: 'browser', event: 'adomnia:browser-tab', detail: { tab: 'network' }, title: 'Network Inspector', group: 'Debugging', keywords: 'network requests waterfall xhr traffic capture' },
  { rail: 'browser', event: 'adomnia:browser-tab', detail: { tab: 'console' }, title: 'Browser Console', group: 'Debugging', keywords: 'console log javascript evaluate repl' },
  { rail: 'browser', event: 'adomnia:browser-tab', detail: { tab: 'debugger' }, title: 'Debugger', group: 'Debugging', keywords: 'debugger breakpoint step pause sources' },
  { rail: 'browser', event: 'adomnia:browser-tab', detail: { tab: 'dom' }, title: 'DOM Inspector', group: 'Debugging', keywords: 'dom elements html inspect tree' },
  { rail: 'browser', event: 'adomnia:browser-tab', detail: { tab: 'storage' }, title: 'Browser Storage', group: 'Debugging', keywords: 'storage cookies localstorage sessionstorage indexeddb' },
  { rail: 'browser', event: 'adomnia:browser-tab', detail: { tab: 'throttling' }, title: 'Network Throttling', group: 'Debugging', keywords: 'throttle slow 3g latency bandwidth offline' },

  // Power Tools utilities
  { rail: 'powertools', event: 'adomnia:powertools-tool', detail: { tool: 'base64' }, title: 'Base64', group: 'Power Tools', keywords: 'base64 encode decode' },
  { rail: 'powertools', event: 'adomnia:powertools-tool', detail: { tool: 'hash' }, title: 'Hash Generator', group: 'Power Tools', keywords: 'hash sha md5 digest checksum' },
  { rail: 'powertools', event: 'adomnia:powertools-tool', detail: { tool: 'hmac' }, title: 'HMAC', group: 'Power Tools', keywords: 'hmac sign signature webhook secret' },
  { rail: 'powertools', event: 'adomnia:powertools-tool', detail: { tool: 'jwt' }, title: 'JWT Decoder', group: 'Power Tools', keywords: 'jwt token decode header payload bearer' },
  { rail: 'powertools', event: 'adomnia:powertools-tool', detail: { tool: 'password' }, title: 'Password Generator', group: 'Power Tools', keywords: 'password secret random generate' },
  { rail: 'powertools', event: 'adomnia:powertools-tool', detail: { tool: 'pem' }, title: 'PEM / JKS', group: 'Power Tools', keywords: 'pem jks certificate key inspect' },
  { rail: 'powertools', event: 'adomnia:powertools-tool', detail: { tool: 'class' }, title: 'Java Decompiler', group: 'Power Tools', keywords: 'java class decompile bytecode jvm' },
  { rail: 'powertools', event: 'adomnia:powertools-tool', detail: { tool: 'timestamp' }, title: 'Timestamp', group: 'Power Tools', keywords: 'timestamp unix epoch iso date convert' },
  { rail: 'powertools', event: 'adomnia:powertools-tool', detail: { tool: 'fake' }, title: 'Fake Data', group: 'Power Tools', keywords: 'fake data mock names emails lorem' },
  { rail: 'powertools', event: 'adomnia:powertools-tool', detail: { tool: 'uuid' }, title: 'UUID', group: 'Power Tools', keywords: 'uuid guid v4 id generate' },
  { rail: 'powertools', event: 'adomnia:powertools-tool', detail: { tool: 'regex' }, title: 'Regex Tester', group: 'Power Tools', keywords: 'regex regexp pattern match test' },
  { rail: 'powertools', event: 'adomnia:powertools-tool', detail: { tool: 'yamlval' }, title: 'YAML Validator', group: 'Power Tools', keywords: 'yaml validate lint' },
  { rail: 'powertools', event: 'adomnia:powertools-tool', detail: { tool: 'folderdiff' }, title: 'Folder Diff', group: 'Power Tools', keywords: 'folder diff compare directory winmerge' },
]

function tokenScore(token: string, text: string): number | null {
  const directIndex = text.indexOf(token)
  if (directIndex === 0) return 100 - token.length
  if (directIndex > 0) return 80 - directIndex

  let lastIndex = -1
  let gaps = 0
  for (const char of token) {
    const nextIndex = text.indexOf(char, lastIndex + 1)
    if (nextIndex < 0) return null
    if (lastIndex >= 0) gaps += nextIndex - lastIndex - 1
    lastIndex = nextIndex
  }
  return 55 - gaps
}

export function fuzzyScore(query: string, text: string): number | null {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return 0
  const candidate = text.toLowerCase()
  let score = 0
  for (const token of tokens) {
    const match = tokenScore(token, candidate)
    if (match === null) return null
    score += match
  }
  return score
}
