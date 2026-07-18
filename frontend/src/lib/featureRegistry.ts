import type { RailItem } from '@/stores/app'

export type FeatureMaturity = 'core' | 'advanced' | 'lab' | 'deprecated'

export interface FeatureDef {
  id: RailItem
  title: string
  group: string
  keywords: string
  maturity: FeatureMaturity
  description?: string
  railLabel?: string
}

export interface FeatureRailItem {
  id: RailItem
  label?: string
}

export interface FeatureRailGroup {
  title: string
  items: FeatureRailItem[]
}

export interface FeatureRailCategory {
  key: string
  label: string
  code: string
  directItem?: RailItem
  groups: FeatureRailGroup[]
}

export const FEATURE_REGISTRY: FeatureDef[] = [
  { id: 'welcome', title: 'Home', group: 'Navigation', keywords: 'welcome onboarding start', maturity: 'core' },
  { id: 'collections', title: 'API Workspace', group: 'API Core', keywords: 'collections requests http rest graphql auth tests', maturity: 'core', railLabel: 'API Workspace' },
  { id: 'scenarios', title: 'Daily Scenarios', group: 'API Core', keywords: 'daily workbench quick access custom steps kafka mongodb rest mock consumer verification', maturity: 'advanced' },
  { id: 'history', title: 'Request History', group: 'API Core', keywords: 'responses history saved previous reopen search', maturity: 'core' },
  { id: 'flows', title: 'API Flows', group: 'API Core', keywords: 'workflow sequence auth extract script wait condition executable mermaid', maturity: 'advanced', railLabel: 'Flows' },
  { id: 'apidocs', title: 'API Docs / Swagger', group: 'API Core', keywords: 'swagger openapi oas docs documentation reference redoc viewer spec api', maturity: 'core' },

  { id: 'websocket', title: 'WebSocket', group: 'Protocols', keywords: 'ws realtime socket frames', maturity: 'core' },
  { id: 'sse', title: 'SSE Client', group: 'Protocols', keywords: 'events stream server sent', maturity: 'advanced' },
  { id: 'broker', title: 'Broker Studio', group: 'Protocols', keywords: 'kafka topic producer consumer mqtt amqp redis nats messaging', maturity: 'core' },
  { id: 'grpc', title: 'gRPC Client', group: 'Protocols', keywords: 'protobuf rpc reflection streaming tls metadata', maturity: 'core' },
  { id: 'soap', title: 'SOAP Studio', group: 'Protocols', keywords: 'wsdl xml legacy enterprise ws-security', maturity: 'core' },
  { id: 'mcp', title: 'MCP Client', group: 'Protocols', keywords: 'model context protocol ai tools resources prompts debugger server generator stdio', maturity: 'advanced' },

  { id: 'mock', title: 'Mock Server', group: 'API Core', keywords: 'stub simulate response replay local server', maturity: 'core' },
  { id: 'proxy', title: 'Proxy Interceptor', group: 'API Core', keywords: 'traffic intercept breakpoint ca certificate rewrite capture', maturity: 'core' },
  { id: 'dockerlab', title: 'Docker Lab', group: 'Infrastructure', keywords: 'containers compose local lab dependencies kafka postgres redis', maturity: 'advanced' },

  { id: 'browser', title: 'Browser Debug', group: 'Debugging', keywords: 'cdp chrome network page debug console dom storage headers security', maturity: 'advanced', railLabel: 'Browser Debug' },
  { id: 'har', title: 'HAR Viewer', group: 'Debugging', keywords: 'archive waterfall import network capture replay', maturity: 'advanced' },
  { id: 'observe', title: 'Observability', group: 'Debugging', keywords: 'metrics logs traces local jsonl waterfall correlated request activity', maturity: 'advanced' },

  { id: 'database', title: 'Database Studio', group: 'Local Data', keywords: 'sql query db sqlite postgres mysql mongo database', maturity: 'advanced' },
  { id: 'storage', title: 'Storage Explorer', group: 'Local Data', keywords: 'bbolt persistence key value local repair raw app storage', maturity: 'advanced' },
  { id: 'vault', title: 'Vault', group: 'Local Data', keywords: 'secret credentials local vault certificate password', maturity: 'advanced' },

  { id: 'jsonviewer', title: 'JSON Studio', group: 'Power Tools', keywords: 'json tree raw graph fullscreen format validate inspect diff sort repair diagnostics', maturity: 'core', railLabel: 'JSON Studio' },
  { id: 'xmltools', title: 'XML Tools', group: 'Power Tools', keywords: 'xml format validate xpath diff soap envelope', maturity: 'advanced' },
  { id: 'powertools', title: 'Power Tools', group: 'Power Tools', keywords: 'encode decode jwt uuid toolbox hash hmac regex yaml pem folder diff', maturity: 'core', railLabel: 'Tool Launcher' },
  { id: 'secretscanner', title: 'Secret Scanner', group: 'Power Tools', keywords: 'credential scan security token api key private key', maturity: 'advanced' },

  { id: 'markdown', title: 'Markdown Notes', group: 'Document Studio', keywords: 'md preview notes docs backlinks outline graph', maturity: 'core' },
  { id: 'mermaid', title: 'Mermaid Diagrams', group: 'Document Studio', keywords: 'diagram graph flowchart sequence mermaid mmd preview fullscreen zoom export', maturity: 'advanced' },
  { id: 'latex', title: 'LaTeX Studio', group: 'Document Studio', keywords: 'tex latex cv resume curriculum pdf document template preset', maturity: 'lab' },
  { id: 'pdfeditor', title: 'PDF Editor & Sign', group: 'Document Studio', keywords: 'pdf edit annotate sign signature form fill text highlight document viewer', maturity: 'core' },

  { id: 'gitsync', title: 'Git Sync', group: 'Workspace', keywords: 'git compare diff workspace sync version control branch commit push stash', maturity: 'advanced' },
  { id: 'workspace', title: 'Workspace Settings', group: 'Workspace', keywords: 'workspace import export settings local file', maturity: 'advanced' },
  { id: 'themes', title: 'Themes', group: 'Workspace', keywords: 'theme skin appearance colors design', maturity: 'advanced' },
  { id: 'templates', title: 'Templates', group: 'Workspace', keywords: 'templates snippets reusable workspace', maturity: 'advanced' },
  { id: 'plugins', title: 'Plugins', group: 'Workspace', keywords: 'extensions wasm js plugins', maturity: 'advanced' },
  { id: 'settings', title: 'Settings', group: 'Navigation', keywords: 'preferences configuration appearance', maturity: 'core' },
]

export const FEATURE_BY_ID = Object.fromEntries(
  FEATURE_REGISTRY.map((feature) => [feature.id, feature]),
) as Record<RailItem, FeatureDef>

export const RAIL_CATEGORIES: FeatureRailCategory[] = [
  {
    key: 'api', label: 'API Core', code: 'API',
    groups: [
      { title: 'Requests', items: ['collections', 'history', 'scenarios'].map((id) => ({ id: id as RailItem })) },
      { title: 'Design', items: ['apidocs', 'flows'].map((id) => ({ id: id as RailItem })) },
      { title: 'Mock & Intercept', items: ['mock', 'proxy'].map((id) => ({ id: id as RailItem })) },
    ],
  },
  {
    key: 'protocols', label: 'Protocols', code: 'PROTO',
    groups: [
      { title: 'Streaming', items: ['websocket', 'broker', 'sse'].map((id) => ({ id: id as RailItem })) },
      { title: 'Enterprise', items: ['grpc', 'soap', 'mcp'].map((id) => ({ id: id as RailItem })) },
    ],
  },
  {
    key: 'infra', label: 'Infrastructure', code: 'INFRA',
    groups: [
      { title: 'Local Runtime', items: ['dockerlab'].map((id) => ({ id: id as RailItem })) },
    ],
  },
  {
    key: 'debug', label: 'Browser Debug', code: 'DEBUG',
    directItem: 'browser',
    groups: [{ title: 'Debugging', items: [{ id: 'browser' }] }],
  },
  {
    key: 'data', label: 'Local Data', code: 'DATA',
    groups: [
      { title: 'Data', items: ['database', 'vault', 'storage'].map((id) => ({ id: id as RailItem })) },
    ],
  },
  {
    key: 'docs', label: 'Document Studio', code: 'DOC',
    groups: [
      { title: 'Documents', items: ['markdown', 'pdfeditor', 'mermaid', 'latex'].map((id) => ({ id: id as RailItem })) },
    ],
  },
  {
    key: 'tools', label: 'Power Tools', code: 'TOOLS',
    groups: [
      { title: 'Focused Tools', items: ['jsonviewer', 'powertools', 'xmltools'].map((id) => ({ id: id as RailItem })) },
    ],
  },
  {
    key: 'workspace', label: 'Workspace', code: 'WORK',
    groups: [
      { title: 'Versioning', items: ['gitsync'].map((id) => ({ id: id as RailItem })) },
      { title: 'Customize', items: ['themes', 'templates', 'plugins'].map((id) => ({ id: id as RailItem })) },
    ],
  },
]

export const COMMAND_PALETTE_PANEL_FEATURES = FEATURE_REGISTRY.filter(
  (feature) => feature.maturity !== 'deprecated',
)

export function isFeatureVisible(
  id: RailItem,
  flags: { showAdvancedFeatures: boolean; showLabFeatures: boolean },
): boolean {
  const maturity = FEATURE_BY_ID[id]?.maturity ?? 'core'
  if (maturity === 'deprecated') return false
  if (maturity === 'lab') return flags.showLabFeatures
  if (maturity === 'advanced') return flags.showAdvancedFeatures
  return true
}

export function getFeatureLabel(id: RailItem): string {
  const feature = FEATURE_BY_ID[id]
  return feature?.railLabel ?? feature?.title ?? id
}
