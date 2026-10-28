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
  'loginspector',
  'xmltools',
  'flows',
  'soap',
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
  'security',
  'settings',
  'welcome',
  'collab',
  'apidocs',
  'codestudio',
  'kube',
] as const

export type RailItem = (typeof RAIL_ITEMS)[number]

const railItems = new Set<string>(RAIL_ITEMS)

const LEGACY_RAIL_ALIASES: Record<string, RailItem> = {
  kafka: 'broker',
  jsontools: 'jsonviewer',
  nettools: 'browser',
  utils: 'powertools',
  // Folded into Code Studio: Markdown/Mermaid preview in the editor, Git as a tool window.
  markdown: 'codestudio',
  mermaid: 'codestudio',
  gitsync: 'codestudio',
  // Renamed from the Go-only name; persisted rails and hub layouts still carry it.
  goide: 'codestudio',
}

export function normalizeRailItem(value: unknown): RailItem | null {
  if (typeof value !== 'string') return null
  const normalized = LEGACY_RAIL_ALIASES[value] ?? value
  return railItems.has(normalized) ? normalized as RailItem : null
}
