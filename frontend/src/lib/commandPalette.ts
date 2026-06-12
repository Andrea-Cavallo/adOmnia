import type { RailItem } from '@/stores/app'

export interface PalettePanel {
  id: RailItem
  title: string
  group: string
  keywords: string
}

export const COMMAND_PALETTE_PANELS: PalettePanel[] = [
  { id: 'welcome', title: 'Home', group: 'Navigation', keywords: 'welcome onboarding start' },
  { id: 'collections', title: 'API Workspace', group: 'API Core', keywords: 'collections requests http rest' },
  { id: 'scenarios', title: 'Daily Scenarios', group: 'API Core', keywords: 'daily workbench quick access custom steps kafka mongodb rest mock consumer verification' },
  { id: 'history', title: 'Request History', group: 'API Core', keywords: 'responses history saved previous reopen search' },
  { id: 'runner', title: 'Runner', group: 'API Core', keywords: 'collection run regression test' },
  { id: 'flows', title: 'Flows', group: 'API Core', keywords: 'workflow sequence auth extract script wait condition' },
  { id: 'testdata', title: 'Test Data', group: 'API Core', keywords: 'fixture fake generator' },
  { id: 'visualtests', title: 'Visual Tests', group: 'API Core', keywords: 'visual no code tests assertions flow export request validation' },
  { id: 'scheduler', title: 'Scheduled Tasks', group: 'API Core', keywords: 'schedule cron interval job automation history runner' },
  { id: 'apieditor', title: 'API Editor', group: 'API Design', keywords: 'openapi swagger spec endpoint parameters schema visual editor' },
  { id: 'websocket', title: 'WebSocket', group: 'Protocols', keywords: 'ws realtime socket' },
  { id: 'sse', title: 'SSE Client', group: 'Protocols', keywords: 'events stream server sent' },
  { id: 'broker', title: 'Broker Studio', group: 'Protocols', keywords: 'kafka topic producer consumer load test mqtt amqp messaging' },
  { id: 'grpc', title: 'gRPC Client', group: 'Protocols', keywords: 'protobuf rpc' },
  { id: 'soap', title: 'SOAP Studio', group: 'Protocols', keywords: 'wsdl xml legacy enterprise' },
  { id: 'mcp', title: 'MCP Client', group: 'Protocols', keywords: 'model context protocol ai tools resources prompts debugger server generator stdio' },
  { id: 'mock', title: 'Mock Server', group: 'Infrastructure', keywords: 'stub simulate response replay' },
  { id: 'proxy', title: 'Proxy Interceptor', group: 'Infrastructure', keywords: 'traffic intercept breakpoint ca certificate' },
  { id: 'dockerlab', title: 'Docker Lab', group: 'Infrastructure', keywords: 'containers compose local lab' },
  { id: 'browser', title: 'Browser Debug', group: 'Debugging', keywords: 'cdp chrome network page debug' },
  { id: 'nettools', title: 'Network Tools', group: 'Debugging', keywords: 'cors dns tls ssl ping port headers security' },
  { id: 'har', title: 'HAR Viewer', group: 'Debugging', keywords: 'archive waterfall import network' },
  { id: 'observe', title: 'Observability', group: 'Debugging', keywords: 'metrics logs traces' },
  { id: 'secretscanner', title: 'Secret Scanner', group: 'Debugging', keywords: 'credential scan security token' },
  { id: 'database', title: 'Database Studio', group: 'Data', keywords: 'sql query db' },
  { id: 'storage', title: 'Storage Explorer', group: 'Data', keywords: 'bbolt persistence key value local' },
  { id: 'vault', title: 'Vault', group: 'Data', keywords: 'secret credentials local' },
  { id: 'workspace', title: 'Workspace', group: 'Data', keywords: 'import export backup project' },
  { id: 'schemas', title: 'Schema Components', group: 'Data', keywords: 'json schema models components openapi contract refs registry' },
  { id: 'gitsync', title: 'Git Sync', group: 'Data', keywords: 'git compare diff workspace sync version control' },
  { id: 'templates', title: 'Templates & APIs', group: 'Data', keywords: 'marketplace snippets presets api catalog install curated endpoints definitions public apis' },
  { id: 'plugins', title: 'Plugins', group: 'Data', keywords: 'extensions wasm python' },
  { id: 'themes', title: 'Themes', group: 'Data', keywords: 'skin appearance color' },
  { id: 'jsontools', title: 'JSON Tools', group: 'Power Tools', keywords: 'format validate repair diagnostics' },
  { id: 'xmltools', title: 'XML Tools', group: 'Power Tools', keywords: 'format validate xpath' },
  { id: 'powertools', title: 'All Utilities', group: 'Power Tools', keywords: 'encode decode jwt uuid toolbox' },
  { id: 'markdown', title: 'Markdown Editor', group: 'Markdown', keywords: 'md preview notes docs' },
  { id: 'mermaid', title: 'Mermaid Studio', group: 'Markdown', keywords: 'diagram graph flowchart sequence mermaid mmd preview fullscreen zoom' },
  { id: 'settings', title: 'Settings', group: 'Navigation', keywords: 'preferences configuration appearance' },
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
