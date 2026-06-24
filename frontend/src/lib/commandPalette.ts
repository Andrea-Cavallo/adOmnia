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
  { id: 'flows', title: 'Flows', group: 'API Core', keywords: 'workflow sequence auth extract script wait condition' },
  { id: 'websocket', title: 'WebSocket', group: 'Protocols', keywords: 'ws realtime socket' },
  { id: 'sse', title: 'SSE Client', group: 'Protocols', keywords: 'events stream server sent' },
  { id: 'broker', title: 'Broker Studio', group: 'Protocols', keywords: 'kafka topic producer consumer load test mqtt amqp messaging' },
  { id: 'grpc', title: 'gRPC Client', group: 'Protocols', keywords: 'protobuf rpc' },
  { id: 'soap', title: 'SOAP Studio', group: 'Protocols', keywords: 'wsdl xml legacy enterprise' },
  { id: 'mcp', title: 'MCP Client', group: 'Protocols', keywords: 'model context protocol ai tools resources prompts debugger server generator stdio' },
  { id: 'mock', title: 'Mock Server', group: 'Infrastructure', keywords: 'stub simulate response replay' },
  { id: 'proxy', title: 'Proxy Interceptor', group: 'Infrastructure', keywords: 'traffic intercept breakpoint ca certificate' },
  { id: 'browser', title: 'Browser Debug & Net Tools', group: 'Debugging', keywords: 'cdp chrome network page debug cors dns tls ssl ping port headers security' },
  { id: 'har', title: 'HAR Viewer', group: 'Power Tools', keywords: 'archive waterfall import network' },
  { id: 'observe', title: 'Observability', group: 'Power Tools', keywords: 'metrics logs traces' },
  { id: 'secretscanner', title: 'Secret Scanner', group: 'Power Tools', keywords: 'credential scan security token' },
  { id: 'database', title: 'Database Studio', group: 'Data', keywords: 'sql query db' },
  { id: 'storage', title: 'Storage Explorer', group: 'Data', keywords: 'bbolt persistence key value local' },
  { id: 'vault', title: 'Vault', group: 'Data', keywords: 'secret credentials local' },
  { id: 'gitsync', title: 'Git Sync', group: 'Data', keywords: 'git compare diff workspace sync version control' },
  { id: 'plugins', title: 'Plugins', group: 'Data', keywords: 'extensions wasm js' },
  { id: 'jsontools', title: 'JSON Tools', group: 'Power Tools', keywords: 'format validate repair diagnostics' },
  { id: 'xmltools', title: 'XML Tools', group: 'Power Tools', keywords: 'format validate xpath' },
  { id: 'powertools', title: 'All Utilities', group: 'Power Tools', keywords: 'encode decode jwt uuid toolbox' },
  { id: 'dockerlab', title: 'Docker Lab', group: 'Power Tools', keywords: 'containers compose local lab' },
  { id: 'pdfeditor', title: 'PDF Editor & Sign', group: 'Document Studio', keywords: 'pdf edit annotate sign signature form fill text highlight document viewer' },
  { id: 'apidocs', title: 'API Docs / Swagger', group: 'Data', keywords: 'swagger openapi oas docs documentation reference redoc viewer spec api' },
  { id: 'markdown', title: 'Markdown Notes', group: 'Document Studio', keywords: 'md preview notes docs' },
  { id: 'mermaid', title: 'Mermaid Diagrams', group: 'Document Studio', keywords: 'diagram graph flowchart sequence mermaid mmd preview fullscreen zoom' },
  { id: 'latex', title: 'LaTeX Studio', group: 'Document Studio', keywords: 'tex latex cv resume curriculum pdf document template preset awesome cv' },
  { id: 'settings', title: 'Settings', group: 'Navigation', keywords: 'preferences configuration appearance' },
]

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
  { rail: 'nettools', event: 'adomnia:nettools-tab', detail: { tab: 'cors' }, title: 'CORS Test', group: 'Debugging', keywords: 'cors preflight options origin access-control strict cross-origin browser' },
  { rail: 'nettools', event: 'adomnia:nettools-tab', detail: { tab: 'dns' }, title: 'DNS Lookup', group: 'Debugging', keywords: 'dns lookup a aaaa mx txt ns resolve record' },
  { rail: 'nettools', event: 'adomnia:nettools-tab', detail: { tab: 'trace' }, title: 'DNS Trace', group: 'Debugging', keywords: 'dns trace delegation authoritative' },
  { rail: 'nettools', event: 'adomnia:nettools-tab', detail: { tab: 'compare' }, title: 'DNS Compare', group: 'Debugging', keywords: 'dns compare resolver diff' },
  { rail: 'nettools', event: 'adomnia:nettools-tab', detail: { tab: 'cache' }, title: 'DNS Cache', group: 'Debugging', keywords: 'dns cache clear flush' },
  { rail: 'nettools', event: 'adomnia:nettools-tab', detail: { tab: 'portscan' }, title: 'Port Scan', group: 'Debugging', keywords: 'port scan open ports tcp' },

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
