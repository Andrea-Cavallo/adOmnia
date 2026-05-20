import { useState, useEffect, useMemo } from 'react'
import { Copy, ChevronRight, ChevronDown, UploadCloud, Download, FolderTree, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useServerPort, serverUrl } from '@/lib/useServerPort'
import { parseDocument } from 'yaml'
function safeSelectFolder(title: string): Promise<string> {
  const fn = (window as unknown as { go?: { main?: { App?: { SelectFolder?: (t: string) => Promise<string> } } } })
    ?.go?.main?.App?.SelectFolder
  if (!fn) return Promise.reject(new Error('Wails bridge not available — run inside the desktop app'))
  return fn(title)
}

const copy = (s: string) => navigator.clipboard.writeText(s).catch(() => {})

function downloadText(filename: string, text: string, type = 'text/plain') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function readFileSmart(file: File): Promise<{ text: string; bytes: Uint8Array }> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let text = ''
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    text = ''
  }
  return { text, bytes }
}

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// =========== Category & Tool definitions ===========

interface Tool {
  id: string
  label: string
  desc?: string
  example?: string
}

interface Category {
  label: string
  marker?: string
  tools: Tool[]
}

interface YamlFileResult {
  name: string
  ok: boolean
  message: string
}

type FolderDiffStatus = 'same' | 'modified' | 'left-only' | 'right-only' | 'type-change'

interface FolderDiffNode {
  path: string
  name: string
  isDir: boolean
  status: FolderDiffStatus
  leftSize?: number
  rightSize?: number
  leftModified?: number
  rightModified?: number
  binary?: boolean
  children?: FolderDiffNode[]
}

interface FolderDiffFlat {
  path: string
  status: FolderDiffStatus
  isDir: boolean
  leftSize?: number
  rightSize?: number
  leftModified?: number
  rightModified?: number
  binary?: boolean
}

interface FolderDiffResult {
  leftRoot: string
  rightRoot: string
  tree: FolderDiffNode[]
  flat: FolderDiffFlat[]
  counts: Record<FolderDiffStatus, number>
}

interface FolderDiffPreview {
  path: string
  left: string
  right: string
  leftError?: string
  rightError?: string
}

const CATEGORIES: Category[] = [
  {
    label: 'Encoding & Formats',
    tools: [
      { id: 'base64',   label: 'Base64' },
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
      { id: 'class',    label: 'Class File' },
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

const TOOL_DETAILS: Record<string, Pick<Tool, 'desc' | 'example'>> = {
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
  class: { desc: 'Check pasted Java class-file bytes for magic and version metadata.', example: 'CAFEBABE00000034' },
  grpcclient: { desc: 'Shortcut to the dedicated gRPC panel for unary request testing.', example: 'package.Service/GetUser' },
  docker: { desc: 'Generate a starter compose file for mock services and local dependencies.', example: 'API + Redis + Postgres lab stack' },
  folderdiff: { desc: 'Compare two local folders as a WinMerge-style tree and inspect changed files.', example: 'old-release/ vs new-release/' },
  easter: { desc: 'A tiny internal placeholder for hidden diagnostics and experiments.', example: 'adOmnia paratus' },
}

const CATEGORY_MARKERS: Record<string, string> = {
  'Encoding & Formats': '<>',
  'Compare & Inspect': '==',
  'Security & Identity': '#',
  'Network & HTTP': '~',
  'Data Generators': '@',
  Validation: '/',
  Infrastructure: '{}',
  Playground: '*',
}

// =========== HTTP Status Reference ===========

const HTTP_STATUS: { code: number; category: string; text: string }[] = [
  { code: 100, category: '1xx Informational', text: 'Continue' },
  { code: 101, category: '1xx Informational', text: 'Switching Protocols' },
  { code: 200, category: '2xx Success', text: 'OK' },
  { code: 201, category: '2xx Success', text: 'Created' },
  { code: 202, category: '2xx Success', text: 'Accepted' },
  { code: 203, category: '2xx Success', text: 'Non-Authoritative Information' },
  { code: 204, category: '2xx Success', text: 'No Content' },
  { code: 205, category: '2xx Success', text: 'Reset Content' },
  { code: 206, category: '2xx Success', text: 'Partial Content' },
  { code: 300, category: '3xx Redirection', text: 'Multiple Choices' },
  { code: 301, category: '3xx Redirection', text: 'Moved Permanently' },
  { code: 302, category: '3xx Redirection', text: 'Found' },
  { code: 303, category: '3xx Redirection', text: 'See Other' },
  { code: 304, category: '3xx Redirection', text: 'Not Modified' },
  { code: 307, category: '3xx Redirection', text: 'Temporary Redirect' },
  { code: 308, category: '3xx Redirection', text: 'Permanent Redirect' },
  { code: 400, category: '4xx Client Error', text: 'Bad Request' },
  { code: 401, category: '4xx Client Error', text: 'Unauthorized' },
  { code: 402, category: '4xx Client Error', text: 'Payment Required' },
  { code: 403, category: '4xx Client Error', text: 'Forbidden' },
  { code: 404, category: '4xx Client Error', text: 'Not Found' },
  { code: 405, category: '4xx Client Error', text: 'Method Not Allowed' },
  { code: 406, category: '4xx Client Error', text: 'Not Acceptable' },
  { code: 408, category: '4xx Client Error', text: 'Request Timeout' },
  { code: 409, category: '4xx Client Error', text: 'Conflict' },
  { code: 410, category: '4xx Client Error', text: 'Gone' },
  { code: 411, category: '4xx Client Error', text: 'Length Required' },
  { code: 412, category: '4xx Client Error', text: 'Precondition Failed' },
  { code: 413, category: '4xx Client Error', text: 'Payload Too Large' },
  { code: 414, category: '4xx Client Error', text: 'URI Too Long' },
  { code: 415, category: '4xx Client Error', text: 'Unsupported Media Type' },
  { code: 416, category: '4xx Client Error', text: 'Range Not Satisfiable' },
  { code: 417, category: '4xx Client Error', text: 'Expectation Failed' },
  { code: 418, category: '4xx Client Error', text: "I'm a teapot" },
  { code: 422, category: '4xx Client Error', text: 'Unprocessable Entity' },
  { code: 429, category: '4xx Client Error', text: 'Too Many Requests' },
  { code: 500, category: '5xx Server Error', text: 'Internal Server Error' },
  { code: 501, category: '5xx Server Error', text: 'Not Implemented' },
  { code: 502, category: '5xx Server Error', text: 'Bad Gateway' },
  { code: 503, category: '5xx Server Error', text: 'Service Unavailable' },
  { code: 504, category: '5xx Server Error', text: 'Gateway Timeout' },
]

const HTTP_DESCRIPTIONS: Record<number, string> = {
  100: 'Server has received headers and the client can continue.',
  101: 'Server is switching protocols as requested by the client.',
  200: 'Request completed successfully and returned a normal response.',
  201: 'Resource was created; often includes a Location header.',
  202: 'Request accepted for async processing, not completed yet.',
  203: 'Response metadata was modified by an intermediary.',
  204: 'Success with no response body.',
  205: 'Client should reset the current document or form.',
  206: 'Partial response for a byte range request.',
  300: 'Multiple representations are available.',
  301: 'Resource moved permanently to a new URL.',
  302: 'Temporary redirect; clients usually repeat with GET.',
  303: 'Use GET on another URL for the response.',
  304: 'Cached client copy is still valid.',
  307: 'Temporary redirect preserving the original method.',
  308: 'Permanent redirect preserving the original method.',
  400: 'Malformed request or invalid parameters.',
  401: 'Authentication is required or invalid.',
  402: 'Reserved for payment flows; rarely used.',
  403: 'Authenticated client does not have permission.',
  404: 'Requested resource was not found.',
  405: 'HTTP method is not allowed for this resource.',
  406: 'Server cannot produce an acceptable representation.',
  408: 'Server timed out waiting for the request.',
  409: 'Request conflicts with current resource state.',
  410: 'Resource was intentionally removed.',
  411: 'Content-Length header is required.',
  412: 'Conditional request precondition failed.',
  413: 'Request body exceeds the server limit.',
  414: 'Request URL is too long.',
  415: 'Media type is not supported by the server.',
  416: 'Requested byte range cannot be satisfied.',
  417: 'Expectation header could not be met.',
  418: 'Non-standard test response, kept for compatibility.',
  422: 'Body is well formed but semantically invalid.',
  429: 'Client hit a rate limit or quota.',
  500: 'Unexpected server-side failure.',
  501: 'Server does not support this functionality.',
  502: 'Gateway received an invalid upstream response.',
  503: 'Service is overloaded or unavailable for maintenance.',
  504: 'Gateway did not receive an upstream response in time.',
}

// =========== JSON <> YAML converter ===========

function jsonToYaml(obj: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (obj === null) return 'null'
  if (typeof obj === 'boolean') return String(obj)
  if (typeof obj === 'number') return String(obj)
  if (typeof obj === 'string') return `"${obj}"`
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]'
    return obj.map((item) => `${pad}- ${jsonToYaml(item, indent + 1).trimStart()}`).join('\n')
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj)
    if (keys.length === 0) return '{}'
    return keys.map((k) => `${pad}${k}: ${jsonToYaml(obj[k as keyof typeof obj], indent + 1).trimStart()}`).join('\n')
  }
  return String(obj)
}

function yamlToJson(yaml: string): string {
  try {
    const lines = yaml.split('\n').filter((l) => l.trim())
    const obj: Record<string, unknown> = {}
    let currentKey = ''
    for (const line of lines) {
      const match = line.match(/^(\s*)([\w-]+):\s*(.*)/)
      if (!match) continue
      const [, , key, value] = match
      if (value.startsWith('- ')) {
        obj[key] = value.split('- ').filter(Boolean)
      } else if (value === 'true' || value === 'false') {
        obj[key] = value === 'true'
      } else if (/^\d+(\.\d+)?$/.test(value)) {
        obj[key] = Number(value)
      } else if (value === 'null' || value === '') {
        obj[key] = null
      } else {
        obj[key] = value.replace(/^"/, '').replace(/"$/, '')
      }
      currentKey = key
    }
    if (currentKey === '') return yaml
    return JSON.stringify(obj, null, 2)
  } catch {
    return 'Invalid YAML'
  }
}

// =========== Password Generator ===========

function generatePassword(len: number, upper: boolean, nums: boolean, syms: boolean): string {
  let chars = 'abcdefghijklmnopqrstuvwxyz'
  if (upper) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  if (nums) chars += '0123456789'
  if (syms) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?'
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

// =========== Timestamp Converter ===========

function formatTimestamp(ts: number): { utc: string; local: string; unix: number; iso: string } {
  const d = new Date(ts)
  return {
    utc: d.toUTCString(),
    local: d.toLocaleString(),
    unix: Math.floor(ts / 1000),
    iso: d.toISOString(),
  }
}

// =========== Fake Data Generator ===========

function fakeName() { const f = ['Alice','Bob','Carol','Dave','Eve','Frank','Grace','Heidi']; return f[Math.floor(Math.random()*f.length)] }
function fakeEmail() { return `${fakeName().toLowerCase()}@example.com` }
function fakePhone() { return `+1-${Array.from({length:10},()=>Math.floor(Math.random()*10)).join('').replace(/(\d{3})(\d{3})(\d{4})/,'$1-$2-$3')}` }
function fakeIP() { return Array.from({length:4},()=>Math.floor(Math.random()*256)).join('.') }
function fakeWords(n: number) {
  const w = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua'.split(' ')
  return Array.from({length:n},()=>w[Math.floor(Math.random()*w.length)]).join(' ')
}

// =========== Query String Parser/Builder ===========

function parseQuery(q: string): Record<string, string> {
  const params = new URLSearchParams(q)
  const obj: Record<string, string> = {}
  params.forEach((v, k) => { obj[k] = v })
  return obj
}

// =========== JSON Diff ===========

type JsonDiffStatus = 'added' | 'removed' | 'changed'

interface JsonDiffRow {
  path: string
  left: string
  right: string
  status: JsonDiffStatus
}

interface JsonDiffModel {
  rows: JsonDiffRow[]
  error: string
  equal: boolean
}

function displayJsonValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  return JSON.stringify(value, null, 2) ?? String(value)
}

function flattenJson(value: unknown, path = '$', out: Record<string, string> = {}): Record<string, string> {
  if (value === null || typeof value !== 'object') {
    out[path] = displayJsonValue(value)
    return out
  }
  if (Array.isArray(value)) {
    if (value.length === 0) out[path] = '[]'
    value.forEach((item, index) => flattenJson(item, `${path}[${index}]`, out))
    return out
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) out[path] = '{}'
  entries.forEach(([key, item]) => flattenJson(item, `${path}.${key}`, out))
  return out
}

function buildJsonDiff(left: string, right: string): JsonDiffModel {
  if (!left.trim() || !right.trim()) return { rows: [], error: '', equal: false }
  try {
    const leftFlat = flattenJson(JSON.parse(left))
    const rightFlat = flattenJson(JSON.parse(right))
    const paths = [...new Set([...Object.keys(leftFlat), ...Object.keys(rightFlat)])].sort()
    const rows = paths.reduce<JsonDiffRow[]>((acc, path) => {
      const hasLeft = Object.prototype.hasOwnProperty.call(leftFlat, path)
      const hasRight = Object.prototype.hasOwnProperty.call(rightFlat, path)
      if (!hasLeft) acc.push({ path, left: '', right: rightFlat[path], status: 'added' })
      else if (!hasRight) acc.push({ path, left: leftFlat[path], right: '', status: 'removed' })
      else if (leftFlat[path] !== rightFlat[path]) acc.push({ path, left: leftFlat[path], right: rightFlat[path], status: 'changed' })
      return acc
    }, [])
    return { rows, error: '', equal: rows.length === 0 }
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Invalid JSON in one or both inputs', equal: false }
  }
}

function flattenXml(input: string): Record<string, string> {
  const doc = new DOMParser().parseFromString(input, 'application/xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) throw new Error(parserError.textContent?.trim() || 'Invalid XML')
  const out: Record<string, string> = {}

  const visit = (node: Element, path: string) => {
    for (const attr of Array.from(node.attributes)) {
      out[`${path}.@${attr.name}`] = JSON.stringify(attr.value)
    }

    const text = Array.from(node.childNodes)
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ')
    if (text) out[`${path}.#text`] = JSON.stringify(text)

    const counts = new Map<string, number>()
    Array.from(node.children).forEach((child) => {
      const next = (counts.get(child.tagName) ?? 0) + 1
      counts.set(child.tagName, next)
      visit(child, `${path}/${child.tagName}[${next}]`)
    })

    if (!node.attributes.length && !node.children.length && !text) out[path] = '<empty />'
  }

  visit(doc.documentElement, `/${doc.documentElement.tagName}[1]`)
  return out
}

function buildXmlDiff(left: string, right: string): JsonDiffModel {
  if (!left.trim() || !right.trim()) return { rows: [], error: '', equal: false }
  try {
    const leftFlat = flattenXml(left)
    const rightFlat = flattenXml(right)
    const paths = [...new Set([...Object.keys(leftFlat), ...Object.keys(rightFlat)])].sort()
    const rows = paths.reduce<JsonDiffRow[]>((acc, path) => {
      const hasLeft = Object.prototype.hasOwnProperty.call(leftFlat, path)
      const hasRight = Object.prototype.hasOwnProperty.call(rightFlat, path)
      if (!hasLeft) acc.push({ path, left: '', right: rightFlat[path], status: 'added' })
      else if (!hasRight) acc.push({ path, left: leftFlat[path], right: '', status: 'removed' })
      else if (leftFlat[path] !== rightFlat[path]) acc.push({ path, left: leftFlat[path], right: rightFlat[path], status: 'changed' })
      return acc
    }, [])
    return { rows, error: '', equal: rows.length === 0 }
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Invalid XML in one or both inputs', equal: false }
  }
}

function diffCounts(rows: JsonDiffRow[]): Record<JsonDiffStatus, number> {
  return rows.reduce<Record<JsonDiffStatus, number>>((acc, row) => {
    acc[row.status] += 1
    return acc
  }, { added: 0, removed: 0, changed: 0 })
}

// =========== JSON Graph visualizer ===========

function JsonGraphView({ json }: { json: string }) {
  try {
    const data = JSON.parse(json)
    const renderNode = (obj: unknown, depth: number = 0): React.ReactNode => {
      if (obj === null) return <span className="text-gray-400">null</span>
      if (typeof obj === 'boolean') return <span className="text-purple-400">{String(obj)}</span>
      if (typeof obj === 'number') return <span className="text-yellow-300">{obj}</span>
      if (typeof obj === 'string') return <span className="text-green-400">"{obj}"</span>
      if (Array.isArray(obj)) {
        return (
          <div className="ml-4">
            <span className="text-text-3">[</span>
            {obj.map((item, i) => (
              <div key={i} className="flex gap-1">
                <span className="text-text-4 text-[10px]">{i}:</span>
                {renderNode(item, depth + 1)}
                {i < obj.length - 1 && <span className="text-text-3">,</span>}
              </div>
            ))}
            <span className="text-text-3">]</span>
          </div>
        )
      }
      if (typeof obj === 'object') {
        const keys = Object.keys(obj)
        return (
          <div className="ml-4">
            <span className="text-text-3">{'{'}</span>
            {keys.map((k) => (
              <div key={k} className="flex gap-1">
                <span className="text-blue-400">"{k}"</span>
                <span className="text-text-3">:</span>
                {renderNode((obj as Record<string, unknown>)[k], depth + 1)}
                {k !== keys[keys.length - 1] && <span className="text-text-3">,</span>}
              </div>
            ))}
            <span className="text-text-3">{'}'}</span>
          </div>
        )
      }
      return <span>{String(obj)}</span>
    }
    return <div className="font-mono text-xs">{renderNode(data)}</div>
  } catch {
    return <span className="text-xs text-error">Invalid JSON</span>
  }
}

// =========== Regex Tester ===========

function RegexTester() {
  const [pattern, setPattern] = useState('Bearer\\s+(.+)')
  const [flags, setFlags] = useState('g')
  const [input, setInput] = useState('Authorization: Bearer demo-token-123\nX-Request-ID: req_42')
  const [matches, setMatches] = useState<RegExpMatchArray[]>([])

  useEffect(() => {
    if (!pattern) { setMatches([]); return }
    try {
      const re = new RegExp(pattern, flags)
      const results = [...input.matchAll(re)]
      setMatches(results)
    } catch {
      setMatches([])
    }
  }, [pattern, flags, input])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-4">/</span>
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="regex pattern"
          className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono placeholder:text-text-4 focus:border-accent outline-none"
        />
        <span className="text-[10px] text-text-4">/</span>
        <input
          value={flags}
          onChange={(e) => setFlags(e.target.value)}
          placeholder="g"
          className="w-12 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none"
        />
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Test input..."
        rows={5}
        className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono placeholder:text-text-4 focus:border-accent outline-none resize-none"
      />
      <div className="text-xs">
        <p className="text-text-3 mb-1">Matches: {matches.length}</p>
        {matches.map((m, i) => (
          <div key={i} className="flex gap-2 font-mono text-text-2">
            <span className="text-text-4">[{i}]</span>
            <span className="text-green-400">"{m[0]}"</span>
            <span className="text-text-4">at index {m.index}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// =========== XML Tools ===========

function xmlFormat(xml: string): string {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, 'text/xml')
    const error = doc.querySelector('parsererror')
    if (error) return `XML Error: ${error.textContent}`
    const serializer = new XMLSerializer()
    let result = serializer.serializeToString(doc)
    // Basic indent
    const tabs = (n: number) => '  '.repeat(n)
    let indent = 0
    result = result.replace(/(<\/?[^>]+>)/g, (m) => {
      if (m.startsWith('</')) indent = Math.max(0, indent - 1)
      const out = tabs(indent) + m
      if (!m.startsWith('</') && !m.endsWith('/>') && !m.startsWith('<?')) indent++
      return out + '\n'
    })
    return result.trim()
  } catch {
    return 'Failed to format XML'
  }
}

function xmlValidate(xml: string): string {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, 'text/xml')
    const error = doc.querySelector('parsererror')
    return error ? `Invalid XML: ${error.textContent}` : 'Valid XML'
  } catch {
    return 'Failed to parse XML'
  }
}

// =========== YAML Validator ===========

function yamlValidate(yaml: string): string {
  try {
    const doc = parseDocument(yaml)
    if (doc.errors.length > 0) return `Invalid YAML: ${doc.errors.map((e) => e.message).join('; ')}`
    if (doc.warnings.length > 0) return `Valid YAML with warnings: ${doc.warnings.map((e) => e.message).join('; ')}`
    return 'Valid YAML'
  } catch (e) {
    return `Invalid YAML: ${e instanceof Error ? e.message : 'Parsing error'}`
  }
}

function yamlValidateResult(yaml: string): { ok: boolean; message: string } {
  const message = yamlValidate(yaml)
  return { ok: message.startsWith('Valid YAML'), message }
}

// =========== PEM/JKS Inspector ===========

function pemInspect(pem: string): string {
  const lines = pem.trim().split('\n')
  const info: string[] = []
  let blockType = ''
  for (const line of lines) {
    if (line.startsWith('-----BEGIN ')) {
      blockType = line.replace('-----BEGIN ', '').replace('-----', '')
      info.push(`Type: ${blockType}`)
    } else if (line.startsWith('-----END ')) {
      const b64 = lines.filter((l) => !l.startsWith('-----')).join('')
      info.push(`Base64 size: ${b64.length} chars`)
      try {
        const raw = atob(b64)
        info.push(`Decoded: ${raw.length} bytes`)
        if (raw.length < 200) info.push(`Content: ${raw}`)
      } catch {
        info.push('(could not decode base64)')
      }
    }
  }
  return info.join('\n') || 'No PEM block detected'
}

function jksInspect(bytes: Uint8Array, name?: string): string {
  const info: string[] = []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = bytes.length >= 4 ? view.getUint32(0, false) : 0
  info.push(`File: ${name || 'dropped file'}`)
  info.push(`Size: ${bytes.length} bytes`)
  if (magic === 0xfeedfeed) {
    info.push('Format: Java KeyStore (JKS)')
    if (bytes.length >= 12) {
      info.push(`Version: ${view.getUint32(4, false)}`)
      info.push(`Entry count: ${view.getUint32(8, false)}`)
    }
    info.push('Content is binary and encrypted/integrity protected; aliases/certificates require the store password.')
    return info.join('\n')
  }
  if (magic === 0x308201 || bytes[0] === 0x30) {
    info.push('Format: DER/ASN.1 certificate or PKCS container candidate')
    return info.join('\n')
  }
  info.push(`Magic: ${bytesToHex(bytes.slice(0, Math.min(8, bytes.length))).toUpperCase()}`)
  info.push('Format: unknown binary certificate/key container')
  return info.join('\n')
}

function pemOrJksInspect(text: string, bytes?: Uint8Array, name?: string): string {
  if (text.includes('-----BEGIN ')) return pemInspect(text)
  if (bytes) return jksInspect(bytes, name)
  return pemInspect(text)
}

// =========== Class File Inspector ===========

function classInspect(hex: string): string {
  const cleanHex = hex.replace(/[^0-9a-f]/gi, '')
  const info: string[] = []
  const magic = cleanHex.slice(0, 8)
  if (magic.toUpperCase() !== 'CAFEBABE') {
    info.push('Magic: ' + magic + ' (expected CAFEBABE)')
    info.push('Not a valid Java class file')
    return info.join('\n')
  }
  info.push('Magic: CAFEBABE (valid)')
  const bytes = new Uint8Array(cleanHex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? [])
  const view = new DataView(bytes.buffer)
  const minor = view.getUint16(4)
  const major = view.getUint16(6)
  info.push(`Version: major ${major}, minor ${minor}${javaVersionName(major)}`)
  const parsed = parseClassFile(bytes)
  if (parsed) info.push(...parsed)
  return info.join('\n')
}

function javaVersionName(major: number): string {
  const map: Record<number, string> = {
    45: ' (Java 1.1)',
    46: ' (Java 1.2)',
    47: ' (Java 1.3)',
    48: ' (Java 1.4)',
    49: ' (Java 5)',
    50: ' (Java 6)',
    51: ' (Java 7)',
    52: ' (Java 8)',
    53: ' (Java 9)',
    54: ' (Java 10)',
    55: ' (Java 11)',
    56: ' (Java 12)',
    57: ' (Java 13)',
    58: ' (Java 14)',
    59: ' (Java 15)',
    60: ' (Java 16)',
    61: ' (Java 17)',
    62: ' (Java 18)',
    63: ' (Java 19)',
    64: ' (Java 20)',
    65: ' (Java 21)',
  }
  return map[major] ?? ''
}

function parseClassFile(bytes: Uint8Array): string[] | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let offset = 8
    const cpCount = view.getUint16(offset); offset += 2
    const cp: Array<{ tag: number; value?: string | number; nameIndex?: number; descriptorIndex?: number; classIndex?: number; nameAndTypeIndex?: number } | null> = [null]
    for (let i = 1; i < cpCount; i++) {
      const tag = view.getUint8(offset); offset += 1
      switch (tag) {
        case 1: {
          const len = view.getUint16(offset); offset += 2
          const value = new TextDecoder().decode(bytes.slice(offset, offset + len))
          offset += len
          cp[i] = { tag, value }
          break
        }
        case 3:
        case 4:
          cp[i] = { tag, value: view.getUint32(offset) }; offset += 4
          break
        case 5:
        case 6:
          cp[i] = { tag }; offset += 8; i++; cp[i] = null
          break
        case 7:
        case 8:
        case 16:
        case 19:
        case 20:
          cp[i] = { tag, nameIndex: view.getUint16(offset) }; offset += 2
          break
        case 9:
        case 10:
        case 11:
        case 12:
        case 18:
          cp[i] = { tag, classIndex: view.getUint16(offset), nameAndTypeIndex: view.getUint16(offset + 2), nameIndex: view.getUint16(offset), descriptorIndex: view.getUint16(offset + 2) }; offset += 4
          break
        case 15:
          cp[i] = { tag }; offset += 3
          break
        default:
          return [`Constant pool: unsupported tag ${tag} at index ${i}`]
      }
    }
    const accessFlags = view.getUint16(offset); offset += 2
    const thisClass = view.getUint16(offset); offset += 2
    const superClass = view.getUint16(offset); offset += 2
    const lines = [
      `Constant pool entries: ${cpCount - 1}`,
      `Access flags: 0x${accessFlags.toString(16).padStart(4, '0')}`,
      `Class: ${className(cp, thisClass)}`,
      `Extends: ${superClass ? className(cp, superClass) : '(none)'}`,
    ]
    const interfaceCount = view.getUint16(offset); offset += 2
    if (interfaceCount) {
      const names: string[] = []
      for (let i = 0; i < interfaceCount; i++) {
        names.push(className(cp, view.getUint16(offset)))
        offset += 2
      }
      lines.push(`Implements: ${names.join(', ')}`)
    }
    const fields = memberNames(view, bytes, cp, offset)
    lines.push(...fields.lines)
    offset = fields.offset
    const methods = memberNames(view, bytes, cp, offset, 'Methods')
    lines.push(...methods.lines)
    return lines
  } catch (e) {
    return [`Class parser stopped: ${e instanceof Error ? e.message : String(e)}`]
  }
}

function utf8(cp: Array<{ tag: number; value?: string | number; nameIndex?: number } | null>, index: number): string {
  const entry = cp[index]
  return entry?.tag === 1 ? String(entry.value) : `#${index}`
}

function className(cp: Array<{ tag: number; value?: string | number; nameIndex?: number } | null>, index: number): string {
  const entry = cp[index]
  if (!entry || entry.tag !== 7 || !entry.nameIndex) return `#${index}`
  return utf8(cp, entry.nameIndex).replace(/\//g, '.')
}

function memberNames(
  view: DataView,
  bytes: Uint8Array,
  cp: Array<{ tag: number; value?: string | number; nameIndex?: number } | null>,
  offset: number,
  label = 'Fields',
): { offset: number; lines: string[] } {
  const count = view.getUint16(offset); offset += 2
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    offset += 2
    const nameIndex = view.getUint16(offset); offset += 2
    const descriptorIndex = view.getUint16(offset); offset += 2
    names.push(`${utf8(cp, nameIndex)} ${utf8(cp, descriptorIndex)}`)
    const attrCount = view.getUint16(offset); offset += 2
    for (let a = 0; a < attrCount; a++) {
      offset += 2
      const len = view.getUint32(offset); offset += 4 + len
      if (offset > bytes.length) throw new Error('member attribute exceeds file size')
    }
  }
  return { offset, lines: [`${label}: ${count}`, ...names.slice(0, 20).map((name) => `  - ${name}`), ...(names.length > 20 ? [`  ... ${names.length - 20} more`] : [])] }
}

function FileDropZone({
  accept,
  label,
  detail,
  onFile,
  multiple = false,
  onFiles,
}: {
  accept: string
  label: string
  detail: string
  onFile: (file: File) => void
  multiple?: boolean
  onFiles?: (files: File[]) => void
}) {
  const [dragging, setDragging] = useState(false)
  return (
    <label
      onDragEnter={(e) => { e.preventDefault(); setDragging(true) }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={(e) => { e.preventDefault(); setDragging(false) }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const files = Array.from(e.dataTransfer.files ?? [])
        if (files.length === 0) return
        if (multiple && onFiles) onFiles(files)
        else onFile(files[0])
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded border border-dashed px-4 py-6 text-center transition-colors',
        dragging ? 'border-accent bg-accent/10' : 'border-border-2 bg-surface-1 hover:border-accent/50 hover:bg-surface-2',
      )}
    >
      <UploadCloud size={22} className={dragging ? 'text-accent-light' : 'text-text-3'} />
      <span className="text-xs font-semibold text-text-1">{label}</span>
      <span className="text-[10px] text-text-4">{detail}</span>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length === 0) return
          if (multiple && onFiles) onFiles(files)
          else onFile(files[0])
          e.currentTarget.value = ''
        }}
      />
    </label>
  )
}

// =========== Docker Compose Generator ===========

type DockerOutTab = 'compose' | 'env' | 'readme'

interface DockerPreset {
  id: string
  label: string
  cat: string
  ports: string
  volumes?: string[]
  envVars?: Record<string, string>
  creds?: string
  yaml: string
}

interface DockerBundle { id: string; label: string; desc: string; includes: string[] }

const D_PRESETS: DockerPreset[] = [
  // -- Databases --------------------------------------------------------------
  {
    id: 'postgres', label: 'PostgreSQL 17', cat: 'Database', ports: '5432',
    volumes: ['postgres-data'], creds: 'app / app',
    envVars: { POSTGRES_DB: 'app', POSTGRES_USER: 'app', POSTGRES_PASSWORD: 'app' },
    yaml: [
      '  postgres:',
      '    image: postgres:17-alpine',
      '    restart: unless-stopped',
      '    ports:',
      '      - "5432:5432"',
      '    environment:',
      '      POSTGRES_DB: ${POSTGRES_DB:-app}',
      '      POSTGRES_USER: ${POSTGRES_USER:-app}',
      '      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-app}',
      '    volumes:',
      '      - postgres-data:/var/lib/postgresql/data',
      '    healthcheck:',
      '      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-app}"]',
      '      interval: 10s',
      '      timeout: 5s',
      '      retries: 5',
    ].join('\n'),
  },
  {
    id: 'mysql', label: 'MySQL 8.4', cat: 'Database', ports: '3306',
    volumes: ['mysql-data'], creds: 'app / app (root: root)',
    envVars: { MYSQL_DATABASE: 'app', MYSQL_USER: 'app', MYSQL_PASSWORD: 'app', MYSQL_ROOT_PASSWORD: 'root' },
    yaml: [
      '  mysql:',
      '    image: mysql:8.4',
      '    restart: unless-stopped',
      '    ports:',
      '      - "3306:3306"',
      '    environment:',
      '      MYSQL_DATABASE: ${MYSQL_DATABASE:-app}',
      '      MYSQL_USER: ${MYSQL_USER:-app}',
      '      MYSQL_PASSWORD: ${MYSQL_PASSWORD:-app}',
      '      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-root}',
      '    volumes:',
      '      - mysql-data:/var/lib/mysql',
      '    healthcheck:',
      '      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]',
      '      interval: 10s',
      '      timeout: 5s',
      '      retries: 5',
    ].join('\n'),
  },
  {
    id: 'mongo', label: 'MongoDB 8', cat: 'Database', ports: '27017',
    volumes: ['mongo-data'],
    envVars: { MONGO_DB: 'app' },
    yaml: [
      '  mongo:',
      '    image: mongo:8',
      '    restart: unless-stopped',
      '    ports:',
      '      - "27017:27017"',
      '    environment:',
      '      MONGO_INITDB_DATABASE: ${MONGO_DB:-app}',
      '    volumes:',
      '      - mongo-data:/data/db',
      '    healthcheck:',
      '      test: ["CMD", "mongosh", "--eval", "db.adminCommand(\'ping\')"]',
      '      interval: 10s',
      '      timeout: 5s',
      '      retries: 5',
    ].join('\n'),
  },
  {
    id: 'redis', label: 'Redis 7.4', cat: 'Database', ports: '6379',
    volumes: ['redis-data'],
    yaml: [
      '  redis:',
      '    image: redis:7.4-alpine',
      '    restart: unless-stopped',
      '    ports:',
      '      - "6379:6379"',
      '    command: ["redis-server", "--appendonly", "yes", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]',
      '    volumes:',
      '      - redis-data:/data',
      '    healthcheck:',
      '      test: ["CMD", "redis-cli", "ping"]',
      '      interval: 10s',
      '      timeout: 5s',
      '      retries: 5',
    ].join('\n'),
  },
  // -- Messaging --------------------------------------------------------------
  {
    id: 'kafka', label: 'Kafka 3.9 + UI', cat: 'Messaging', ports: '9092, 8082',
    volumes: ['kafka-data'],
    yaml: [
      '  kafka:',
      '    image: bitnami/kafka:3.9',
      '    restart: unless-stopped',
      '    ports:',
      '      - "9092:9092"',
      '    environment:',
      '      KAFKA_CFG_NODE_ID: 1',
      '      KAFKA_CFG_PROCESS_ROLES: controller,broker',
      '      KAFKA_CFG_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093',
      '      KAFKA_CFG_LISTENERS: PLAINTEXT://:9092,CONTROLLER://:9093',
      '      KAFKA_CFG_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092',
      '      KAFKA_CFG_CONTROLLER_LISTENER_NAMES: CONTROLLER',
      '      KAFKA_CFG_AUTO_CREATE_TOPICS_ENABLE: "true"',
      '    volumes:',
      '      - kafka-data:/bitnami/kafka',
      '  kafka-ui:',
      '    image: provectuslabs/kafka-ui:latest',
      '    restart: unless-stopped',
      '    ports:',
      '      - "8082:8080"',
      '    environment:',
      '      KAFKA_CLUSTERS_0_NAME: local',
      '      KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: kafka:9092',
      '    depends_on:',
      '      - kafka',
    ].join('\n'),
  },
  {
    id: 'rabbitmq', label: 'RabbitMQ 3.13', cat: 'Messaging', ports: '5672, 15672',
    volumes: ['rabbitmq-data'], creds: 'admin / admin',
    envVars: { RABBITMQ_USER: 'admin', RABBITMQ_PASS: 'admin' },
    yaml: [
      '  rabbitmq:',
      '    image: rabbitmq:3.13-management-alpine',
      '    restart: unless-stopped',
      '    ports:',
      '      - "5672:5672"',
      '      - "15672:15672"',
      '    environment:',
      '      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER:-admin}',
      '      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASS:-admin}',
      '    volumes:',
      '      - rabbitmq-data:/var/lib/rabbitmq',
      '    healthcheck:',
      '      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]',
      '      interval: 10s',
      '      timeout: 5s',
      '      retries: 5',
    ].join('\n'),
  },
  // -- Observability ----------------------------------------------------------
  {
    id: 'prometheus', label: 'Prometheus', cat: 'Observability', ports: '9090',
    volumes: ['prometheus-data'],
    yaml: [
      '  prometheus:',
      '    image: prom/prometheus:latest',
      '    restart: unless-stopped',
      '    ports:',
      '      - "9090:9090"',
      '    command:',
      '      - --config.file=/etc/prometheus/prometheus.yml',
      '      - --storage.tsdb.path=/prometheus',
      '      - --web.enable-lifecycle',
      '    volumes:',
      '      - prometheus-data:/prometheus',
    ].join('\n'),
  },
  {
    id: 'grafana', label: 'Grafana', cat: 'Observability', ports: '3000',
    volumes: ['grafana-data'], creds: 'admin / admin',
    envVars: { GRAFANA_USER: 'admin', GRAFANA_PASS: 'admin' },
    yaml: [
      '  grafana:',
      '    image: grafana/grafana:latest',
      '    restart: unless-stopped',
      '    ports:',
      '      - "3000:3000"',
      '    environment:',
      '      GF_SECURITY_ADMIN_USER: ${GRAFANA_USER:-admin}',
      '      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASS:-admin}',
      '      GF_USERS_ALLOW_SIGN_UP: "false"',
      '    volumes:',
      '      - grafana-data:/var/lib/grafana',
    ].join('\n'),
  },
  {
    id: 'jaeger', label: 'Jaeger', cat: 'Observability', ports: '16686, 4317',
    yaml: [
      '  jaeger:',
      '    image: jaegertracing/all-in-one:latest',
      '    restart: unless-stopped',
      '    ports:',
      '      - "16686:16686"',
      '      - "4317:4317"',
      '      - "4318:4318"',
      '    environment:',
      '      COLLECTOR_OTLP_ENABLED: "true"',
    ].join('\n'),
  },
  {
    id: 'otel', label: 'OTel Collector', cat: 'Observability', ports: '4317, 8888',
    yaml: [
      '  otel-collector:',
      '    image: otel/opentelemetry-collector-contrib:latest',
      '    restart: unless-stopped',
      '    ports:',
      '      - "4317:4317"',
      '      - "4318:4318"',
      '      - "8888:8888"',
      '      - "8889:8889"',
      '    # Mount your otel-collector-config.yaml to /etc/otelcol-contrib/config.yaml',
    ].join('\n'),
  },
  // -- API & Mocking ----------------------------------------------------------
  {
    id: 'mockapi', label: 'Mock API (Mockoon)', cat: 'API & Mocking', ports: '3001',
    yaml: [
      '  mock-api:',
      '    image: mockoon/cli:latest',
      '    restart: unless-stopped',
      '    ports:',
      '      - "3001:3000"',
      '    command: ["--data", "https://raw.githubusercontent.com/mockoon/mock-samples/main/samples/generate-mock-data.json", "--port", "3000"]',
    ].join('\n'),
  },
  // -- Mail ------------------------------------------------------------------
  {
    id: 'mailpit', label: 'Mailpit', cat: 'Mail', ports: '1025, 8025',
    yaml: [
      '  mailpit:',
      '    image: axllent/mailpit:latest',
      '    restart: unless-stopped',
      '    ports:',
      '      - "1025:1025"',
      '      - "8025:8025"',
      '    environment:',
      '      MP_SMTP_AUTH_ACCEPT_ANY: "true"',
      '      MP_SMTP_AUTH_ALLOW_INSECURE: "true"',
    ].join('\n'),
  },
]

const D_BUNDLES: DockerBundle[] = [
  { id: 'mock-pg',   label: 'REST Mock + PostgreSQL', desc: 'HTTP mock + relational DB',      includes: ['mockapi', 'postgres'] },
  { id: 'mock-kafka',label: 'REST Mock + Kafka',      desc: 'HTTP mock + event streaming',    includes: ['mockapi', 'kafka'] },
  { id: 'kafka-ui',  label: 'Kafka + UI',             desc: 'Kafka with web console',         includes: ['kafka'] },
  { id: 'observe',   label: 'Observability Stack',    desc: 'Prometheus + Grafana + Jaeger',  includes: ['prometheus', 'grafana', 'jaeger'] },
  { id: 'full-db',   label: 'All Databases',          desc: 'Postgres + MySQL + Mongo + Redis', includes: ['postgres', 'mysql', 'mongo', 'redis'] },
]

const D_CATS = ['Database', 'Messaging', 'Observability', 'API & Mocking', 'Mail']

function buildCompose(project: string, active: DockerPreset[]): string {
  if (!active.length) return `name: ${project || 'adomnia-lab'}\n\nservices:\n  # Select at least one preset above\n`
  const services = active.map((p) => p.yaml).join('\n\n')
  const vols = active.flatMap((p) => p.volumes ?? [])
  const volBlock = vols.length ? '\nvolumes:\n' + vols.map((v) => `  ${v}:`).join('\n') + '\n' : ''
  return `name: ${project || 'adomnia-lab'}\n\nservices:\n${services}\n${volBlock}`
}

function buildEnv(active: DockerPreset[]): string {
  const sections: string[] = ['# Generated by adOmnia · docker-compose .env\n']
  for (const p of active) {
    if (!p.envVars) continue
    sections.push(`# ${p.label}`)
    for (const [k, v] of Object.entries(p.envVars)) {
      sections.push(`${k}=${v}`)
    }
    sections.push('')
  }
  return sections.length > 1 ? sections.join('\n') : '# No configurable env vars for selected services.\n'
}

function buildReadme(project: string, active: DockerPreset[]): string {
  const name = project || 'adomnia-lab'
  const table = active.map((p) => `| ${p.label} | localhost:${p.ports.split(',')[0].trim()} | ${p.creds ?? '—'} |`).join('\n')
  const svcNames = active.map((p) => p.id)
  return [
    `# ${name} — Docker Lab`,
    '',
    `> Generated by **adOmnia** · ${new Date().toLocaleDateString()}`,
    '',
    '## Services',
    '',
    '| Service | Host | Credentials |',
    '|---------|------|-------------|',
    table || '| _(none selected)_ | — | — |',
    '',
    '## Start / Stop / Restart',
    '',
    '```bash',
    '# Start all services in background',
    `docker compose -p ${name} up -d`,
    '',
    '# Start only specific services',
    `docker compose -p ${name} up -d ${svcNames.slice(0, 2).join(' ')}`,
    '',
    '# Stop all (keep containers + volumes)',
    `docker compose -p ${name} stop`,
    '',
    '# Stop + remove containers (keep volumes)',
    `docker compose -p ${name} down`,
    '',
    '# Stop + remove containers AND volumes',
    `docker compose -p ${name} down -v`,
    '',
    '# Restart a single service',
    `docker compose -p ${name} restart <service-name>`,
    '```',
    '',
    '## Logs',
    '',
    '```bash',
    '# Follow all logs',
    `docker compose -p ${name} logs -f`,
    '',
    '# Follow a single service',
    `docker compose -p ${name} logs -f <service-name>`,
    '',
    '# Last 100 lines',
    `docker compose -p ${name} logs --tail=100`,
    '```',
    '',
    '## Live Config Changes',
    '',
    '```bash',
    '# After editing docker-compose.yml — recreate changed containers only',
    `docker compose -p ${name} up -d --no-deps <service-name>`,
    '',
    '# Force recreate all containers',
    `docker compose -p ${name} up -d --force-recreate`,
    '',
    '# Pull latest images then recreate',
    `docker compose -p ${name} pull && docker compose -p ${name} up -d`,
    '```',
    '',
    '## Inspect',
    '',
    '```bash',
    '# Status of all services',
    `docker compose -p ${name} ps`,
    '',
    '# Resource usage (CPU/RAM)',
    `docker compose -p ${name} top`,
    '',
    '# Open shell in a container',
    `docker compose -p ${name} exec <service-name> sh`,
    '```',
    '',
    '## Notes',
    '',
    '- All data is persisted in named Docker volumes — safe to restart containers.',
    '- Place `.env` next to `docker-compose.yml` to override default credentials.',
    '- Run `docker compose pull` periodically to get security patches.',
  ].join('\n')
}

function DockerGenerator() {
  const [selected, setSelected] = useState<string[]>([])
  const [project, setProject] = useState('adomnia-lab')
  const [outTab, setOutTab] = useState<DockerOutTab>('compose')
  const [output, setOutput] = useState<{ compose: string; env: string; readme: string } | null>(null)

  const toggle = (id: string) =>
    setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])

  const applyBundle = (b: DockerBundle) =>
    setSelected((s) => Array.from(new Set([...s, ...b.includes])))

  const generate = () => {
    const active = D_PRESETS.filter((p) => selected.includes(p.id))
    setOutput({
      compose: buildCompose(project, active),
      env:     buildEnv(active),
      readme:  buildReadme(project, active),
    })
    setOutTab('compose')
  }

  const currentOut = output ? output[outTab] : ''
  const filename: Record<DockerOutTab, string> = { compose: 'docker-compose.yml', env: '.env', readme: 'README.md' }

  return (
    <div className="flex flex-col gap-4">
      {/* Project name */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-3 w-24 shrink-0">Project name</span>
        <input
          value={project}
          onChange={(e) => setProject(e.target.value)}
          placeholder="adomnia-lab"
          className="h-7 w-48 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 focus:border-accent outline-none"
        />
      </div>

      {/* Bundles */}
      <div>
        <p className="text-[10px] font-semibold text-text-4 uppercase tracking-wider mb-1.5">Quick bundles</p>
        <div className="flex flex-wrap gap-2">
          {D_BUNDLES.map((b) => (
            <button
              key={b.id}
              onClick={() => applyBundle(b)}
              title={b.desc}
              className="px-2.5 py-1 rounded border border-border-2 bg-surface-1 text-xs text-text-2 hover:bg-surface-2 hover:text-text-1 transition-colors"
            >
              {b.label}
            </button>
          ))}
          <button
            onClick={() => setSelected([])}
            className="px-2.5 py-1 rounded border border-border-2 bg-surface-1 text-xs text-error hover:bg-error/10 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Preset checkboxes by category */}
      <div className="flex flex-col gap-3">
        {D_CATS.map((cat) => {
          const presets = D_PRESETS.filter((p) => p.cat === cat)
          return (
            <div key={cat}>
              <p className="text-[10px] font-semibold text-text-4 uppercase tracking-wider mb-1.5">{cat}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {presets.map((p) => (
                  <label
                    key={p.id}
                    className={cn(
                      'flex items-center gap-2 rounded border px-3 py-2 text-xs cursor-pointer transition-colors',
                      selected.includes(p.id)
                        ? 'border-accent/50 bg-accent/10 text-text-1'
                        : 'border-border-2 bg-surface-1 text-text-2 hover:bg-surface-2',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(p.id)}
                      onChange={() => toggle(p.id)}
                      className="accent-accent"
                    />
                    <span className="flex-1">{p.label}</span>
                    <span className="text-[9px] text-text-4 font-mono">{p.ports}</span>
                  </label>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Generate button */}
      <button
        onClick={generate}
        disabled={selected.length === 0}
        className="self-start px-4 py-1.5 bg-accent text-white rounded text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
      >
        Generate ({selected.length} service{selected.length !== 1 ? 's' : ''})
      </button>

      {/* Output tabs */}
      {output && (
        <div className="flex flex-col gap-0 rounded border border-border-1 overflow-hidden">
          <div className="flex border-b border-border-1 bg-surface-1">
            {(['compose', 'env', 'readme'] as DockerOutTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setOutTab(tab)}
                className={cn(
                  'px-3 py-1.5 text-xs font-mono transition-colors',
                  outTab === tab ? 'bg-surface-2 text-text-1 border-b-2 border-accent' : 'text-text-3 hover:text-text-1',
                )}
              >
                {filename[tab]}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={() => copy(currentOut)}
              title="Copy to clipboard"
              className="px-3 py-1.5 text-text-3 hover:text-text-1 transition-colors"
            >
              <Copy size={12} />
            </button>
            <button
              onClick={() => downloadText(filename[outTab], currentOut, outTab === 'compose' ? 'text/yaml' : 'text/plain')}
              title="Download file"
              className="px-3 py-1.5 text-text-3 hover:text-text-1 transition-colors border-l border-border-1"
            >
              <Download size={12} />
            </button>
          </div>
          <pre className="px-4 py-3 bg-surface-0 text-xs text-text-2 font-mono whitespace-pre overflow-x-auto max-h-80">{currentOut}</pre>
        </div>
      )}
    </div>
  )
}

const FOLDER_DIFF_STATUS_LABEL: Record<FolderDiffStatus, string> = {
  same: 'Same',
  modified: 'Modified',
  'left-only': 'Left only',
  'right-only': 'Right only',
  'type-change': 'Type changed',
}

const FOLDER_DIFF_STATUS_CLASS: Record<FolderDiffStatus, string> = {
  same: 'border-border-2 bg-surface-2 text-text-4',
  modified: 'border-warning/30 bg-warning/10 text-warning',
  'left-only': 'border-accent/30 bg-accent/10 text-accent-light',
  'right-only': 'border-info/30 bg-info/10 text-info',
  'type-change': 'border-error/30 bg-error/10 text-error',
}

function formatDiffBytes(size?: number) {
  if (size == null) return '-'
  if (size === 0) return '0 B'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatDiffDate(value?: number) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function findFolderDiffNode(nodes: FolderDiffNode[], path: string): FolderDiffNode | null {
  for (const node of nodes) {
    if (node.path === path) return node
    const child = node.children ? findFolderDiffNode(node.children, path) : null
    if (child) return child
  }
  return null
}

function FolderDiffPreviewPane({ preview }: { preview: FolderDiffPreview }) {
  const leftLines = preview.left.split(/\r?\n/)
  const rightLines = preview.right.split(/\r?\n/)
  const total = Math.max(leftLines.length, rightLines.length)
  const lines = Array.from({ length: Math.min(total, 500) }, (_, index) => ({
    number: index + 1,
    left: leftLines[index] ?? '',
    right: rightLines[index] ?? '',
    changed: leftLines[index] !== rightLines[index],
    leftMissing: index >= leftLines.length,
    rightMissing: index >= rightLines.length,
  }))

  return (
    <div className="grid min-h-0 grid-cols-1 gap-3 lg:grid-cols-2">
      {(['left', 'right'] as const).map((side) => (
        <div key={side} className="min-h-0 rounded border border-border-1 bg-surface-1">
          <div className="flex h-8 items-center justify-between border-b border-border-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-text-3">
            <span>{side === 'left' ? 'Left' : 'Right'}</span>
            {(side === 'left' ? preview.leftError : preview.rightError) && (
              <span className="normal-case tracking-normal text-error">{side === 'left' ? preview.leftError : preview.rightError}</span>
            )}
          </div>
          <div className="max-h-[420px] overflow-auto text-[11px]">
            {lines.map((line) => {
              const text = side === 'left' ? line.left : line.right
              const missing = side === 'left' ? line.leftMissing : line.rightMissing
              return (
                <div
                  key={`${side}-${line.number}`}
                  className={cn(
                    'grid grid-cols-[48px_1fr] border-b border-border-1/50 font-mono leading-5',
                    line.changed && !missing ? 'bg-warning/10 text-text-1' : 'text-text-2',
                    missing && 'bg-error/10 text-text-4',
                  )}
                >
                  <span className="select-none border-r border-border-1 px-2 text-right text-text-4">{line.number}</span>
                  <span className="whitespace-pre px-2">{missing ? '(missing)' : text}</span>
                </div>
              )
            })}
            {total > lines.length && <div className="px-3 py-2 text-[10px] text-text-4">Preview limited to first {lines.length} lines.</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

function FolderDiffTool() {
  const port = useServerPort()
  const [left, setLeft] = useState('')
  const [right, setRight] = useState('')
  const [maxFileMB, setMaxFileMB] = useState(20)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<FolderDiffResult | null>(null)
  const [selected, setSelected] = useState<FolderDiffNode | null>(null)
  const [preview, setPreview] = useState<FolderDiffPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [filter, setFilter] = useState<FolderDiffStatus | 'all'>('all')

  const visibleEntries = useMemo(() => {
    if (!result) return []
    return result.flat.filter((entry) => filter === 'all' || entry.status === filter)
  }, [filter, result])

  const selectFolder = async (side: 'left' | 'right') => {
    try {
      const path = await safeSelectFolder(side === 'left' ? 'Select left folder' : 'Select right folder')
      if (!path) return
      if (side === 'left') setLeft(path)
      else setRight(path)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Folder selection failed.')
    }
  }

  const scan = async () => {
    const url = serverUrl(port, '/folderdiff/scan')
    if (!url) {
      setError('Backend helper not ready.')
      return
    }
    if (!left.trim() || !right.trim()) {
      setError('Select or type both left and right folder paths before comparing.')
      return
    }
    setLoading(true)
    setError('')
    setPreview(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ left, right, maxFileMB }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json() as FolderDiffResult
      setResult(data)
      const firstInteresting = data.flat.find((item) => item.status !== 'same')
      setSelected(firstInteresting ? findFolderDiffNode(data.tree, firstInteresting.path) : data.tree[0] ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message.trim() : 'Folder comparison failed.')
      setResult(null)
      setSelected(null)
    } finally {
      setLoading(false)
    }
  }

  const loadPreview = async (node: FolderDiffNode) => {
    if (!result || node.isDir || node.binary) return
    const url = serverUrl(port, '/folderdiff/file')
    if (!url) return
    setPreviewLoading(true)
    setPreview(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leftRoot: result.leftRoot, rightRoot: result.rightRoot, path: node.path, maxBytes: maxFileMB * 1024 * 1024 }),
      })
      if (!res.ok) throw new Error(await res.text())
      setPreview(await res.json() as FolderDiffPreview)
    } catch (err) {
      setPreview({
        path: node.path,
        left: '',
        right: '',
        leftError: err instanceof Error ? err.message.trim() : 'Preview failed',
      })
    } finally {
      setPreviewLoading(false)
    }
  }

  const selectNode = (node: FolderDiffNode) => {
    setSelected(node)
    setPreview(null)
    if (!node.isDir && !node.binary) {
      void loadPreview(node)
    }
  }

  const exportReport = () => {
    if (!result) return
    downloadText('folder-diff-report.json', JSON.stringify(result, null, 2), 'application/json')
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="grid gap-2 lg:grid-cols-[1fr_1fr_150px_auto]">
        <div className="flex min-w-0 overflow-hidden rounded border border-border-2 bg-surface-2 focus-within:border-accent">
          <input
            value={left}
            onChange={(e) => setLeft(e.target.value)}
            placeholder="Left folder path, e.g. C:\\builds\\old"
            className="h-8 min-w-0 flex-1 bg-transparent px-2 font-mono text-xs text-text-1 outline-none placeholder:text-text-4"
          />
          <button onClick={() => void selectFolder('left')} title="Select left folder" className="grid h-8 w-8 place-items-center border-l border-border-2 text-text-3 hover:bg-surface-3 hover:text-text-1">
            <FolderTree size={13} />
          </button>
        </div>
        <div className="flex min-w-0 overflow-hidden rounded border border-border-2 bg-surface-2 focus-within:border-accent">
          <input
            value={right}
            onChange={(e) => setRight(e.target.value)}
            placeholder="Right folder path, e.g. C:\\builds\\new"
            className="h-8 min-w-0 flex-1 bg-transparent px-2 font-mono text-xs text-text-1 outline-none placeholder:text-text-4"
          />
          <button onClick={() => void selectFolder('right')} title="Select right folder" className="grid h-8 w-8 place-items-center border-l border-border-2 text-text-3 hover:bg-surface-3 hover:text-text-1">
            <FolderTree size={13} />
          </button>
        </div>
        <label className="grid grid-cols-[1fr_56px] items-center gap-2 rounded border border-border-2 bg-surface-2 px-2 text-[10px] uppercase tracking-wider text-text-4">
          Preview MB
          <input
            value={maxFileMB}
            min={1}
            max={200}
            type="number"
            onChange={(e) => setMaxFileMB(Number(e.target.value) || 20)}
            className="h-7 min-w-0 bg-transparent text-right text-xs text-text-1 outline-none"
          />
        </label>
        <button onClick={scan} disabled={loading} className="h-8 px-3 bg-accent text-white rounded text-xs font-medium disabled:opacity-50">
          {loading ? 'Scanning...' : 'Compare'}
        </button>
      </div>

      {error && <div className="rounded border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</div>}

      {result && (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded border border-border-1 bg-surface-1 p-2">
            {(['all', 'left-only', 'right-only', 'modified', 'same'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={cn(
                  'rounded border px-2.5 py-1 text-[11px] transition-colors',
                  status === 'all' ? 'border-border-2 bg-surface-2 text-text-2' : FOLDER_DIFF_STATUS_CLASS[status],
                  filter === status && 'ring-1 ring-accent/70',
                )}
              >
                {status === 'all' ? 'All' : status === 'left-only' ? 'Solo sinistra' : status === 'right-only' ? 'Solo destra' : FOLDER_DIFF_STATUS_LABEL[status]}
                <span className="ml-1 text-text-4">{status === 'all' ? result.flat.length : result.counts[status] ?? 0}</span>
              </button>
            ))}
            <button onClick={() => copy(JSON.stringify(result.flat.filter((item) => item.status !== 'same'), null, 2))} className="ml-auto rounded border border-border-2 bg-surface-2 px-2 py-1 text-[11px] text-text-2 hover:text-text-1">
              Copy changed list
            </button>
            <button onClick={exportReport} className="rounded border border-border-2 bg-surface-2 px-2 py-1 text-[11px] text-text-2 hover:text-text-1">
              Download report
            </button>
          </div>

          {result.flat.length > 0 && (result.counts.modified ?? 0) + (result.counts['left-only'] ?? 0) + (result.counts['right-only'] ?? 0) + (result.counts['type-change'] ?? 0) === 0 && (
            <div className="rounded border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">No differences found. The two folders contain the same files.</div>
          )}

          <div className="grid min-h-[560px] gap-3 xl:grid-cols-[minmax(640px,1.15fr)_minmax(420px,.85fr)]">
            <div className="min-h-0 overflow-hidden rounded border border-border-1 bg-surface-1">
              <div className="flex h-8 items-center justify-between border-b border-border-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-text-3">
                <span>Comparative diff</span>
                <span>{visibleEntries.length} / {result.flat.length} entries</span>
              </div>
              <div className="max-h-[560px] overflow-auto">
                <table className="min-w-[980px] w-full border-separate border-spacing-0 text-left text-[11px]">
                  <thead className="sticky top-0 z-10 bg-surface-2 text-[10px] uppercase tracking-wider text-text-4">
                    <tr>
                      <th className="border-b border-border-1 px-3 py-2 font-semibold">Relative path</th>
                      <th className="border-b border-border-1 px-2 py-2 font-semibold">Status</th>
                      <th className="border-b border-border-1 px-2 py-2 font-semibold">Left</th>
                      <th className="border-b border-border-1 px-2 py-2 font-semibold">Right</th>
                      <th className="border-b border-border-1 px-2 py-2 text-right font-semibold">Left size</th>
                      <th className="border-b border-border-1 px-2 py-2 text-right font-semibold">Right size</th>
                      <th className="border-b border-border-1 px-2 py-2 font-semibold">Left modified</th>
                      <th className="border-b border-border-1 px-2 py-2 font-semibold">Right modified</th>
                      <th className="border-b border-border-1 px-2 py-2 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleEntries.map((entry) => {
                      const node = findFolderDiffNode(result.tree, entry.path)
                      const selectedRow = selected?.path === entry.path
                      return (
                        <tr
                          key={entry.path}
                          onClick={() => node && selectNode(node)}
                          className={cn(
                            'cursor-pointer border-b border-border-1/60 text-text-2 hover:bg-surface-2',
                            selectedRow && 'bg-accent/10 text-text-1',
                            entry.status === 'left-only' && 'bg-accent/5',
                            entry.status === 'right-only' && 'bg-info/5',
                            entry.status === 'modified' && 'bg-warning/5',
                            entry.status === 'type-change' && 'bg-error/5',
                          )}
                        >
                          <td className="border-b border-border-1/50 px-3 py-2">
                            <div className="flex min-w-0 items-center gap-2">
                              {entry.isDir ? <FolderTree size={13} className="shrink-0 text-accent-light" /> : <FileText size={13} className="shrink-0 text-text-4" />}
                              <span className="truncate font-mono">{entry.path}</span>
                            </div>
                          </td>
                          <td className="border-b border-border-1/50 px-2 py-2">
                            <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', FOLDER_DIFF_STATUS_CLASS[entry.status])}>
                              {FOLDER_DIFF_STATUS_LABEL[entry.status]}
                            </span>
                          </td>
                          <td className="border-b border-border-1/50 px-2 py-2">{entry.status !== 'right-only' ? 'Yes' : '-'}</td>
                          <td className="border-b border-border-1/50 px-2 py-2">{entry.status !== 'left-only' ? 'Yes' : '-'}</td>
                          <td className="border-b border-border-1/50 px-2 py-2 text-right font-mono text-text-3">{entry.isDir ? '-' : formatDiffBytes(entry.leftSize)}</td>
                          <td className="border-b border-border-1/50 px-2 py-2 text-right font-mono text-text-3">{entry.isDir ? '-' : formatDiffBytes(entry.rightSize)}</td>
                          <td className="border-b border-border-1/50 px-2 py-2 text-text-3">{formatDiffDate(entry.leftModified)}</td>
                          <td className="border-b border-border-1/50 px-2 py-2 text-text-3">{formatDiffDate(entry.rightModified)}</td>
                          <td className="border-b border-border-1/50 px-2 py-2">
                            {!entry.isDir && !entry.binary ? (
                              <button onClick={(e) => { e.stopPropagation(); if (node) selectNode(node) }} className="rounded border border-border-2 bg-surface-2 px-2 py-1 text-[10px] text-text-2 hover:text-text-1">
                                Open diff
                              </button>
                            ) : (
                              <span className="text-[10px] text-text-4">{entry.isDir ? 'Folder' : 'Binary'}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {visibleEntries.length === 0 && (
                  <div className="px-3 py-10 text-center text-xs text-text-4">No entries match this filter.</div>
                )}
              </div>
            </div>

            <div className="min-w-0 rounded border border-border-1 bg-surface-0 p-3">
              {selected ? (
                <div className="flex min-h-0 flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-text-1">{selected.path}</span>
                    <span className={cn('rounded border px-2 py-0.5 text-[10px]', FOLDER_DIFF_STATUS_CLASS[selected.status])}>{FOLDER_DIFF_STATUS_LABEL[selected.status]}</span>
                    {selected.binary && <span className="rounded border border-border-2 bg-surface-2 px-2 py-0.5 text-[10px] text-text-4">Binary</span>}
                    <span className="ml-auto text-[10px] text-text-4">L {formatDiffBytes(selected.leftSize)} / R {formatDiffBytes(selected.rightSize)}</span>
                  </div>
                  {selected.isDir ? (
                    <div className="rounded border border-border-1 bg-surface-1 px-3 py-8 text-center text-xs text-text-4">
                      Directory selected. Pick a file to inspect text differences.
                    </div>
                  ) : selected.binary ? (
                    <div className="rounded border border-border-1 bg-surface-1 px-3 py-8 text-center text-xs text-text-4">
                      Binary preview is disabled. Size and hash are still used for comparison.
                    </div>
                  ) : previewLoading ? (
                    <div className="rounded border border-border-1 bg-surface-1 px-3 py-8 text-center text-xs text-text-4">Loading preview...</div>
                  ) : preview ? (
                    <FolderDiffPreviewPane preview={preview} />
                  ) : (
                    <button onClick={() => void loadPreview(selected)} className="self-start rounded bg-accent px-3 py-1.5 text-xs font-medium text-white">Load preview</button>
                  )}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-text-4">Run a comparison and select an entry.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// =========== HMAC Generator ===========

function HmacTool() {
  const [input, setInput] = useState('{"event":"payment.succeeded","id":"evt_1001"}')
  const [secret, setSecret] = useState('local-webhook-secret')
  const [algorithm, setAlgorithm] = useState('SHA-256')
  const [output, setOutput] = useState('')

  const generate = async () => {
    try {
      const enc = new TextEncoder()
      const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: algorithm }, false, ['sign'])
      const sig = await crypto.subtle.sign('HMAC', key, enc.encode(input))
      setOutput(Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join(''))
    } catch {
      setOutput('Generation error')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value)} className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none">
          <option>SHA-1</option>
          <option>SHA-256</option>
          <option>SHA-384</option>
          <option>SHA-512</option>
        </select>
      </div>
      <input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Secret key" className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none" />
      <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Data to sign" rows={3} className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none" />
      <button onClick={generate} className="self-start px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Generate HMAC</button>
      {output && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono break-all">{output}</pre>}
    </div>
  )
}

// =========== Main Panel ===========

export function UtilsPanel() {
  const port = useServerPort()
  const [activeTool, setActiveTool] = useState('jsondiff')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // Tool state
  const [uuids, setUuids] = useState<string[]>([uuidv4()])
  const [uuidCount, setUuidCount] = useState(1)
  const [b64Input, setB64Input] = useState('adomnia:local-first-api-toolbox')
  const [b64Output, setB64Output] = useState('')
  const [urlInput, setUrlInput] = useState('https://api.local/v1/payments?status=paid&limit=20')
  const [urlOutput, setUrlOutput] = useState('')
  const [jyInput, setJyInput] = useState('{\n  "service": "payments",\n  "enabled": true,\n  "retries": 3\n}')
  const [jyOutput, setJyOutput] = useState('')
  const [hashInput, setHashInput] = useState('{"orderId":"ord_1001","amount":4990,"currency":"EUR"}')
  const [hashOutput, setHashOutput] = useState('')
  const [hashAlgo, setHashAlgo] = useState('SHA-256')
  const [jwtInput, setJwtInput] = useState('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZW1vLXVzZXIiLCJzY29wZSI6ImFkbWluOnJlYWQiLCJleHAiOjQxMDI0NDQ4MDB9.signature')
  const [jwtOutput, setJwtOutput] = useState<object | null>(null)
  const [pwLength, setPwLength] = useState(16)
  const [pwUpper, setPwUpper] = useState(true)
  const [pwNum, setPwNum] = useState(true)
  const [pwSym, setPwSym] = useState(true)
  const [pwOutput, setPwOutput] = useState('')
  const [tsInput, setTsInput] = useState('1715774400')
  const [tsOutput, setTsOutput] = useState<ReturnType<typeof formatTimestamp> | null>(null)
  const [fakeCount, setFakeCount] = useState(5)
  const [fakeType, setFakeType] = useState('name')
  const [fakeOutput, setFakeOutput] = useState('')
  const [queryInput, setQueryInput] = useState('https://api.local/v1/payments?status=paid&limit=20&tenant=demo')
  const [queryOutput, setQueryOutput] = useState('')
  const [diffMode, setDiffMode] = useState<'json' | 'xml'>('json')
  const [diffLeft, setDiffLeft] = useState('{\n  "id": "pay_1001",\n  "status": "pending",\n  "amount": 4990,\n  "customer": {\n    "id": "cus_42",\n    "tier": "standard"\n  },\n  "metadata": {\n    "source": "checkout"\n  }\n}')
  const [diffRight, setDiffRight] = useState('{\n  "id": "pay_1001",\n  "status": "succeeded",\n  "amount": 4990,\n  "customer": {\n    "id": "cus_42",\n    "tier": "enterprise"\n  },\n  "metadata": {\n    "source": "checkout",\n    "traceId": "trc_9f31"\n  }\n}')
  const [xmlDiffLeft, setXmlDiffLeft] = useState('<Payment id="pay_1001">\n  <Status>pending</Status>\n  <Amount currency="EUR">4990</Amount>\n  <Customer id="cus_42" tier="standard" />\n</Payment>')
  const [xmlDiffRight, setXmlDiffRight] = useState('<Payment id="pay_1001">\n  <Status>succeeded</Status>\n  <Amount currency="EUR">4990</Amount>\n  <Customer id="cus_42" tier="enterprise" />\n  <Trace id="trc_9f31" />\n</Payment>')
  const [graphInput, setGraphInput] = useState('{"payment":{"id":"pay_1001","events":[{"type":"created"},{"type":"captured"}],"risk":{"score":12,"review":false}}}')
  const [xmlInput, setXmlInput] = useState('<Envelope><Body><GetPayment id="pay_1001"/></Body></Envelope>')
  const [xmlOutput, setXmlOutput] = useState('')
  const [xmlValidOutput, setXmlValidOutput] = useState('')
  const [yamlValInput, setYamlValInput] = useState('service: payments\nport: 8080\nfeatures:\n  refunds: true\n  webhooks: true')
  const [yamlValOutput, setYamlValOutput] = useState('')
  const [yamlFileResults, setYamlFileResults] = useState<YamlFileResult[]>([])
  const [pemInput, setPemInput] = useState('-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUadOmniaDemoCertificateOnly\n-----END CERTIFICATE-----')
  const [pemOutput, setPemOutput] = useState('')
  const [pemFileName, setPemFileName] = useState('')
  const [jksPassword, setJksPassword] = useState('changeit')
  const [jksAlias, setJksAlias] = useState('')
  const [jksSplit, setJksSplit] = useState<{ certPem: string; keyPem: string; warning?: string } | null>(null)
  const [classInput, setClassInput] = useState('CAFEBABE00000034001D')
  const [classOutput, setClassOutput] = useState('')
  const [classFileName, setClassFileName] = useState('')
  const [httpFilter, setHttpFilter] = useState('')

  // Network tools
  const [dnsHost, setDnsHost] = useState('example.com')
  const [dnsType, setDnsType] = useState('A')
  const [dnsOutput, setDnsOutput] = useState('')
  const [scanHost, setScanHost] = useState('localhost')
  const [scanPorts, setScanPorts] = useState('80,443,8080')
  const [scanOutput, setScanOutput] = useState('')
  const [corsUrl, setCorsUrl] = useState('http://localhost:8080/api/health')
  const [corsOrigin, setCorsOrigin] = useState('https://your-domain.com')
  const [corsMethod, setCorsMethod] = useState('GET')
  const [corsOutput, setCorsOutput] = useState('')

  const fetchApi = async (path: string, body?: object) => {
    const url = serverUrl(port, path)
    if (!url) return null
    try {
      const res = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      return res.json()
    } catch {
      return null
    }
  }

  const handlePemFile = async (file: File) => {
    const { text, bytes } = await readFileSmart(file)
    setPemFileName(file.name)
    setPemInput(text.includes('-----BEGIN ') ? text : bytesToHex(bytes))
    setPemOutput(pemOrJksInspect(text, bytes, file.name))
    setJksSplit(null)
    if (file.name.toLowerCase().endsWith('.jks')) {
      const url = serverUrl(port, '/cert/jks-split')
      if (!url) {
        setPemOutput((current) => `${current}\n\nJKS split: backend not ready`)
        return
      }
      const form = new FormData()
      form.append('jks', file)
      form.append('password', jksPassword)
      form.append('alias', jksAlias)
      try {
        const res = await fetch(url, { method: 'POST', body: form })
        const textOut = await res.text()
        if (!res.ok) {
          setPemOutput((current) => `${current}\n\nJKS split failed: ${textOut}`)
          return
        }
        const data = JSON.parse(textOut) as { certPem: string; keyPem: string; warning?: string }
        setJksSplit(data)
        setPemOutput((current) => `${current}\n\nJKS split ready: certificate PEM and private key PEM extracted locally.`)
      } catch (e) {
        setPemOutput((current) => `${current}\n\nJKS split failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const handleClassFile = async (file: File) => {
    const { bytes } = await readFileSmart(file)
    const hex = bytesToHex(bytes)
    setClassFileName(file.name)
    setClassInput(hex)
    setClassOutput(classInspect(hex))
  }

  const handleYamlFiles = async (files: File[]) => {
    const results: YamlFileResult[] = []
    const chunks: string[] = []
    for (const file of files) {
      const { text } = await readFileSmart(file)
      const result = yamlValidateResult(text)
      results.push({ name: file.name, ok: result.ok, message: result.message })
      chunks.push(`# ${file.name}\n${text}`)
    }
    setYamlFileResults(results)
    setYamlValInput(chunks.join('\n\n---\n\n'))
    const failed = results.filter((result) => !result.ok)
    setYamlValOutput(failed.length === 0
      ? `Valid YAML: ${results.length} file${results.length === 1 ? '' : 's'} checked with no errors`
      : `Invalid YAML: ${failed.length} of ${results.length} file${results.length === 1 ? '' : 's'} failed`
    )
  }

  const sha256 = async (s: string, algo: string) => {
    try {
      const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(s))
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
    } catch { return 'Hash not available' }
  }

  const decodeJWT = (token: string) => {
    try {
      const parts = token.split('.')
      if (parts.length !== 3) return { error: 'Not a valid JWT (expected 3 parts)' }
      const decode = (s: string) => JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/')))
      return { header: decode(parts[0]), payload: decode(parts[1]), signature: parts[2] }
    } catch { return { error: 'Failed to decode JWT' } }
  }

  const generateFake = (type: string, count: number) => {
    const results: string[] = []
    for (let i = 0; i < count; i++) {
      switch (type) {
        case 'name': results.push(fakeName()); break
        case 'email': results.push(fakeEmail()); break
        case 'phone': results.push(fakePhone()); break
        case 'ip': results.push(fakeIP()); break
        case 'words': results.push(fakeWords(5)); break
      }
    }
    return results.join('\n')
  }

  const toggleCat = (label: string) => {
    setCollapsed((c) => ({ ...c, [label]: !c[label] }))
  }

  const statusClass = (code: number) => {
    if (code >= 500) return 'text-error'
    if (code >= 400) return 'text-warning'
    if (code >= 300) return 'text-info'
    if (code >= 200) return 'text-success'
    return 'text-text-4'
  }

  const allTools = CATEGORIES.flatMap((cat) =>
    cat.tools.map((tool) => ({
      ...tool,
      ...TOOL_DETAILS[tool.id],
      category: cat.label,
    }))
  )
  const activeMeta = allTools.find((tool) => tool.id === activeTool) ?? allTools[0]
  const totalTools = allTools.length
  const liveDiff = useMemo(
    () => diffMode === 'json' ? buildJsonDiff(diffLeft, diffRight) : buildXmlDiff(xmlDiffLeft, xmlDiffRight),
    [diffLeft, diffRight, diffMode, xmlDiffLeft, xmlDiffRight],
  )
  const liveDiffCounts = useMemo(() => diffCounts(liveDiff.rows), [liveDiff.rows])

  const renderTool = () => {
    switch (activeTool) {
      // ---- Encoding ----
      case 'base64':
        return (
          <div className="flex flex-col gap-3">
            <textarea value={b64Input} onChange={(e) => setB64Input(e.target.value)} placeholder="Enter text or base64..." rows={4} className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none" />
            <div className="flex gap-2">
              <button onClick={() => { try { setB64Output(btoa(unescape(encodeURIComponent(b64Input)))) } catch { setB64Output('Invalid input') } }} className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Encode</button>
              <button onClick={() => { try { setB64Output(decodeURIComponent(escape(atob(b64Input)))) } catch { setB64Output('Invalid base64') } }} className="px-3 py-1.5 bg-surface-2 text-text-2 border border-border-2 rounded text-xs">Decode</button>
            </div>
            {b64Output && (
              <div className="relative group">
                <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono whitespace-pre-wrap break-all">{b64Output}</pre>
                <button onClick={() => copy(b64Output)} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 text-text-4 hover:text-text-1"><Copy size={12} /></button>
              </div>
            )}
          </div>
        )

      case 'url':
        return (
          <div className="flex flex-col gap-3">
            <textarea value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="Enter URL or URL-encoded string..." rows={3} className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none" />
            <div className="flex gap-2">
              <button onClick={() => { try { setUrlOutput(encodeURIComponent(urlInput)) } catch { setUrlOutput('Encode error') } }} className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Encode</button>
              <button onClick={() => { try { setUrlOutput(decodeURIComponent(urlInput)) } catch { setUrlOutput('Decode error') } }} className="px-3 py-1.5 bg-surface-2 text-text-2 border border-border-2 rounded text-xs">Decode</button>
            </div>
            {urlOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono break-all">{urlOutput}</pre>}
          </div>
        )

      case 'jsonyaml':
        return (
          <div className="flex flex-col gap-3">
            <textarea value={jyInput} onChange={(e) => setJyInput(e.target.value)} placeholder="Paste JSON or YAML..." rows={6} className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none" />
            <div className="flex gap-2">
              <button onClick={() => { try { setJyOutput(jsonToYaml(JSON.parse(jyInput))) } catch { setJyOutput('Invalid JSON') } }} className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">{'JSON -> YAML'}</button>
              <button onClick={() => setJyOutput(yamlToJson(jyInput))} className="px-3 py-1.5 bg-surface-2 text-text-2 border border-border-2 rounded text-xs">{'YAML -> JSON'}</button>
            </div>
            {jyOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono whitespace-pre-wrap max-h-64 overflow-auto">{jyOutput}</pre>}
          </div>
        )

      // ---- Crypto & Auth ----
      case 'hash':
        return (
          <div className="flex flex-col gap-3">
            <select value={hashAlgo} onChange={(e) => setHashAlgo(e.target.value)} className="w-32 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none">
              <option>MD5</option>
              <option>SHA-1</option>
              <option>SHA-256</option>
              <option>SHA-512</option>
            </select>
            <textarea value={hashInput} onChange={(e) => setHashInput(e.target.value)} placeholder="Enter text to hash..." rows={3} className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none" />
            <button onClick={() => sha256(hashInput, hashAlgo).then(setHashOutput)} className="self-start px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Hash</button>
            {hashOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono break-all">{hashOutput}</pre>}
          </div>
        )

      case 'hmac':
        return <HmacTool />

      case 'jwt':
        return (
          <div className="flex flex-col gap-3">
            <textarea value={jwtInput} onChange={(e) => setJwtInput(e.target.value)} placeholder="Paste a JWT token..." rows={3} className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none" />
            <button onClick={() => setJwtOutput(decodeJWT(jwtInput.trim()))} className="self-start px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Decode</button>
            {jwtOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-2 font-mono whitespace-pre-wrap overflow-auto max-h-64">{JSON.stringify(jwtOutput, null, 2)}</pre>}
          </div>
        )

      case 'password':
        return (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1.5 text-xs text-text-3">
                Length <input type="number" value={pwLength} min={4} max={128} onChange={(e) => setPwLength(Number(e.target.value))} className="w-14 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none" />
              </label>
              <label className="flex items-center gap-1 text-xs text-text-3"><input type="checkbox" checked={pwUpper} onChange={(e) => setPwUpper(e.target.checked)} /> A-Z</label>
              <label className="flex items-center gap-1 text-xs text-text-3"><input type="checkbox" checked={pwNum} onChange={(e) => setPwNum(e.target.checked)} /> 0-9</label>
              <label className="flex items-center gap-1 text-xs text-text-3"><input type="checkbox" checked={pwSym} onChange={(e) => setPwSym(e.target.checked)} /> !@#$</label>
            </div>
            <button onClick={() => setPwOutput(generatePassword(pwLength, pwUpper, pwNum, pwSym))} className="self-start px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Generate</button>
            {pwOutput && (
              <div className="relative group">
                <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono break-all">{pwOutput}</pre>
                <button onClick={() => copy(pwOutput)} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 text-text-4 hover:text-text-1"><Copy size={12} /></button>
              </div>
            )}
          </div>
        )

      case 'uuid':
        return (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-text-3">
                Count <input type="number" value={uuidCount} min={1} max={50} onChange={(e) => setUuidCount(Math.max(1, Math.min(50, Number(e.target.value))))} className="w-16 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none" />
              </label>
              <button onClick={() => setUuids(Array.from({ length: uuidCount }, uuidv4))} className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Generate</button>
              <button onClick={() => copy(uuids.join('\n'))} className="flex items-center gap-1 px-3 py-1.5 bg-surface-2 text-text-2 border border-border-2 rounded text-xs"><Copy size={11} /> Copy All</button>
            </div>
            {uuids.map((id) => (
              <div key={id} className="flex items-center gap-2 group">
                <span className="flex-1 font-mono text-xs text-text-1 bg-surface-1 border border-border-1 px-3 py-1.5 rounded">{id}</span>
                <button onClick={() => copy(id)} className="opacity-0 group-hover:opacity-100 p-1 text-text-4 hover:text-text-1"><Copy size={12} /></button>
              </div>
            ))}
          </div>
        )

      // ---- Network ----
      case 'curlimp':
        return (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-text-3">Use the cURL import button in the Composer URL bar (the <span className="text-accent">{"< >"}</span> icon).</p>
          </div>
        )

      case 'cors':
        return (
          <div className="flex flex-col gap-3">
            <input value={corsUrl} onChange={(e) => setCorsUrl(e.target.value)}               placeholder="https://api.your-domain.com/test" className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none" />
            <div className="flex gap-2">
              <input value={corsOrigin} onChange={(e) => setCorsOrigin(e.target.value)} placeholder="Origin" className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 focus:border-accent outline-none" />
              <select value={corsMethod} onChange={(e) => setCorsMethod(e.target.value)} className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none">
                {['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'].map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <button onClick={() => fetchApi('/cors', { url: corsUrl, origin: corsOrigin, method: corsMethod }).then((d) => setCorsOutput(d ? JSON.stringify(d, null, 2) : 'Error'))} className="self-start px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Test CORS</button>
            {corsOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono whitespace-pre-wrap">{corsOutput}</pre>}
          </div>
        )

      case 'dns':
        return (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <input value={dnsHost} onChange={(e) => setDnsHost(e.target.value)}               placeholder="your-domain.com" className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none" />
              <select value={dnsType} onChange={(e) => setDnsType(e.target.value)} className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none">
                {['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA'].map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <button onClick={() => fetchApi('/dns/lookup', { host: dnsHost, type: dnsType }).then((d) => setDnsOutput(d ? JSON.stringify(d, null, 2) : 'Error'))} className="self-start px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Lookup</button>
            {dnsOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono whitespace-pre-wrap">{dnsOutput}</pre>}
          </div>
        )

      case 'portscan':
        return (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <input value={scanHost} onChange={(e) => setScanHost(e.target.value)}               placeholder="your-domain.local" className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none" />
              <input value={scanPorts} onChange={(e) => setScanPorts(e.target.value)} placeholder="80,443,8080" className="w-40 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none" />
            </div>
            <button onClick={() => fetchApi('/portscan', { host: scanHost, ports: scanPorts.split(',').map(Number) }).then((d) => setScanOutput(d ? JSON.stringify(d, null, 2) : 'Error'))} className="self-start px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Scan</button>
            {scanOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono whitespace-pre-wrap">{scanOutput}</pre>}
          </div>
        )

      // ---- Data & Time ----
      case 'timestamp':
        return (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <input value={tsInput} onChange={(e) => setTsInput(e.target.value)} placeholder="Unix timestamp or ISO date" className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none" />
              <button onClick={() => {
                const ts = Number(tsInput)
                setTsOutput(formatTimestamp(isNaN(ts) ? Date.parse(tsInput) : ts * 1000))
              }} className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Convert</button>
              <button onClick={() => { setTsInput(String(Math.floor(Date.now() / 1000))); setTsOutput(formatTimestamp(Date.now())) }} className="px-3 py-1.5 bg-surface-2 text-text-2 border border-border-2 rounded text-xs">Now</button>
            </div>
            {tsOutput && (
              <div className="flex flex-col gap-1 text-xs font-mono bg-surface-1 border border-border-1 rounded px-3 py-2">
                <p><span className="text-text-4">Unix:  </span><span className="text-text-1">{tsOutput.unix}</span></p>
                <p><span className="text-text-4">UTC:   </span><span className="text-text-1">{tsOutput.utc}</span></p>
                <p><span className="text-text-4">Local: </span><span className="text-text-1">{tsOutput.local}</span></p>
                <p><span className="text-text-4">ISO:   </span><span className="text-text-1">{tsOutput.iso}</span></p>
              </div>
            )}
          </div>
        )

      case 'fake':
        return (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <select value={fakeType} onChange={(e) => setFakeType(e.target.value)} className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none">
                <option value="name">Names</option>
                <option value="email">Emails</option>
                <option value="phone">Phone Numbers</option>
                <option value="ip">IP Addresses</option>
                <option value="words">Lorem Ipsum</option>
              </select>
              <label className="flex items-center gap-1.5 text-xs text-text-3">
                Count <input type="number" value={fakeCount} min={1} max={100} onChange={(e) => setFakeCount(Number(e.target.value))} className="w-14 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none" />
              </label>
              <button onClick={() => setFakeOutput(generateFake(fakeType, fakeCount))} className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Generate</button>
            </div>
            {fakeOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono whitespace-pre-wrap">{fakeOutput}</pre>}
          </div>
        )

      case 'query':
        return (
          <div className="flex flex-col gap-3">
            <textarea value={queryInput} onChange={(e) => setQueryInput(e.target.value)} placeholder="?key1=val1&key2=val2 or full URL" rows={3} className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none" />
            <div className="flex gap-2">
              <button onClick={() => setQueryOutput(JSON.stringify(parseQuery(queryInput), null, 2))} className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Parse</button>
            </div>
            {queryOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono whitespace-pre-wrap">{queryOutput}</pre>}
          </div>
        )

      case 'jsondiff':
        return (
          <div className="flex flex-col gap-4">
            <div className="inline-flex self-start overflow-hidden rounded border border-border-2 bg-surface-1">
              {(['json', 'xml'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setDiffMode(mode)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors',
                    diffMode === mode ? 'bg-accent text-white' : 'text-text-3 hover:bg-surface-2 hover:text-text-1',
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Left</label>
                <textarea
                  value={diffMode === 'json' ? diffLeft : xmlDiffLeft}
                  onChange={(e) => diffMode === 'json' ? setDiffLeft(e.target.value) : setXmlDiffLeft(e.target.value)}
                  placeholder={diffMode === 'json' ? 'Left JSON' : 'Left XML'}
                  rows={16}
                  className="min-h-[360px] px-3 py-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono leading-relaxed focus:border-accent outline-none resize-y"
                  spellCheck={false}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Right</label>
                <textarea
                  value={diffMode === 'json' ? diffRight : xmlDiffRight}
                  onChange={(e) => diffMode === 'json' ? setDiffRight(e.target.value) : setXmlDiffRight(e.target.value)}
                  placeholder={diffMode === 'json' ? 'Right JSON' : 'Right XML'}
                  rows={16}
                  className="min-h-[360px] px-3 py-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono leading-relaxed focus:border-accent outline-none resize-y"
                  spellCheck={false}
                />
              </div>
            </div>
            <div className={cn(
              'rounded border px-3 py-2 text-xs',
              liveDiff.error
                ? 'border-error/30 bg-error/10 text-error'
                : liveDiff.equal
                  ? 'border-success/30 bg-success/10 text-success'
                  : 'border-warning/30 bg-warning/10 text-warning',
            )}>
              <span className="font-semibold">
                {liveDiff.error ? `Invalid ${diffMode.toUpperCase()}` : liveDiff.equal ? 'No differences' : `${liveDiff.rows.length} differences found`}
              </span>
            </div>
            {liveDiff.error && (
              <pre className="rounded border border-error/30 bg-error/10 px-3 py-2 text-xs text-error whitespace-pre-wrap">{liveDiff.error}</pre>
            )}
            {!liveDiff.error && liveDiff.rows.length > 0 && (
              <div className="grid grid-cols-1 gap-2">
                {liveDiff.rows.slice(0, 24).map((row) => (
                  <div
                    key={`visual-${row.status}-${row.path}`}
                    className={cn(
                      'rounded border px-3 py-2',
                      row.status === 'added' && 'border-success/25 bg-success/8',
                      row.status === 'removed' && 'border-error/25 bg-error/8',
                      row.status === 'changed' && 'border-warning/25 bg-warning/8',
                    )}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className={cn(
                        'rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase',
                        row.status === 'added' && 'bg-success/15 text-success',
                        row.status === 'removed' && 'bg-error/15 text-error',
                        row.status === 'changed' && 'bg-warning/15 text-warning',
                      )}>{row.status}</span>
                      <span className="min-w-0 truncate font-mono text-xs text-text-2">{row.path}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded border border-error/20 bg-surface-0 px-2 py-1.5 font-mono text-xs text-error">{row.left || '-'}</pre>
                      <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded border border-success/20 bg-surface-0 px-2 py-1.5 font-mono text-xs text-success">{row.right || '-'}</pre>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!liveDiff.error && (
              <div className="overflow-hidden rounded border border-border-1 bg-surface-1">
                <div className="grid grid-cols-4 gap-0 border-b border-border-1 bg-surface-2 px-3 py-2 text-[10px] uppercase tracking-wider text-text-4">
                  <span>Total</span>
                  <span>Changed</span>
                  <span>Added</span>
                  <span>Removed</span>
                </div>
                <div className="grid grid-cols-4 gap-0 px-3 py-2 font-mono text-xs">
                  <span className="text-text-1">{liveDiff.rows.length}</span>
                  <span className="text-warning">{liveDiffCounts.changed}</span>
                  <span className="text-success">{liveDiffCounts.added}</span>
                  <span className="text-error">{liveDiffCounts.removed}</span>
                </div>
              </div>
            )}
            {!liveDiff.error && liveDiff.rows.length > 0 && (
              <div className="overflow-hidden rounded border border-border-1 bg-surface-1">
                <div className="grid grid-cols-[86px_1.4fr_1fr_1fr] gap-0 border-b border-border-1 bg-surface-2 px-3 py-2 text-[10px] uppercase tracking-wider text-text-4">
                  <span>Status</span>
                  <span>Path</span>
                  <span>Left</span>
                  <span>Right</span>
                </div>
                <div className="max-h-[420px] overflow-auto">
                  {liveDiff.rows.map((row) => (
                    <div
                      key={`${row.status}-${row.path}`}
                      className={cn(
                        'grid grid-cols-[86px_1.4fr_1fr_1fr] gap-0 border-b border-border-1/40 px-3 py-2 text-xs last:border-b-0',
                        row.status === 'added' && 'bg-success/8',
                        row.status === 'removed' && 'bg-error/8',
                        row.status === 'changed' && 'bg-warning/8',
                      )}
                    >
                      <span className={cn(
                        'font-mono text-[10px] font-semibold uppercase',
                        row.status === 'added' && 'text-success',
                        row.status === 'removed' && 'text-error',
                        row.status === 'changed' && 'text-warning',
                      )}>
                        {row.status}
                      </span>
                      <span className="min-w-0 truncate font-mono text-text-2">{row.path}</span>
                      <span className="min-w-0 whitespace-pre-wrap break-words border-l border-border-1/50 pl-2 font-mono text-error">{row.left || '-'}</span>
                      <span className="min-w-0 whitespace-pre-wrap break-words border-l border-border-1/50 pl-2 font-mono text-success">{row.right || '-'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )

      case 'jsongraph':
        return (
          <div className="flex flex-col gap-3">
            <textarea value={graphInput} onChange={(e) => setGraphInput(e.target.value)} placeholder='{"key": "value"}' rows={4} className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none" />
            <div className="bg-surface-1 border border-border-1 rounded p-3">
              <JsonGraphView json={graphInput} />
            </div>
          </div>
        )

      case 'xml':
        return (
          <div className="flex flex-col gap-3">
            <textarea value={xmlInput} onChange={(e) => setXmlInput(e.target.value)} placeholder="Paste XML..." rows={5} className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none" />
            <div className="flex gap-2">
              <button onClick={() => setXmlOutput(xmlFormat(xmlInput))} className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Format</button>
              <button onClick={() => setXmlValidOutput(xmlValidate(xmlInput))} className="px-3 py-1.5 bg-surface-2 text-text-2 border border-border-2 rounded text-xs">Validate</button>
            </div>
            {xmlValidOutput && <p className={cn('text-xs', xmlValidOutput.startsWith('Valid') ? 'text-success' : 'text-error')}>{xmlValidOutput}</p>}
            {xmlOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono whitespace-pre-wrap overflow-auto max-h-64">{xmlOutput}</pre>}
          </div>
        )

      // ---- Validation ----
      case 'regex':
        return <RegexTester />

      case 'yamlval':
        return (
          <div className="flex flex-col gap-3">
            <FileDropZone
              accept=".yaml,.yml,application/yaml,text/yaml,text/x-yaml,text/plain"
              label="Drop YAML files here"
              detail="Drag one or more .yaml/.yml files, or click to choose them"
              multiple
              onFile={(file) => void handleYamlFiles([file])}
              onFiles={(files) => void handleYamlFiles(files)}
            />
            <textarea
              value={yamlValInput}
              onChange={(e) => { setYamlValInput(e.target.value); setYamlFileResults([]) }}
              placeholder="Paste YAML to validate, or drop one or more YAML files above..."
              rows={8}
              className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none"
            />
            <button
              onClick={() => {
                const result = yamlValidateResult(yamlValInput)
                setYamlFileResults([])
                setYamlValOutput(result.message)
              }}
              className="self-start px-3 py-1.5 bg-accent text-white rounded text-xs font-medium"
            >
              Validate
            </button>
            {yamlValOutput && (
              <div className={cn(
                'rounded border px-3 py-2 text-xs',
                yamlValOutput.startsWith('Valid YAML')
                  ? 'border-success/30 bg-success/10 text-success'
                  : 'border-error/30 bg-error/10 text-error',
              )}>
                {yamlValOutput}
              </div>
            )}
            {yamlFileResults.length > 0 && (
              <div className="overflow-hidden rounded border border-border-1 bg-surface-1">
                {yamlFileResults.map((result) => (
                  <div key={result.name} className="grid grid-cols-[22px_1fr_2fr] gap-2 border-b border-border-1/50 px-3 py-2 last:border-b-0">
                    <span className={cn('font-mono text-xs', result.ok ? 'text-success' : 'text-error')}>{result.ok ? 'OK' : '!!'}</span>
                    <span className="truncate font-mono text-xs text-text-1">{result.name}</span>
                    <span className={cn('text-xs', result.ok ? 'text-success' : 'text-error')}>{result.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )

      case 'httpstatus':
        return (
          <div className="flex flex-col gap-3">
            <input value={httpFilter} onChange={(e) => setHttpFilter(e.target.value)} placeholder="Filter by code or keyword..." className="h-8 px-3 bg-surface-2 border border-border-2 rounded text-xs text-text-1 focus:border-accent outline-none" />
            <div className="border border-border-1 rounded overflow-hidden bg-surface-0">
              <div className="grid grid-cols-[72px_190px_1fr] gap-0 px-3 py-2 text-[10px] uppercase tracking-wider text-text-4 border-b border-border-1 bg-surface-1">
                <span>Code</span>
                <span>Status</span>
                <span>When to use it</span>
              </div>
              <div className="divide-y divide-border-1/40">
                {HTTP_STATUS.filter((s) => {
                  const filter = httpFilter.toLowerCase().trim()
                  const detail = HTTP_DESCRIPTIONS[s.code] ?? ''
                  return !filter
                    || String(s.code).includes(filter)
                    || s.text.toLowerCase().includes(filter)
                    || s.category.toLowerCase().includes(filter)
                    || detail.toLowerCase().includes(filter)
                }).map((s) => (
                  <button
                    key={s.code}
                    onClick={() => copy(String(s.code))}
                    className="w-full grid grid-cols-[72px_190px_1fr] gap-0 px-3 py-2.5 text-left hover:bg-surface-2/60 transition-colors"
                    title="Copy status code"
                  >
                    <span className={`font-mono text-xs font-semibold ${statusClass(s.code)}`}>{s.code}</span>
                    <span className="text-xs font-semibold text-text-1">{s.text}</span>
                    <span className="text-xs text-text-3">{HTTP_DESCRIPTIONS[s.code] ?? s.category}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )

      case 'pem':
        return (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <input
                value={jksPassword}
                onChange={(e) => setJksPassword(e.target.value)}
                type="password"
                placeholder="JKS password (default changeit)"
                className="h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none"
              />
              <input
                value={jksAlias}
                onChange={(e) => setJksAlias(e.target.value)}
                placeholder="Alias (optional)"
                className="h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none"
              />
            </div>
            <FileDropZone
              accept=".pem,.crt,.cer,.key,.jks,.p12,.pfx,application/x-java-keystore,application/octet-stream,text/plain"
              label="Drop PEM, certificate, key, or JKS here"
              detail="JKS files are converted locally to cert.pem and key.pem when keytool and openssl are available"
              onFile={(file) => void handlePemFile(file)}
            />
            {pemFileName && <p className="text-[10px] text-text-4">Loaded: <span className="font-mono text-text-2">{pemFileName}</span></p>}
            <textarea
              value={pemInput}
              onChange={(e) => { setPemInput(e.target.value); setPemFileName('') }}
              placeholder="Paste a PEM certificate/key block, or drop a .pem/.crt/.jks file above..."
              rows={8}
              className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none"
            />
            <button onClick={() => setPemOutput(pemOrJksInspect(pemInput))} className="self-start px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Inspect</button>
            {jksSplit && (
              <div className="flex flex-wrap gap-2 rounded border border-success/30 bg-success/8 p-2">
                <span className="w-full text-[10px] text-success">{jksSplit.warning ?? 'JKS split completed locally.'}</span>
                <button onClick={() => downloadText('cert.pem', jksSplit.certPem, 'application/x-pem-file')} className="inline-flex items-center gap-1 px-3 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-2 hover:text-text-1">
                  <Download size={12} /> cert.pem
                </button>
                <button onClick={() => downloadText('key.pem', jksSplit.keyPem, 'application/x-pem-file')} className="inline-flex items-center gap-1 px-3 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-2 hover:text-text-1">
                  <Download size={12} /> key.pem
                </button>
              </div>
            )}
            {pemOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono whitespace-pre-wrap">{pemOutput}</pre>}
          </div>
        )

      case 'class':
        return (
          <div className="flex flex-col gap-3">
            <FileDropZone
              accept=".class,application/java-vm,application/octet-stream"
              label="Drop a Java .class file here"
              detail="It will be read as binary and analyzed immediately"
              onFile={(file) => void handleClassFile(file)}
            />
            {classFileName && <p className="text-[10px] text-text-4">Loaded: <span className="font-mono text-text-2">{classFileName}</span></p>}
            <textarea
              value={classInput}
              onChange={(e) => { setClassInput(e.target.value); setClassFileName('') }}
              placeholder="Paste hex bytes from a Java .class file, or drop the file above..."
              rows={4}
              className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none"
            />
            <button onClick={() => setClassOutput(classInspect(classInput.trim()))} className="self-start px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Inspect</button>
            {classOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono whitespace-pre-wrap">{classOutput}</pre>}
          </div>
        )

      // ---- Infrastructure ----
      case 'grpcclient':
        return (
          <div className="flex flex-col gap-2 p-3">
            <p className="text-xs text-text-3">gRPC client is available as a dedicated panel. Switch to the <span className="text-accent">gRPC</span> rail item.</p>
          </div>
        )

      case 'docker':
        return <DockerGenerator />

      case 'folderdiff':
        return <FolderDiffTool />

      // ---- Playground ----
      case 'easter':
        return (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <p className="text-3xl">AO</p>
            <p className="text-xs text-text-3 font-mono tracking-wider">ADOMNIA PARATUS.</p>
            <p className="text-[10px] text-text-4">You found the easter egg. Nothing to see here... yet.</p>
          </div>
        )

      default:
        return <p className="text-xs text-text-4 p-4">Select a tool from the sidebar.</p>
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-0">
      <div className="h-8 px-4 border-b border-border-1 flex items-center gap-2 text-[11px] font-semibold tracking-wider">
        <span className="text-accent">DEV / TOOLS</span>
        <span className="text-text-4 font-normal">local utilities and references</span>
      </div>
      <div className="h-10 px-4 border-b border-border-1 flex items-center gap-3">
        <span className="text-accent text-sm leading-none">/</span>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-text-1 leading-tight">Developer Tools</h1>
          <p className="text-[10px] text-text-4 leading-tight">{totalTools} tools grouped for API debugging</p>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <nav className="w-56 flex-shrink-0 bg-surface-1 border-r border-border-1 flex flex-col overflow-y-auto py-1">
          {CATEGORIES.map((cat) => (
            <div key={cat.label}>
              <button
                onClick={() => toggleCat(cat.label)}
                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-text-3 uppercase tracking-wider hover:text-text-2"
              >
                {collapsed[cat.label] ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                <span className="w-5 text-center text-accent-light font-mono">{CATEGORY_MARKERS[cat.label]}</span>
                <span className="truncate">{cat.label}</span>
                <span className="ml-auto min-w-5 rounded bg-surface-2 px-1.5 py-0.5 text-center text-[10px] text-text-4 font-normal">{cat.tools.length}</span>
              </button>
              {!collapsed[cat.label] && (
                <div className="flex flex-col pb-1">
                  {cat.tools.map((tool) => (
                    <button
                      key={tool.id}
                      onClick={() => setActiveTool(tool.id)}
                      className={cn(
                        'text-left mx-2 rounded px-9 py-1.5 text-xs transition-colors',
                        activeTool === tool.id
                          ? 'bg-accent/20 text-accent-light'
                          : 'text-text-3 hover:text-text-1 hover:bg-surface-2'
                      )}
                    >
                      {tool.id === 'jsonyaml' ? 'JSON <> YAML' : tool.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        <section className="flex-1 min-w-0 overflow-auto">
          <div className="max-w-5xl p-6">
            <div className="mb-5 border-b border-border-1 pb-4">
              <p className="text-[10px] uppercase tracking-wider text-text-4">{activeMeta?.category}</p>
              <h2 className="mt-1 text-base font-semibold text-text-1">{activeMeta?.id === 'jsonyaml' ? 'JSON <> YAML' : activeMeta?.label}</h2>
              <p className="mt-1 max-w-2xl text-xs text-text-3">{activeMeta?.desc}</p>
              {activeMeta?.example && (
                <p className="mt-2 inline-flex max-w-full rounded border border-border-1 bg-surface-1 px-2 py-1 text-[11px] text-text-3">
                  <span className="mr-1.5 text-text-4">Example:</span>
                  <span className="truncate font-mono text-text-2">{activeMeta.example}</span>
                </p>
              )}
            </div>
            {renderTool()}
          </div>
        </section>
      </div>
    </div>
  )
}
