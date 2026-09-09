export interface Tool {
  id: string
  label: string
  desc?: string
  example?: string
}

export interface Category {
  label: string
  marker?: string
  tools: Tool[]
}

export const CATEGORIES: Category[] = [
  {
    label: 'Power Studios',
    tools: [
      { id: 'xmlstudio',     label: 'XML Tools' },
      { id: 'harviewer',     label: 'HAR Viewer' },
      { id: 'observability', label: 'Observability' },
      { id: 'secretscanner', label: 'Secret Scanner' },
      { id: 'dockerlab',     label: 'Docker Lab' },
    ],
  },
  {
    label: 'Encoding & Formats',
    tools: [
      { id: 'base64', label: 'Base64' },
    ],
  },
  {
    label: 'Security & Crypto',
    tools: [
      { id: 'hash',     label: 'Hash Generator' },
      { id: 'hmac',     label: 'HMAC' },
      { id: 'jwt',      label: 'JWT Decoder' },
      { id: 'password', label: 'Password Generator' },
      { id: 'pem',      label: 'PEM / JKS' },
      { id: 'class',    label: 'Java Decompiler' },
    ],
  },
  {
    label: 'Generators',
    tools: [
      { id: 'timestamp', label: 'Timestamp' },
      { id: 'fake',      label: 'Fake Data' },
      { id: 'uuid',      label: 'UUID' },
    ],
  },
  {
    label: 'Reference & Validation',
    tools: [
      { id: 'regex',      label: 'Regex Tester' },
      { id: 'yamlval',    label: 'YAML Validator' },
      { id: 'folderdiff', label: 'Folder Diff' },
    ],
  },
  {
    label: 'Playground',
    tools: [
      { id: 'easter', label: 'Easter Egg' },
    ],
  },
]

export const TOOL_DETAILS: Record<string, Pick<Tool, 'desc' | 'example'>> = {
  xmlstudio: { desc: 'Full XML formatter, XPath, diff and validation studio.', example: 'SOAP envelopes and enterprise XML payloads' },
  harviewer: { desc: 'Import, compare and inspect HAR waterfalls without leaving Power Tools.', example: 'Browser capture.har' },
  observability: { desc: 'Inspect local logs, trace waterfalls and correlated request activity.', example: 'Local JSONL dev logs and traces' },
  secretscanner: { desc: 'Scan collections and environments for exposed credentials.', example: 'Bearer tokens, API keys, private keys' },
  dockerlab: { desc: 'Generate and run local Docker Compose labs from curated presets.', example: 'Postgres + Kafka + mock services' },
  base64: { desc: 'Encode and decode text payloads, tokens, and copied response fragments.', example: 'Authorization fragments, binary-safe text snippets' },
  url: { desc: 'Escape or decode query params, callback URLs, and path fragments.', example: 'redirect_uri=https%3A%2F%2Fapp.local%2Fcallback' },
  jsonyaml: { desc: 'Convert compact request examples between JSON and YAML notation.', example: '{"service":"payments","enabled":true}' },
  hash: { desc: 'Generate common digests for payload comparison and cache keys.', example: 'SHA-256 over request bodies' },
  hmac: { desc: 'Sign sample webhook bodies with SHA HMAC algorithms.', example: 'X-Signature test value' },
  jwt: { desc: 'Inspect JWT header and payload locally without calling a remote service.', example: 'eyJhbGciOiJIUzI1NiIs...' },
  password: { desc: 'Create throwaway secrets for local services and mock credentials.', example: '24 chars with symbols and digits' },
  uuid: { desc: 'Generate one or many v4 IDs for fixtures, trace IDs, and test records.', example: 'Batch 10 correlation IDs' },
  curlimp: { desc: 'Jump from copied terminal cURL commands into the composer workflow.', example: 'curl -X POST https://api.local/orders' },
  cors: { desc: 'Check preflight and response CORS behavior from a chosen origin.', example: 'Origin https://admin.local with PUT' },
  dns: { desc: 'Resolve A, AAAA, MX, TXT, CNAME, NS, and SOA records from the backend helper.', example: 'TXT records for example.com' },
  portscan: { desc: 'Quickly check whether local or lab ports are reachable.', example: 'localhost:80,443,8080' },
  timestamp: { desc: 'Convert Unix seconds and ISO dates into UTC, local, and ISO views.', example: '1715774400 -> ISO/local/UTC' },
  fake: { desc: 'Generate small lists of names, emails, phones, IPs, and lorem text.', example: '20 sample customer emails' },
  query: { desc: 'Parse query strings or full URLs into structured key/value JSON.', example: '?page=2&sort=createdAt' },
  jsondiff: { desc: 'Compare JSON or XML payloads with visual highlights and a path-level summary.', example: 'response v1 vs response v2' },
  jsongraph: { desc: 'Visualize nested JSON as an indented tree.', example: '{"user":{"roles":["admin"]}}' },
  xml: { desc: 'Format and validate XML snippets before sending SOAP or legacy payloads.', example: '<Envelope><Body /></Envelope>' },
  regex: { desc: 'Test expressions against sample text and inspect matches.', example: 'Bearer\\s+(.+) against headers' },
  yamlval: { desc: 'Check quick YAML snippets used in examples and docker files.', example: 'services: api: image: mock-api' },
  httpstatus: { desc: 'Search status codes with practical explanations for API debugging.', example: '409 conflict, 422 validation, 429 throttling' },
  pem: { desc: 'Inspect PEM blocks and identify certificate/key boundaries.', example: '-----BEGIN CERTIFICATE-----' },
  class: { desc: 'Decompile local Java class-file bytecode into readable source and inspect JVM metadata.' },
  grpcclient: { desc: 'Shortcut to the dedicated gRPC panel for unary request testing.', example: 'package.Service/GetUser' },
  docker: { desc: 'Generate a starter compose file for mock services and local dependencies.', example: 'API + Redis + Postgres lab stack' },
  folderdiff: { desc: 'Compare two local folders as a WinMerge-style tree and inspect changed files.', example: 'old-release/ vs new-release/' },
  easter: { desc: 'A tiny internal placeholder for hidden diagnostics and experiments.', example: 'adOmnia paratus' },
}

export const CATEGORY_MARKERS: Record<string, string> = {
  'Encoding & Formats': '<>',
  'Security & Crypto': '#',
  Generators: '@',
  'Reference & Validation': '/',
  'Compare & Inspect': '==',
  'Security & Identity': '#',
  'Network & HTTP': '~',
  'Data Generators': '@',
  Validation: '/',
  Infrastructure: '{}',
  'Power Studios': 'P',
  Playground: '*',
}
