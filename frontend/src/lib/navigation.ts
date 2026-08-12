export const RAIL_ITEMS = [
  'collections',
  'scenarios',
  'history',
  'broker',
  'websocket',
  'sse',
  'proxy',
  'mock',
  'grpc',
  'browser',
  'dockerlab',
  'jsonviewer',
  'xmltools',
  'flows',
  'soap',
  'markdown',
  'mermaid',
  'latex',
  'pdfeditor',
  'powertools',
  'storage',
  'database',
  'vault',
  'workspace',
  'themes',
  'templates',
  'plugins',
  'har',
  'observe',
  'secretscanner',
  'settings',
  'welcome',
  'gitsync',
  'mcp',
  'apidocs',
] as const

export type RailItem = (typeof RAIL_ITEMS)[number]

const railItems = new Set<string>(RAIL_ITEMS)

const LEGACY_RAIL_ALIASES: Record<string, RailItem> = {
  kafka: 'broker',
  jsontools: 'jsonviewer',
  nettools: 'browser',
  utils: 'powertools',
}

export function normalizeRailItem(value: unknown): RailItem | null {
  if (typeof value !== 'string') return null
  const normalized = LEGACY_RAIL_ALIASES[value] ?? value
  return railItems.has(normalized) ? normalized as RailItem : null
}
