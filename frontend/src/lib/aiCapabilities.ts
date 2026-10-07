import type { RailItem } from '@/lib/navigation'

export interface AdomniaCapability {
  id: string
  label: string
  panel: RailItem
  aliases: string[]
  summary: string
}

/**
 * Compact, model-facing index of adOmnia. This is deliberately kept next to
 * the assistant protocol so a0 reasons about the product that actually exists
 * instead of inventing generic API-tool features.
 */
export const ADOMNIA_CAPABILITIES: AdomniaCapability[] = [
  { id: 'http', label: 'HTTP Collections', panel: 'collections', aliases: ['api', 'http', 'request', 'collection', 'postman', 'insomnia', 'bruno', 'curl'], summary: 'Create, send, organize, import and export API requests.' },
  { id: 'scenarios', label: 'Daily Scenarios', panel: 'scenarios', aliases: ['scenario', 'workflow', 'daily'], summary: 'Run guided end-to-end API development scenarios.' },
  { id: 'history', label: 'Request History', panel: 'history', aliases: ['history', 'cronologia'], summary: 'Inspect and reopen previously sent requests.' },
  { id: 'flows', label: 'API Flows', panel: 'flows', aliases: ['flow', 'workflow', 'chain', 'catena'], summary: 'Build multi-step API workflows with variables and assertions.' },
  { id: 'apidocs', label: 'API Docs & OpenAPI', panel: 'apidocs', aliases: ['openapi', 'swagger', 'docs', 'documentation', 'documentazione', 'schema'], summary: 'Design, edit, validate and generate OpenAPI documentation.' },
  { id: 'mock', label: 'Mock Server', panel: 'mock', aliases: ['mock', 'mockami', 'stub', 'simulate', 'simula', 'fake api'], summary: 'Generate and run local REST mock endpoints, conditional responses and traffic inspection.' },
  { id: 'proxy', label: 'HTTP Proxy', panel: 'proxy', aliases: ['proxy', 'intercept', 'breakpoint', 'map local'], summary: 'Intercept, inspect and rewrite HTTP traffic.' },
  { id: 'browser', label: 'Browser Debug', panel: 'browser', aliases: ['browser', 'chrome', 'cdp', 'dom', 'network'], summary: 'Debug browser pages and turn captured traffic into requests, flows or mocks.' },
  { id: 'har', label: 'HAR Inspector', panel: 'har', aliases: ['har', 'archive', 'network trace'], summary: 'Inspect HAR traffic and convert entries into requests or mocks.' },
  { id: 'websocket', label: 'WebSocket', panel: 'websocket', aliases: ['websocket', 'socket', 'ws'], summary: 'Connect, exchange messages and run WebSocket mocks.' },
  { id: 'sse', label: 'Server-Sent Events', panel: 'sse', aliases: ['sse', 'eventsource', 'server sent'], summary: 'Connect to and inspect SSE streams.' },
  { id: 'grpc', label: 'gRPC Studio', panel: 'grpc', aliases: ['grpc', 'protobuf', 'proto'], summary: 'Discover and invoke gRPC services.' },
  { id: 'soap', label: 'SOAP Studio', panel: 'soap', aliases: ['soap', 'wsdl', 'xml service'], summary: 'Import WSDL and invoke SOAP services including enterprise security.' },
  { id: 'broker', label: 'Broker Studio', panel: 'broker', aliases: ['kafka', 'mqtt', 'rabbitmq', 'nats', 'broker', 'queue'], summary: 'Produce and consume messages across supported brokers.' },
  { id: 'docker', label: 'Docker Lab', panel: 'dockerlab', aliases: ['docker', 'container', 'lab'], summary: 'Run local integration infrastructure and demo services.' },
  { id: 'database', label: 'Database Studio', panel: 'database', aliases: ['database', 'db', 'sql', 'sqlite', 'postgres'], summary: 'Inspect and query local or configured databases.' },
  { id: 'storage', label: 'Storage Inspector', panel: 'storage', aliases: ['storage', 'bbolt', 'localstorage'], summary: 'Inspect adOmnia local persistence.' },
  { id: 'vault', label: 'Vault', panel: 'vault', aliases: ['vault', 'secret', 'credential', 'password'], summary: 'Store and use encrypted local secrets.' },
  { id: 'workspace', label: 'Workspace Manager', panel: 'workspace', aliases: ['workspace', 'backup', 'import', 'export'], summary: 'Manage portable local-first workspaces and backups.' },
  { id: 'mcp', label: 'MCP', panel: 'mcp', aliases: ['mcp', 'model context protocol', 'tool server'], summary: 'Connect to MCP servers and generate MCP tools from API collections.' },
  { id: 'loadtest', label: 'Load Testing', panel: 'collections', aliases: ['load test', 'stress', 'performance', 'latency'], summary: 'Run API load tests and inspect percentile metrics from requests.' },
  { id: 'json', label: 'JSON Studio', panel: 'jsonviewer', aliases: ['json', 'jsonpath', 'jq'], summary: 'Inspect, transform and query JSON.' },
  { id: 'xml', label: 'XML Tools', panel: 'xmltools', aliases: ['xml', 'xpath', 'xsd', 'xslt'], summary: 'Format, query and transform XML.' },
  { id: 'utils', label: 'Developer Utilities', panel: 'powertools', aliases: ['utility', 'uuid', 'base64', 'jwt', 'hash', 'encode'], summary: 'Use local encoding, token, identifier and conversion tools.' },
  { id: 'logs', label: 'Log Inspector', panel: 'loginspector', aliases: ['log', 'trace', 'stacktrace'], summary: 'Analyze logs and turn detected call chains into flows or mocks.' },
  { id: 'observe', label: 'Observability', panel: 'observe', aliases: ['observe', 'observability', 'metric', 'otel'], summary: 'Inspect application and API observability signals.' },
  { id: 'secret-scanner', label: 'Secret Scanner', panel: 'secretscanner', aliases: ['scan secret', 'leak', 'credential scan'], summary: 'Find exposed credentials in local content.' },
  { id: 'markdown', label: 'Markdown Studio', panel: 'markdown', aliases: ['markdown', 'notes', 'readme'], summary: 'Write technical notes with live preview.' },
  { id: 'mermaid', label: 'Mermaid Studio', panel: 'mermaid', aliases: ['mermaid', 'diagram', 'sequence'], summary: 'Create and preview technical diagrams.' },
  { id: 'latex', label: 'LaTeX Studio', panel: 'latex', aliases: ['latex', 'tex', 'cv', 'report'], summary: 'Edit LaTeX documents and technical reports.' },
  { id: 'pdf', label: 'PDF Editor', panel: 'pdfeditor', aliases: ['pdf', 'sign', 'signature'], summary: 'Edit, annotate, organize and sign PDF files.' },
  { id: 'templates', label: 'Templates', panel: 'templates', aliases: ['template', 'preset'], summary: 'Install and share request, flow, mock and environment templates.' },
  { id: 'plugins', label: 'Plugins', panel: 'plugins', aliases: ['plugin', 'extension', 'javascript'], summary: 'Install and run local JavaScript extensions.' },
  { id: 'themes', label: 'Themes & Skins', panel: 'themes', aliases: ['theme', 'skin', 'appearance'], summary: 'Customize, import and export the interface theme.' },
  { id: 'git', label: 'Git Sync', panel: 'gitsync', aliases: ['git', 'commit', 'branch', 'sync'], summary: 'Version and synchronize portable workspace files.' },
  { id: 'goide', label: 'Go Studio', panel: 'goide', aliases: ['go ide', 'golang', 'go project', 'go studio'], summary: 'Open and register local Go projects behind an explicit tool-execution trust boundary.' },
  { id: 'settings', label: 'Settings', panel: 'settings', aliases: ['setting', 'configuration', 'impostazioni'], summary: 'Configure adOmnia, privacy, defaults and the AI Engine.' },
]

function normalized(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export function relevantCapabilities(message: string, limit = 8): AdomniaCapability[] {
  const text = normalized(message)
  const ranked = ADOMNIA_CAPABILITIES
    .map((capability, index) => ({
      capability,
      index,
      score: capability.aliases.reduce((score, alias) => score + (text.includes(normalized(alias)) ? 1 : 0), 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.capability)
  return ranked.length ? ranked : ADOMNIA_CAPABILITIES.slice(0, limit)
}

export function capabilityMapForPrompt(): string {
  return ADOMNIA_CAPABILITIES.map((capability) => `- ${capability.label} [panel=${capability.panel}]: ${capability.summary}`).join('\n')
}

